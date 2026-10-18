import type { SourceDocument } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, qs } from '../shared/http.ts';
import { fold, tidy, unique } from '../shared/text.ts';
import { analyzerOf } from './common.ts';
import type { RemoteResearchSource, SourceOptions } from './common.ts';
import { limitOf, rankPassages } from './query.ts';
import type { Section } from './query.ts';

/** Appendix sections without content of their own. */
const APPENDIX =
  /^(weblinks|literatur|einzelnachweise|siehe auch|quellen|anmerkungen|hinweis|references|external links|see also|further reading|notes|bibliography|sources)$/;

interface ExtractResponse {
  query?: {
    pages?: {
      title?: string;
      missing?: boolean;
      extract?: string;
      fullurl?: string;
      touched?: string;
      pageprops?: { disambiguation?: string };
    }[];
  };
  error?: { info?: string };
}

/** Splits a plain-text extract with `== Heading ==` lines into sections; sub-headings are joined with " › ". */
export function splitWikiExtract(extract: string, introHeading: string): Section[] {
  const sections: Section[] = [];
  const path: string[] = [];
  let heading = introHeading;
  let buffer: string[] = [];
  const flush = () => {
    const text = tidy(buffer.join('\n'));
    const top = fold(heading.split(' › ')[0]!);
    if (text && !APPENDIX.test(top)) sections.push({ heading, text });
    buffer = [];
  };
  for (const line of extract.split('\n')) {
    const match = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line);
    if (!match) {
      buffer.push(line);
      continue;
    }
    flush();
    const level = match[1]!.length - 2;
    path.length = level;
    path[level] = match[2]!;
    heading = path.filter(Boolean).join(' › ');
  }
  flush();
  return sections;
}

export interface WikipediaSourceOptions extends SourceOptions {
  /** Wikipedia edition, default `de`. */
  language?: string;
}

/**
 * Section-level text of Wikipedia articles through the MediaWiki API (`prop=extracts`).
 * Articles are found through the Wikidata sitelink of the resolved concept, falling back to the
 * term as page title. CORS: yes (`origin=*`), no proxy needed. Text: CC BY-SA 4.0.
 * Wikipedia is a tertiary source written by volunteers – useful for orientation, never the
 * primary evidence for a clinical statement.
 */
export function createWikipediaSource(opts: WikipediaSourceOptions = {}): RemoteResearchSource {
  const language = (opts.language ?? 'de').toLowerCase();
  const http = createHttpClient({ provider: 'Wikipedia', ...API_ACCESS.wikipedia }, opts);
  const analyze = analyzerOf(opts);
  const api = `https://${language}.wikipedia.org/w/api.php`;

  async function article(title: string, signal?: AbortSignal) {
    const url = `${api}?${qs({
      action: 'query',
      prop: 'extracts|info|pageprops',
      explaintext: 1,
      exsectionformat: 'wiki',
      redirects: 1,
      inprop: 'url',
      ppprop: 'disambiguation',
      titles: title,
      format: 'json',
      formatversion: 2,
      origin: '*',
    })}`;
    const data = await http.json<ExtractResponse>(url, { signal });
    const page = data?.query?.pages?.[0];
    if (!page || page.missing || !page.extract || !page.title || page.pageprops?.disambiguation !== undefined) return null;
    return page;
  }

  return {
    id: `wikipedia-${language}`,
    label: `Wikipedia (${language})`,
    kind: 'encyclopedia',
    languages: [language],
    locality: 'remote',
    needsProxy: false,
    description:
      'Abschnitte aus Wikipedia-Artikeln (CC BY-SA 4.0, Autoren laut Versionsgeschichte). Von Freiwilligen verfasste Enzyklopädie – keine medizinische Primärquelle, nur zur Orientierung. Gesendet wird nur der Begriff.',

    async search(query, callOpts) {
      const signal = callOpts?.signal;
      const analysis = await analyze(query, callOpts);
      const limit = limitOf(callOpts, 2, 4);
      const intro = language === 'de' ? 'Einleitung' : 'Introduction';

      const documents: SourceDocument[] = [];
      for (const term of analysis.terms) {
        if (documents.length >= limit) break;
        // Without a sitelink the raw term is only a valid title in the term's own language.
        const title = term.variants.articles?.[language] ?? (analysis.language === language ? term.raw : undefined);
        if (!title) continue;
        const page = await article(title, signal);
        if (!page) continue;
        const url = page.fullurl ?? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title!.replace(/ /g, '_'))}`;
        documents.push({
          id: page.title!,
          title: `${page.title} – Wikipedia`,
          url,
          source: `wikipedia-${language}`,
          publisher: `Wikipedia (${language}), CC BY-SA 4.0`,
          language,
          date: page.touched?.slice(0, 10),
          passages: rankPassages(splitWikiExtract(page.extract!, intro), analysis, { subject: term, maxPassages: 8 }),
        });
      }
      return unique(documents, (d) => d.id);
    },
  };
}
