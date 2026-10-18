/**
 * Tokenisation and normalisation shared by the dictionary build and the text scan.
 *
 * Offsets always refer to the original text: the tokenizer works on the raw string and only the
 * per-token key is normalised, so no offset mapping is needed even for NFD input.
 */

/** How a token is attached to the token before it. */
export const GAP_JOIN = 0; // single hyphen, no whitespace: "Pleura-Erguss"
export const GAP_SOFT = 1; // whitespace, spaced hyphen, slash, abbreviation dot
export const GAP_HARD = 2; // anything else; multi-word terms never cross it

export interface Token {
  from: number;
  to: number;
  raw: string;
  norm: string;
  gap: 0 | 1 | 2;
}

const TOKEN_RE = /[\p{L}\p{N}\p{M}]+/gu;
const ASCII_RE = /^[\x00-\x7f]*$/;
const FOLD_RE = /[äöüßæœø]/g;
const FOLD: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o' };
const MARKS_RE = /\p{M}+/gu;
const SOFT_GAP_RE = /^[ \t ]*(?:(?:\r?\n)?[ \t ]*|[-‐‑–/'’][ \t ]*)$/;

/**
 * Case-insensitive key of a token: NFC, lower case, ß→ss, ä/ö/ü→ae/oe/ue (so "Ödem" and "Oedem"
 * meet), remaining diacritics stripped.
 */
export function normalizeToken(raw: string): string {
  const lower = raw.toLowerCase();
  if (ASCII_RE.test(lower)) return lower;
  return lower
    .normalize('NFC')
    .replace(FOLD_RE, (c) => FOLD[c] ?? c)
    .normalize('NFD')
    .replace(MARKS_RE, '')
    .normalize('NFC');
}

function classifyGap(text: string, from: number, to: number, prevLength: number): 0 | 1 | 2 {
  const length = to - from;
  if (length === 1) {
    const c = text.charCodeAt(from);
    if (c === 0x20 || c === 0xa0 || c === 0x09 || c === 0x0a) return GAP_SOFT;
    if (c === 0x2d || c === 0x2010 || c === 0x2011) return GAP_JOIN;
    if (c === 0x2f || c === 0x27 || c === 0x2019 || c === 0x2013) return GAP_SOFT;
    // "A. carotis", "Lig. cruciatum": a dot only glues after something abbreviation-sized.
    if (c === 0x2e) return prevLength <= 4 ? GAP_SOFT : GAP_HARD;
    return GAP_HARD;
  }
  if (length > 6) return GAP_HARD;
  const gap = text.slice(from, to);
  if (SOFT_GAP_RE.test(gap)) return GAP_SOFT;
  if (prevLength <= 4 && /^\.[ \t ]$/.test(gap)) return GAP_SOFT;
  return GAP_HARD;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let prevEnd = -1;
  let prevLength = 0;
  for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
    const raw = m[0];
    const from = m.index;
    const to = from + raw.length;
    const gap = prevEnd < 0 ? GAP_HARD : classifyGap(text, prevEnd, from, prevLength);
    tokens.push({ from, to, raw, norm: normalizeToken(raw), gap });
    prevEnd = to;
    prevLength = raw.length;
  }
  return tokens;
}

export function isUpperInitial(raw: string): boolean {
  const first = raw.charAt(0);
  return first !== first.toLowerCase();
}

export function isAllLetters(raw: string): boolean {
  return /^\p{L}+$/u.test(raw);
}

/** "CT", "MRT", "HbA1c", "pH", "T2": tokens whose letter case carries the meaning. */
export function isAbbreviationLike(raw: string): boolean {
  if (raw.length > 6) return false;
  const rest = raw.slice(1);
  if (rest !== rest.toLowerCase()) return true; // upper case after the first character
  return /\p{N}/u.test(raw) && raw.length <= 4;
}
