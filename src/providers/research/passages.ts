import type { SourceDocument } from '../../core/types.ts';
import type { Aspect } from './question.ts';
import { tokenize } from './question.ts';

export interface RankedPassage {
  /** 1-based number the passage carries in the prompt. */
  n: number;
  text: string;
  heading?: string;
  doc: SourceDocument;
  sourceLabel: string;
  score: number;
}

export interface RankingInput {
  docs: { doc: SourceDocument; sourceLabel: string }[];
  question: string;
  /** All names of the key entities (original term, English name, aliases). */
  entityNames: string[];
  aspect?: Aspect;
  maxPassages: number;
  maxChars?: number;
}

const CHUNK_CHARS = 1600;

/** Splits long passages at paragraph, then sentence boundaries so each piece fits the budget. */
export function chunkText(text: string, limit = CHUNK_CHARS): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (clean.length <= limit) return clean ? [clean] : [];
  const pieces = clean
    .split(/\n{2,}/)
    .flatMap((p) => (p.length <= limit ? [p] : (p.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g) ?? [p])))
    .flatMap((p) => (p.length <= limit ? [p] : (p.match(new RegExp(`[\\s\\S]{1,${limit}}`, 'g')) ?? [p])));
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > limit) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current && !/\s$/.test(current) ? ' ' : '') + piece;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Lexical ranking – deliberately simple and dependency-free. It only orders and trims what the
 * sources returned; whether a passage answers the question is decided by the model and enforced by
 * citation validation.
 */
export function rankPassages(input: RankingInput): RankedPassage[] {
  const names = [...new Set(input.entityNames.map((n) => n.toLowerCase().trim()).filter((n) => n.length >= 3))];
  const aspectTerms = input.aspect?.terms ?? [];
  const questionTokens = [...new Set(tokenize(input.question.toLowerCase()).filter((t) => t.length >= 4))];
  const maxChars = input.maxChars ?? 14000;

  interface Candidate extends Omit<RankedPassage, 'n'> {
    order: number;
    docKey: string;
  }
  const candidates: Candidate[] = [];
  let order = 0;
  for (const { doc, sourceLabel } of input.docs) {
    const title = doc.title.toLowerCase();
    for (const passage of doc.passages) {
      const heading = passage.heading?.toLowerCase() ?? '';
      for (const text of chunkText(passage.text)) {
        const lower = text.toLowerCase();
        const entityInText = names.some((n) => lower.includes(n));
        const entityInTitle = names.some((n) => title.includes(n) || heading.includes(n));
        const aspectInHeading = aspectTerms.some((t) => heading.includes(t));
        const aspectInText = aspectTerms.filter((t) => lower.includes(t)).length;
        const overlap = questionTokens.length
          ? questionTokens.filter((t) => lower.includes(t) || heading.includes(t)).length / questionTokens.length
          : 0;
        // "Contraindications" of a different drug must not outrank any passage about the right one.
        const aspectWeight = names.length && !entityInText && !entityInTitle ? 0.3 : 1;
        const score =
          (entityInText ? 3 : 0) +
          (entityInTitle ? 2 : 0) +
          ((aspectInHeading ? 5 : 0) + Math.min(aspectInText, 3)) * aspectWeight +
          overlap * 2;
        candidates.push({
          text,
          heading: passage.heading,
          doc,
          sourceLabel,
          score,
          order: order++,
          docKey: `${doc.source}\u0000${doc.id}`,
        });
      }
    }
  }

  // Stable sort: on equal score the order of the sources' own ranking wins.
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.order - b.order);
  const perDocCap = Math.max(2, Math.ceil(input.maxPassages / 2));
  const perDoc = new Map<string, number>();
  const picked: Candidate[] = [];
  let chars = 0;
  for (const c of sorted) {
    if (picked.length >= input.maxPassages) break;
    const count = perDoc.get(c.docKey) ?? 0;
    if (count >= perDocCap) continue;
    if (picked.length && chars + c.text.length > maxChars) continue;
    perDoc.set(c.docKey, count + 1);
    picked.push(c);
    chars += c.text.length;
  }

  // Present passages of one document together and in reading order; best document first.
  const docRank = new Map<string, number>();
  picked.forEach((c, i) => {
    if (!docRank.has(c.docKey)) docRank.set(c.docKey, i);
  });
  picked.sort((a, b) => docRank.get(a.docKey)! - docRank.get(b.docKey)! || a.order - b.order);
  return picked.map(({ order: _order, docKey: _docKey, ...rest }, i) => ({ ...rest, n: i + 1 }));
}
