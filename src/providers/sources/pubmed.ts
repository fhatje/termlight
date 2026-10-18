import type { SourceDocument } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, qs } from '../shared/http.ts';
import { decodeEntities, tidy, xmlAll, xmlText } from '../shared/text.ts';
import { analyzerOf, booleanQuery, isoLanguage, requireBridge } from './common.ts';
import type { RemoteResearchSource, SourceOptions } from './common.ts';
import { limitOf, rankPassages, topicWords } from './query.ts';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const SECONDARY =
  '(review[pt] OR systematic review[pt] OR meta-analysis[pt] OR guideline[pt] OR practice guideline[pt])';

interface ESearch {
  esearchresult?: { idlist?: string[]; ERROR?: string };
  error?: string;
}

export interface PubMedSourceOptions extends SourceOptions {
  /** NCBI API key: 10 instead of 3 requests per second. */
  apiKey?: string;
  /** NCBI asks every tool to identify itself. */
  tool?: string;
  email?: string;
  /** Only reviews, meta-analyses and guidelines; default: prefer them, fill up with other articles. */
  secondaryOnly?: boolean;
}

function plain(xml: string): string {
  return tidy(decodeEntities(xml.replace(/<[^>]+>/g, '')));
}

/** Parses the `PubmedArticleSet` XML of efetch without a DOM. */
export function parsePubmedArticles(xml: string): SourceDocument[] {
  const documents: SourceDocument[] = [];
  for (const { inner } of xmlAll(xml, 'PubmedArticle')) {
    const pmid = xmlText(inner, 'PMID');
    const title = xmlText(inner, 'ArticleTitle');
    const parts = xmlAll(/<Abstract>([\s\S]*?)<\/Abstract>/.exec(inner)?.[1] ?? '', 'AbstractText')
      .map(({ attrs, inner: body }) => {
        const label = /Label="([^"]*)"/.exec(attrs)?.[1];
        const text = plain(body);
        return label && text ? `${decodeEntities(label)}: ${text}` : text;
      })
      .filter(Boolean);
    const abstract = parts.join('\n');
    // Records without an abstract ("Not available.") give the model nothing to quote.
    if (!pmid || !title || abstract.length < 80) continue;

    const journal = xmlText(/<Journal>([\s\S]*?)<\/Journal>/.exec(inner)?.[1] ?? '', 'Title');
    const pubDate = /<PubDate>([\s\S]*?)<\/PubDate>/.exec(inner)?.[1] ?? '';
    const year = xmlText(pubDate, 'Year') ?? /\d{4}/.exec(xmlText(pubDate, 'MedlineDate') ?? '')?.[0];
    const firstAuthor = xmlText(/<Author\b[\s\S]*?<\/Author>/.exec(inner)?.[0] ?? '', 'LastName');
    const authorCount = xmlAll(inner, 'Author').length;
    const types = xmlAll(inner, 'PublicationType')
      .map((t) => plain(t.inner))
      .filter((t) => /review|meta-analysis|guideline|trial/i.test(t));
    documents.push({
      id: pmid,
      title: title.replace(/\.$/, ''),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      source: 'pubmed',
      publisher: [firstAuthor && `${firstAuthor}${authorCount > 1 ? ' et al.' : ''}`, journal, year].filter(Boolean).join(', '),
      language: isoLanguage(xmlText(inner, 'Language')),
      date: year,
      passages: [{ heading: ['Abstract', types.slice(0, 2).join(', ')].filter(Boolean).join(' · '), text: abstract }],
    });
  }
  return documents;
}

/**
 * PubMed through the NCBI E-utilities (esearch + efetch): abstracts, reviews / meta-analyses /
 * guidelines first, sorted by relevance. English query built from the resolved terms.
 * CORS: yes, no proxy needed. No key required (3 requests/s); abstracts remain under the
 * copyright of their publishers.
 */
export function createPubMedSource(opts: PubMedSourceOptions = {}): RemoteResearchSource {
  const http = createHttpClient(
    { provider: 'PubMed', ...API_ACCESS.pubmed, minIntervalMs: opts.apiKey ? 110 : API_ACCESS.pubmed.minIntervalMs },
    opts,
  );
  const analyze = analyzerOf(opts);
  const identity = { tool: opts.tool ?? 'termlight', email: opts.email, api_key: opts.apiKey };

  async function ids(term: string, retmax: number, signal?: AbortSignal): Promise<string[]> {
    const url = `${EUTILS}/esearch.fcgi?${qs({ db: 'pubmed', term, retmode: 'json', retmax, sort: 'relevance', ...identity })}`;
    const data = await http.json<ESearch>(url, { signal });
    return data?.esearchresult?.idlist ?? [];
  }

  return {
    id: 'pubmed',
    label: 'PubMed – Fachliteratur',
    kind: 'literature',
    languages: ['en'],
    locality: 'remote',
    needsProxy: false,
    description:
      'Abstracts aus PubMed/MEDLINE (U.S. National Library of Medicine, E-utilities), bevorzugt Reviews, Metaanalysen und Leitlinien. Überwiegend Englisch; gesendet werden nur die Suchbegriffe. Abstracts © jeweilige Verlage.',

    async search(query, callOpts) {
      const signal = callOpts?.signal;
      const analysis = await analyze(query, callOpts);
      requireBridge(analysis, 'PubMed', ['en']);
      if (analysis.terms.length === 0) return [];
      const limit = limitOf(callOpts, 4);

      const base = `${booleanQuery(analysis.terms, topicWords(analysis), (q) => `${q}[tiab]`)} AND hasabstract`;
      let pmids = await ids(`${base} AND ${SECONDARY}`, limit + 2, signal);
      if (pmids.length < limit && !opts.secondaryOnly) {
        pmids = [...new Set([...pmids, ...(await ids(base, limit + 2, signal))])];
      }
      if (pmids.length === 0) return [];

      const xml = await http.text(`${EUTILS}/efetch.fcgi?${qs({ db: 'pubmed', id: pmids.join(','), retmode: 'xml', ...identity })}`, { signal });
      const byId = new Map(parsePubmedArticles(xml ?? '').map((d) => [d.id, d]));
      // efetch does not keep the relevance order of esearch.
      return pmids
        .flatMap((id) => byId.get(id) ?? [])
        .slice(0, limit)
        .map((d) => ({ ...d, passages: rankPassages(d.passages, analysis, { maxPassages: 2 }) }));
    },
  };
}
