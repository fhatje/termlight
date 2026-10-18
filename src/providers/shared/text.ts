/** Text helpers that work without a DOM (the adapters also run in Node and in workers). */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', Eacute: 'É', agrave: 'à', aacute: 'á', acirc: 'â',
  ccedil: 'ç', iuml: 'ï', icirc: 'î', iacute: 'í', oacute: 'ó', ocirc: 'ô', uacute: 'ú', ucirc: 'û',
  ugrave: 'ù', ntilde: 'ñ', oslash: 'ø', aring: 'å', aelig: 'æ',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', bdquo: '„', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', deg: '°', micro: 'µ', plusmn: '±',
  times: '×', divide: '÷', le: '≤', ge: '≥', ne: '≠', asymp: '≈', minus: '−', rarr: '→', larr: '←',
  uarr: '↑', darr: '↓', harr: '↔', reg: '®', copy: '©', trade: '™', sup1: '¹', sup2: '²', sup3: '³',
  frac12: '½', frac14: '¼', frac34: '¾', euro: '€', pound: '£', sect: '§', para: '¶', dagger: '†',
  permil: '‰', prime: '′', Prime: '″', infin: '∞', thinsp: ' ', ensp: ' ', emsp: ' ',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', kappa: 'κ', lambda: 'λ', mu: 'μ', omega: 'ω',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** HTML → readable plain text: block elements become line breaks, list bullets become `- `. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|ul|ol|section|title)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return tidy(decodeEntities(text));
}

/** Collapses whitespace but keeps paragraph breaks. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t \r\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/(\| ?)+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Lower case, diacritics and ß folded – for matching only, never for display. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return `${(stop > max * 0.6 ? cut.slice(0, stop + 1) : cut).trimEnd()} …`;
}

/** Splits long text at paragraph or sentence boundaries into chunks of at most `max` characters. */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return text ? [text] : [];
  const chunks: string[] = [];
  let current = '';
  const units = text.split(/(?<=\n)|(?<=[.!?] )/);
  for (const unit of units) {
    if (current.length + unit.length > max && current) {
      chunks.push(current.trim());
      current = '';
    }
    if (unit.length > max) {
      for (let i = 0; i < unit.length; i += max) chunks.push(unit.slice(i, i + max).trim());
    } else {
      current += unit;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

export function unique<T>(items: Iterable<T>, key: (item: T) => string = String): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

/** First element content of `<tag …>…</tag>` in an XML/HTML snippet, tags stripped. */
export function xmlText(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? tidy(decodeEntities(match[1]!.replace(/<[^>]+>/g, ''))) : undefined;
}

export function xmlAll(xml: string, tag: string): { attrs: string; inner: string }[] {
  const out: { attrs: string; inner: string }[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push({ attrs: m[1]!, inner: m[2]! });
  return out;
}
