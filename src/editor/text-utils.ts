import type { ResearchAnswer } from '../core/types.ts';
import { markdownToPlainText } from './markdown.ts';

/** `2024-03-18` → `18.03.2024`; anything else is returned unchanged. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return d ? `${d}.${mo}.${y}` : mo ? `${mo}/${y}` : y!;
}

/** Answer as plain text with its source list, for "Einfügen" and "Kopieren". */
export function answerToPlainText(answer: ResearchAnswer, sourcesHeading: string): string {
  const body = markdownToPlainText(answer.answer).trim();
  if (answer.citations.length === 0) return body;
  const sources = [...answer.citations]
    .sort((a, b) => a.index - b.index)
    .map((c) => {
      const date = formatDate(c.date);
      const meta = [c.source, date].filter(Boolean).join(', ');
      return `[${c.index}] ${c.title}${meta ? ` (${meta})` : ''} – ${c.url}`;
    });
  return `${body}\n\n${sourcesHeading}:\n${sources.join('\n')}`;
}

/**
 * Dictated chunks arrive without knowledge of the surrounding text: add the missing space
 * towards the previous word, but never before punctuation or at the start of a line.
 */
export function spaceDictation(chunk: string, before: string, after: string): string {
  // Line breaks are content ("neue Zeile", "Absatz"); only runs of blanks are collapsed.
  let text = chunk.replace(/[ \t\u00a0]+/g, ' ').replace(/ ?\n ?/g, '\n');
  const startOfLine = before === '' || before.endsWith('\n');
  if (startOfLine) text = text.replace(/^ +/, '');
  if (!text.trim()) return text.includes('\n') ? text.replace(/[^\n]/g, '') : startOfLine ? '' : text;
  if (!startOfLine && !/\s$/.test(before) && !/^[\s.,;:!?)\]%]/.test(text) && !/[(\[„"/-]$/.test(before)) {
    text = ' ' + text;
  } else if (/\s$/.test(before)) {
    text = text.replace(/^ +/, '');
  }
  if (after && !/^[\s.,;:!?)\]]/.test(after) && !/\s$/.test(text)) text += ' ';
  return text;
}

/** Block inserted via "Einfügen" gets its own paragraph unless the caret already sits on an empty line. */
export function padBlock(block: string, before: string, after: string): string {
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after === '' || after.startsWith('\n') ? '' : '\n\n';
  return lead + block + trail;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === 'string' ? error : String(error);
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
