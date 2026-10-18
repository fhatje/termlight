import type { SourceDocument } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, qs } from '../shared/http.ts';
import { decodeEntities, htmlToText, xmlAll } from '../shared/text.ts';
import { analyzerOf, requireBridge } from './common.ts';
import type { RemoteResearchSource, SourceOptions } from './common.ts';
import { limitOf, rankPassages } from './query.ts';
import type { Section } from './query.ts';

const SEARCH = 'https://wsearch.nlm.nih.gov/ws/query';

/** Parses the `nlmSearchResult` XML of the MedlinePlus web service. */
export function parseMedlinePlus(xml: string): { title: string; url: string; sections: Section[] }[] {
  const out: { title: string; url: string; sections: Section[] }[] = [];
  for (const doc of xmlAll(xml, 'document')) {
    const url = /url="([^"]+)"/.exec(doc.attrs)?.[1];
    const field = (name: string) =>
      xmlAll(doc.inner, 'content').find((c) => new RegExp(`name="${name}"`).test(c.attrs))?.inner;
    const title = htmlToText(decodeEntities(field('title') ?? ''));
    // The summary is HTML escaped inside the XML; search hits are wrapped in <span class="qt0">.
    const summary = decodeEntities(field('FullSummary') ?? '').replace(/<\/?span[^>]*>/g, '');
    if (!url || !title || !summary) continue;

    // Topic pages are written as question → answer; the questions arrive as bare text between blocks.
    const sections: Section[] = [];
    const marked = summary.replace(/(^|<\/p>|<\/ul>)\s*([^<>]{4,140}\?)\s*(?=<p>|<ul>)/g, '$1\u0000$2\u0001');
    for (const part of marked.split('\u0000')) {
      const [head, body] = part.includes('\u0001') ? part.split('\u0001') : [undefined, part];
      const text = htmlToText(body ?? '');
      if (text) sections.push({ heading: head ? htmlToText(head) : 'Summary', text });
    }
    if (sections.length) out.push({ title, url, sections });
  }
  return out;
}

/**
 * MedlinePlus health topics (U.S. National Library of Medicine) through the MedlinePlus web
 * service: consumer-level summaries of diseases and conditions in English. Useful for disease
 * questions, not for prescribing details. No CORS headers → in browsers this source NEEDS the
 * proxy of your own. Limit: 85 requests/min per IP. Content is public domain unless marked otherwise;
 * NLM asks for attribution.
 */
export function createMedlinePlusSource(opts: SourceOptions = {}): RemoteResearchSource {
  const http = createHttpClient({ provider: 'MedlinePlus', ...API_ACCESS.medlineplus }, opts);
  const analyze = analyzerOf(opts);

  return {
    id: 'medlineplus',
    label: 'MedlinePlus (NLM)',
    kind: 'encyclopedia',
    languages: ['en'],
    locality: 'remote',
    needsProxy: true,
    description:
      'Gesundheitsthemen von MedlinePlus (U.S. National Library of Medicine): laienverständliche Übersichten zu Krankheiten, Englisch. Gemeinfrei mit Quellenangabe; gesendet wird nur der Begriff. Im Browser nur über einen eigenen Proxy (kein CORS).',

    async search(query, callOpts) {
      const signal = callOpts?.signal;
      const analysis = await analyze(query, callOpts);
      requireBridge(analysis, 'MedlinePlus', ['en']);
      const limit = limitOf(callOpts, 2, 5);
      // Health topics cover conditions; drug monographs are not part of this web service.
      const terms = analysis.terms.filter((t) => !t.drug && t.variants.english).slice(0, 2);

      const documents: SourceDocument[] = [];
      for (const term of terms) {
        const xml = await http.text(`${SEARCH}?${qs({ db: 'healthTopics', term: `"${term.english}"`, retmax: limit })}`, { signal });
        for (const topic of parseMedlinePlus(xml ?? '')) {
          if (documents.some((d) => d.id === topic.url)) continue;
          documents.push({
            id: topic.url,
            title: `${topic.title} – MedlinePlus`,
            url: topic.url,
            source: 'medlineplus',
            publisher: 'MedlinePlus, U.S. National Library of Medicine',
            language: 'en',
            passages: rankPassages(topic.sections, analysis, { maxPassages: 8 }),
          });
        }
      }
      return documents.slice(0, limit);
    },
  };
}
