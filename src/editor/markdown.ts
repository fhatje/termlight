/**
 * Deliberately tiny markdown subset for model output: paragraphs, headings, bullet/numbered
 * lists, bold, italic, inline code, links and `[n]` citation markers. The result is a plain data
 * tree; rendering it never goes through HTML strings, so nothing a model writes can become markup.
 */

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; text: string; url: string }
  | { t: 'cite'; n: number };

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: number; children: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] };

/** Only http(s) links are ever turned into anchors. */
export function safeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

const CITE = /^\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#-]/.test(src[i + 1]!)) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ t: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const link = LINK.exec(rest);
      if (link) {
        flush();
        const url = safeUrl(link[2]);
        // An unsafe target degrades to its label; the URL is never shown as something clickable.
        out.push(url ? { t: 'link', text: link[1]!, url } : { t: 'text', text: link[1]! });
        i += link[0].length;
        continue;
      }
      const cite = CITE.exec(rest);
      if (cite) {
        flush();
        for (const n of cite[1]!.split(/[,;]/)) out.push({ t: 'cite', n: Number(n.trim()) });
        i += cite[0].length;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const double = src[i + 1] === ch;
      const marker = double ? ch + ch : ch;
      const end = src.indexOf(marker, i + marker.length);
      const inner = end > i ? src.slice(i + marker.length, end) : '';
      // `_` inside words (snake_case, "5_mg") is not emphasis.
      const wordInternal = ch === '_' && i > 0 && /[\p{L}\p{N}]/u.test(src[i - 1]!);
      if (inner && !/^\s|\s$/.test(inner) && !wordInternal) {
        flush();
        out.push({ t: double ? 'strong' : 'em', children: parseInline(inner) });
        i = end + marker.length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s{0,6}[-*•]\s+(.*)$/;
const NUMBERED = /^\s{0,6}\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ t: 'p', children: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) });
    list = null;
  };

  for (const rawLine of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ t: 'h', level: heading[1]!.length, children: parseInline(heading[2]!) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? 'ul' : 'ol';
      if (list && list.t !== kind) flushList();
      list ??= { t: kind, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    if (list && /^\s{2,}/.test(rawLine)) {
      // Indented continuation line of the current list item.
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

function inlineToText(nodes: Inline[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.t === 'text' || node.t === 'code') out += node.text;
    else if (node.t === 'cite') out += `[${node.n}]`;
    else if (node.t === 'link') out += node.text;
    else out += inlineToText(node.children);
  }
  return out;
}

/** Plain-text rendering for inserting an answer into the report or copying it. */
export function markdownToPlainText(src: string): string {
  const parts: string[] = [];
  for (const block of parseMarkdown(src)) {
    if (block.t === 'p' || block.t === 'h') parts.push(inlineToText(block.children));
    else parts.push(block.items.map((item, i) => `${block.t === 'ol' ? `${i + 1}.` : '–'} ${inlineToText(item)}`).join('\n'));
  }
  return parts.join('\n\n');
}
