import type { SourceDocument } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, qs } from '../shared/http.ts';
import { htmlToText, unique } from '../shared/text.ts';
import { analyzerOf, booleanQuery, isoLanguage, requireBridge } from './common.ts';
import type { RemoteResearchSource, SourceOptions } from './common.ts';
import { limitOf, rankPassages, topicWords } from './query.ts';

const SEARCH = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

const SECONDARY =
  '(PUB_TYPE:"review" OR PUB_TYPE:"systematic review" OR PUB_TYPE:"meta-analysis" OR PUB_TYPE:"guideline" OR PUB_TYPE:"practice guideline")';

interface EpmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  title?: string;
  authorString?: string;
  abstractText?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  language?: string;
  isOpenAccess?: string;
  journalInfo?: { journal?: { title?: string } };
  pubTypeList?: { pubType?: string[] };
}
interface EpmcResponse {
  resultList?: { result?: EpmcResult[] };
  errMsg?: string;
}

export interface EuropePmcSourceOptions extends SourceOptions {
  /** Contact address sent as `email` parameter, as Europe PMC asks heavy users to do. */
  email?: string;
  /** Only reviews, meta-analyses and guidelines; default: prefer them, fill up with other articles. */
  secondaryOnly?: boolean;
}

function toDocument(r: EpmcResult): SourceDocument | null {
  if (!r.id || !r.source || !r.title || !r.abstractText) return null;
  // Structured abstracts mark their parts with <h4>; keep them as inline labels.
  const abstract = htmlToText(r.abstractText.replace(/<h4>([\s\S]*?)<\/h4>/gi, '\n$1: '));
  if (abstract.length < 80) return null;
  const types = (r.pubTypeList?.pubType ?? []).filter((t) => /review|meta-analysis|guideline|trial/i.test(t));
  const journal = r.journalInfo?.journal?.title;
  return {
    id: `${r.source}:${r.id}`,
    title: htmlToText(r.title).replace(/\.$/, ''),
    url: `https://europepmc.org/article/${r.source}/${r.id}`,
    source: 'europepmc',
    publisher: [r.authorString?.split(',')[0]?.concat(r.authorString.includes(',') ? ' et al.' : ''), journal, r.pubYear]
      .filter(Boolean)
      .join(', '),
    language: isoLanguage(r.language),
    date: r.firstPublicationDate ?? r.pubYear,
    passages: [
      {
        heading: ['Abstract', unique(types).slice(0, 2).join(', '), r.isOpenAccess === 'Y' ? 'open access' : ''].filter(Boolean).join(' · '),
        text: abstract,
      },
    ],
  };
}

/**
 * Europe PMC (EMBL-EBI): abstracts of the biomedical literature (PubMed/MEDLINE plus PMC and
 * preprints). Searches the English names of the question's concepts in title/abstract, reviews,
 * meta-analyses and guidelines first. CORS: yes, no proxy needed. Abstracts remain under the
 * copyright of their publishers; Europe PMC permits display with a link back.
 */
export function createEuropePmcSource(opts: EuropePmcSourceOptions = {}): RemoteResearchSource {
  const http = createHttpClient({ provider: 'Europe PMC', ...API_ACCESS.europepmc }, opts);
  const analyze = analyzerOf(opts);

  async function run(query: string, pageSize: number, signal?: AbortSignal): Promise<SourceDocument[]> {
    const url = `${SEARCH}?${qs({ query, format: 'json', resultType: 'core', pageSize, email: opts.email })}`;
    const data = await http.json<EpmcResponse>(url, { signal });
    return (data?.resultList?.result ?? []).flatMap((r) => toDocument(r) ?? []);
  }

  return {
    id: 'europepmc',
    label: 'Europe PMC – Fachliteratur',
    kind: 'literature',
    languages: ['en'],
    locality: 'remote',
    needsProxy: false,
    description:
      'Abstracts aus Europe PMC (EMBL-EBI; PubMed/MEDLINE, PMC), bevorzugt Reviews, Metaanalysen und Leitlinien. Überwiegend Englisch; gesendet werden nur die Suchbegriffe. Abstracts © jeweilige Verlage, Anzeige mit Quellenlink.',

    async search(query, callOpts) {
      const signal = callOpts?.signal;
      const analysis = await analyze(query, callOpts);
      requireBridge(analysis, 'Europe PMC', ['en']);
      if (analysis.terms.length === 0) return [];
      const limit = limitOf(callOpts, 4);

      const base = `${booleanQuery(analysis.terms, topicWords(analysis), (q) => `TITLE_ABS:${q}`)} AND HAS_ABSTRACT:y`;
      const documents = await run(`${base} AND ${SECONDARY}`, limit + 2, signal);
      if (documents.length < limit && !opts.secondaryOnly) {
        documents.push(...(await run(base, limit + 2, signal)));
      }
      return unique(documents, (d) => d.id)
        .slice(0, limit)
        .map((d) => ({ ...d, passages: rankPassages(d.passages, analysis, { maxPassages: 2 }) }));
    },
  };
}
