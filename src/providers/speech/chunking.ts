export interface TextChunk {
  /** Offset of the chunk in the full text (UTF-16). */
  offset: number;
  text: string;
}

const SENTENCE = /[^.!?…\n]+(?:[.!?…]+["“”»)\]]*|\n+|$)\s*/g;
const ABBREVIATION = /(?:\b(?:z|B|bzw|ca|ggf|vgl|inkl|evtl|usw|sog|Nr|Abs|Dr|Prof|d|h|u|a|i|v|o|e|g|Z|n|St|min|max|mind)|\d)\.\s*$/;

/**
 * Splits text into speakable pieces at sentence boundaries, keeping exact offsets so boundary
 * events can be mapped back. Short sentences are merged up to `target` characters; a sentence
 * longer than `limit` is cut at a comma or space.
 */
export function splitIntoChunks(text: string, target = 180, limit = 260): TextChunk[] {
  const sentences: TextChunk[] = [];
  let carryStart = -1;
  for (const m of text.matchAll(SENTENCE)) {
    const start = carryStart >= 0 ? carryStart : m.index;
    const piece = text.slice(start, m.index + m[0].length);
    // "z. B." and "3. Tag" end with a period without ending the sentence.
    if (ABBREVIATION.test(piece) && m.index + m[0].length < text.length) {
      carryStart = start;
      continue;
    }
    carryStart = -1;
    sentences.push({ offset: start, text: piece });
  }
  if (carryStart >= 0) sentences.push({ offset: carryStart, text: text.slice(carryStart) });

  const pieces = sentences.flatMap((s) => (s.text.length <= limit ? [s] : cutLong(s, limit)));
  const chunks: TextChunk[] = [];
  for (const piece of pieces) {
    if (!piece.text.trim()) continue;
    const last = chunks.at(-1);
    // Merge only across pieces that are adjacent in the source, so offsets stay exact.
    if (last && last.text.length + piece.text.length <= target && last.offset + last.text.length === piece.offset && !/\n\s*$/.test(last.text)) {
      last.text += piece.text;
    } else {
      chunks.push({ ...piece });
    }
  }
  return chunks;
}

function cutLong(sentence: TextChunk, limit: number): TextChunk[] {
  const out: TextChunk[] = [];
  let start = 0;
  const { text } = sentence;
  while (text.length - start > limit) {
    const window = text.slice(start, start + limit);
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '));
    cut = cut > limit * 0.4 ? cut + 2 : window.lastIndexOf(' ') + 1;
    if (cut <= 0) cut = limit;
    out.push({ offset: sentence.offset + start, text: text.slice(start, start + cut) });
    start += cut;
  }
  out.push({ offset: sentence.offset + start, text: text.slice(start) });
  return out;
}

/** `de` → `de-DE`; speech APIs want a region. */
export function toSpeechLocale(language: string | undefined, fallback = 'de-DE'): string {
  if (!language) return fallback;
  if (language.includes('-')) return language;
  const regions: Record<string, string> = { de: 'de-DE', en: 'en-US', fr: 'fr-FR', it: 'it-IT', es: 'es-ES', nl: 'nl-NL' };
  return regions[language.toLowerCase()] ?? language;
}
