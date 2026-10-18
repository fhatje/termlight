import type { ResearchSourceKind, SourceDocument } from '../../core/types.ts';
import { createHttpClient, ProviderError } from '../shared/http.ts';
import type { RemoteOptions } from '../shared/http.ts';
import type { RemoteResearchSource } from './common.ts';
import { limitOf } from './query.ts';

export interface HttpSourceOptions extends RemoteOptions {
  /** Unique id of the source; becomes `SourceDocument.source`. */
  id: string;
  /** Name shown in the settings UI. */
  label: string;
  /** URL the query is POSTed to (same origin or CORS enabled). */
  endpoint: string;
  kind: ResearchSourceKind;
  /** Languages of the content, e.g. `['de']`. */
  languages: string[];
  /** Extra request headers, e.g. `{ Authorization: 'Bearer …' }`. */
  headers?: Record<string, string>;
  description?: string;
}

/**
 * Generic adapter for a source you run or license yourself – a Fachinformation database, an
 * internal guideline index, a hospital formulary.
 *
 * Wire format (JSON over HTTP POST):
 *
 * ```
 * → POST <endpoint>            Content-Type: application/json  (+ your `headers`)
 *   {
 *     "question": "Kontraindikationen für Metamizol",   // as typed by the user
 *     "concept":  { "conceptId": "wikidata:Q422761",    // optional: the annotation the question
 *                   "label": "Metamizol",               //           was asked about
 *                   "type": "medication",
 *                   "codes": [{ "system": "ATC", "code": "N02BB02" }] },
 *     "language": "de",                                 // language of the question
 *     "limit":    3                                     // maximum number of documents
 *   }
 *
 * ← 200  { "documents": [ {
 *       "id":        "fi-12345",                        // unique within your source (required)
 *       "title":     "Novalgin 500 mg Filmtabletten – Fachinformation",   // required
 *       "url":       "https://…/fi/12345#4.3",          // human-openable link, shown as citation (required)
 *       "publisher": "…", "language": "de", "date": "2025-03",            // optional
 *       "passages":  [ { "heading": "4.3 Gegenanzeigen", "text": "…" } ]  // most relevant first (required)
 *   } ] }
 * ```
 *
 * No hit is `{ "documents": [] }` with status 200. Any non-2xx status, or a body that does not
 * match the format, makes `search` reject. The document text never leaves the editor: only the
 * question and the concept are sent. `source` of each document is set to this source's `id`.
 */
export function createHttpSource(opts: HttpSourceOptions): RemoteResearchSource {
  // A user-provided endpoint is expected to be reachable from the page; the proxy only applies with `proxyAll`.
  const http = createHttpClient({ provider: opts.label, needsProxy: false }, opts);

  return {
    id: opts.id,
    label: opts.label,
    kind: opts.kind,
    languages: opts.languages,
    locality: 'remote',
    needsProxy: false,
    description: opts.description ?? `Eigene Quelle (${opts.endpoint}). Gesendet werden nur Frage und Begriff.`,

    async search(query, callOpts) {
      const body = {
        question: query.question,
        concept: query.concept,
        language: query.language ?? callOpts?.language,
        limit: limitOf(callOpts, 3, 20),
      };
      const data = await http.json<{ documents?: unknown }>(opts.endpoint, {
        signal: callOpts?.signal,
        headers: opts.headers,
        body,
      });
      if (!data || !Array.isArray(data.documents)) {
        throw new ProviderError(opts.label, 'response has no "documents" array', { url: opts.endpoint });
      }
      const documents: SourceDocument[] = [];
      for (const raw of data.documents as Partial<SourceDocument>[]) {
        const passages = (Array.isArray(raw?.passages) ? raw.passages : [])
          .filter((p) => p && typeof p.text === 'string' && p.text.trim())
          .map((p) => (typeof p.heading === 'string' && p.heading ? { heading: p.heading, text: p.text } : { text: p.text }));
        if (typeof raw?.id !== 'string' || typeof raw.title !== 'string' || typeof raw.url !== 'string' || passages.length === 0) {
          throw new ProviderError(opts.label, 'a document lacks id, title, url or passages', { url: opts.endpoint });
        }
        documents.push({
          id: raw.id,
          title: raw.title,
          url: raw.url,
          source: opts.id,
          publisher: typeof raw.publisher === 'string' ? raw.publisher : undefined,
          language: typeof raw.language === 'string' ? raw.language : undefined,
          date: typeof raw.date === 'string' ? raw.date : undefined,
          passages,
        });
      }
      return documents.slice(0, body.limit);
    },
  };
}
