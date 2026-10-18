import type { Annotation, CallOptions, ConceptType, Recognizer } from '../../core/types.ts';
import { resolveOverlaps } from '../../core/matcher/index.ts';

export interface RemoteRecognizerOptions {
  endpoint: string;
  id?: string;
  label?: string;
  headers?: Record<string, string>;
}

const TYPES = new Set<string>(['anatomy', 'disease', 'symptom', 'finding', 'medication', 'substance', 'procedure', 'lab', 'physiology', 'modifier', 'other']);

/**
 * Adapter for a server-side NER service of your own.
 *
 * Wire format:
 *
 *     POST <endpoint>
 *     Content-Type: application/json
 *     { "text": "Kein Pleuraerguss links.", "language": "de" }
 *
 *     200 OK
 *     { "annotations": [ {
 *         "from": 5, "to": 17,                  // UTF-16 offsets into `text`, `to` exclusive
 *         "conceptId": "myner:C0032227",        // globally unique, "<source>:<localId>"
 *         "label": "Pleuraerguss",              // canonical term
 *         "type": "finding",                    // a ConceptType; unknown values become "other"
 *         "codes": [ { "system": "ICD-10-GM", "code": "J90" } ],   // optional
 *         "assertion": "negated",               // optional: present | negated | uncertain
 *         "laterality": "left",                 // optional: left | right | bilateral
 *         "confidence": 0.93                    // optional, 0..1
 *     } ] }
 *
 * `text` and `source` of each annotation are filled in by the adapter. Annotations with offsets
 * outside the text or without `conceptId` / `label` are discarded; overlaps are resolved (longest
 * wins). Any non-2xx status rejects the call. The whole document text is sent to the endpoint.
 */
export function createRemoteRecognizer(options: RemoteRecognizerOptions): Recognizer {
  const id = options.id ?? 'remote';
  return {
    id,
    label: options.label ?? 'Eigener NER-Dienst',
    locality: 'remote',
    description: `Sendet den gesamten Text zur Erkennung an ${options.endpoint}.`,

    async recognize(text: string, opts?: CallOptions): Promise<Annotation[]> {
      if (text.length === 0) return [];
      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers },
        body: JSON.stringify({ text, language: opts?.language }),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
      if (!response.ok) throw new Error(`${id}: HTTP ${response.status} von ${options.endpoint}`);
      const body = (await response.json()) as { annotations?: unknown };
      if (!Array.isArray(body.annotations)) throw new Error(`${id}: Antwort ohne "annotations"-Liste`);
      const valid: Annotation[] = [];
      for (const raw of body.annotations as Partial<Annotation>[]) {
        if (!raw || typeof raw !== 'object') continue;
        const { from, to } = raw;
        if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
        if ((from as number) < 0 || (to as number) <= (from as number) || (to as number) > text.length) continue;
        if (typeof raw.conceptId !== 'string' || typeof raw.label !== 'string') continue;
        const annotation: Annotation = {
          from: from as number,
          to: to as number,
          text: text.slice(from as number, to as number),
          conceptId: raw.conceptId,
          label: raw.label,
          type: TYPES.has(String(raw.type)) ? (raw.type as ConceptType) : 'other',
          source: id,
        };
        if (Array.isArray(raw.codes)) {
          annotation.codes = raw.codes.filter((c) => c && typeof c.system === 'string' && typeof c.code === 'string');
        }
        if (raw.assertion === 'present' || raw.assertion === 'negated' || raw.assertion === 'uncertain') annotation.assertion = raw.assertion;
        if (raw.laterality === 'left' || raw.laterality === 'right' || raw.laterality === 'bilateral') annotation.laterality = raw.laterality;
        if (typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1) annotation.confidence = raw.confidence;
        valid.push(annotation);
      }
      return resolveOverlaps([valid]);
    },
  };
}
