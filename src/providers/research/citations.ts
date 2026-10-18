/**
 * Everything that turns raw model output into an answer we are willing to show: parsing the
 * two-section output format, validating `[n]` markers, removing unsupported statements and
 * verifying that quoted evidence really occurs in the cited passage.
 */

const LABEL = String.raw`(?:passage|passagen|quelle|quellen|source|sources|ref|p|nr\.?)`;
const MARKER_VARIANTS = new RegExp(
  String.raw`\[\^?\s*((?:${LABEL}\s*)?\d+(?:\s*(?:,|;|&|und|and|-|–|bis)\s*(?:${LABEL}\s*)?\d+)*)\s*\](?!\()`,
  'gi',
);
const MARKER = /\[(\d+)\]/g;
const SECTION_NAMES = ['BELEGE', 'ZITATE', 'QUOTES', 'EVIDENCE', 'NACHWEISE'];
const ANSWER_NAMES = ['ANTWORT', 'ANSWER'];
const decorated = (names: string[]) =>
  String.raw`[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*(?:${names.join('|')})[ \t]*(?:\*\*|__)?[ \t]*:?[ \t]*(?:\*\*|__)?[ \t]*`;
const QUOTES_HEADER = new RegExp(`^${decorated(SECTION_NAMES)}$`, 'im');
const ANSWER_HEADER = new RegExp(`^\\s*${decorated(ANSWER_NAMES)}(?:\\n|$)`, 'i');
const ANSWER_HEADER_INLINE = new RegExp(`^\\s*(?:\\*\\*|__)?(?:${ANSWER_NAMES.join('|')})(?:\\*\\*|__)?[ \\t]*:(?:\\*\\*|__)?[ \\t]*`, 'i');

/** Rewrites `[1, 2]`, `[1-3]`, `[Passage 2]`, `【1】`, `[^1]` to plain `[1][2]` markers. */
export function normalizeMarkers(text: string): string {
  return text
    .replace(/[【［]/g, '[')
    .replace(/[】］]/g, ']')
    .replace(MARKER_VARIANTS, (whole, inner: string) => {
      const numbers: number[] = [];
      const parts = inner.split(/\s*(?:,|;|&|und|and)\s*/i);
      for (const part of parts) {
        const range = part.match(/(\d+)\s*(?:-|–|bis)\s*(?:\D*?)(\d+)/i);
        if (range) {
          const from = Number(range[1]);
          const to = Number(range[2]);
          if (to < from || to - from > 10) return whole;
          for (let n = from; n <= to; n++) numbers.push(n);
        } else {
          const single = part.match(/\d+/);
          if (single) numbers.push(Number(single[0]));
        }
      }
      // Passage numbers are small; "[2024-2025]" is a year range, not a citation.
      if (numbers.some((n) => n > 99)) return whole;
      return numbers.map((n) => `[${n}]`).join('');
    });
}

export interface ParsedOutput {
  answer: string;
  /** Passage number → quotes the model claims to have copied from it. */
  quotes: Map<number, string[]>;
}

/**
 * Tolerant parser for the `ANTWORT: … BELEGE: …` format. Small models decorate or skip the headers
 * or answer in JSON; all of that degrades to "answer, possibly without quotes" instead of failing.
 */
export function parseModelOutput(raw: string): ParsedOutput {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced?.[1]) text = fenced[1].trim();

  const fromJson = parseJsonOutput(text);
  if (fromJson) return fromJson;

  const quotes = new Map<number, string[]>();
  const header = QUOTES_HEADER.exec(text);
  let answer = text;
  if (header) {
    answer = text.slice(0, header.index);
    for (const line of text.slice(header.index + header[0].length).split('\n')) {
      const m = line.match(/^\s*(?:[-*•]\s*)?\[?\s*(?:passage\s*)?(\d+)\s*\]?\s*[:.)–-]?\s*(.+)$/i);
      if (!m?.[2]) continue;
      addQuote(quotes, Number(m[1]), m[2]);
    }
  }
  answer = answer.replace(ANSWER_HEADER, '').replace(ANSWER_HEADER_INLINE, '').trim();
  return { answer, quotes };
}

function addQuote(quotes: Map<number, string[]>, n: number, raw: string): void {
  const quote = raw.trim().replace(/^["'„“”»«‚‘’`]+|["'„“”»«‚‘’`]+[.,;]?$/g, '').trim();
  if (!quote || !Number.isFinite(n)) return;
  quotes.set(n, [...(quotes.get(n) ?? []), quote]);
}

function parseJsonOutput(text: string): ParsedOutput | null {
  if (!text.startsWith('{')) return null;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const answer = json.antwort ?? json.answer ?? json.ANTWORT;
    if (typeof answer !== 'string') return null;
    const quotes = new Map<number, string[]>();
    const list = json.belege ?? json.quotes ?? json.zitate ?? json.BELEGE;
    if (Array.isArray(list)) {
      for (const item of list as Record<string, unknown>[]) {
        if (!item || typeof item !== 'object') continue;
        const n = item.n ?? item.passage ?? item.nr ?? item.index;
        const quote = item.zitat ?? item.quote ?? item.text;
        if (typeof quote === 'string') addQuote(quotes, Number(n), quote);
      }
    }
    return { answer: answer.trim(), quotes };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Statement-level validation
// ---------------------------------------------------------------------------------------------

export interface ValidatedAnswer {
  /** Answer with dense `[1]..[k]` markers, unsupported statements removed. */
  text: string;
  /** Original passage numbers in the order of their new index (`used[0]` became `[1]`). */
  used: number[];
  /** Number of statements removed because they carried no valid citation. */
  removed: number;
  /** Cited numbers that do not correspond to a passage. */
  invalid: number[];
}

const NO_INFO =
  /(quelle|passage|unterlagen|fundstelle|suchergebnis|source|document)[^.!?]*\b(kein|nicht|no|not|unzureichend|insufficient)|\b(kein|nicht|no|not)[^.!?]*(quelle|passage|unterlagen|fundstelle|suchergebnis|source|document)/i;
const ABBREVIATION = /(?:\b(?:z|B|bzw|ca|ggf|vgl|inkl|exkl|evtl|usw|sog|Abs|Nr|Art|Tab|Abb|Kap|S|d|h|u|a|i|v|o|e|g|vs|max|min|Dr|Prof|mind|insb|bes|zzgl|approx|incl|etc|al)|\d)$/;

type Unit =
  | { kind: 'blank' | 'heading' | 'rule'; text: string }
  | { kind: 'content'; text: string; leadIn: boolean };

function isHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s/.test(line) || /^\s*(\*\*|__)[^*_]+(\*\*|__)\s*:?\s*$/.test(line);
}

function splitUnits(answer: string): Unit[] {
  const units: Unit[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) units.push({ kind: 'content', text: paragraph.join('\n'), leadIn: false });
    paragraph = [];
  };
  for (const line of answer.split('\n')) {
    if (!line.trim()) {
      flush();
      units.push({ kind: 'blank', text: '' });
    } else if (isHeading(line)) {
      flush();
      units.push({ kind: 'heading', text: line });
    } else if (/^\s*\|?\s*:?-{3,}/.test(line)) {
      flush();
      units.push({ kind: 'rule', text: line });
    } else if (/^\s*(?:[-*+•]|\d+[.)])\s+/.test(line) || /^\s*\|/.test(line)) {
      flush();
      units.push({ kind: 'content', text: line, leadIn: false });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return units;
}

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  const boundary = /([.!?])((?:\s*\[\d+\])*)(\s+)(?=[A-ZÄÖÜ„"“(*])/g;
  let start = 0;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    const before = text.slice(start, m.index);
    if (m[1] === '.' && ABBREVIATION.test(before)) continue;
    const end = m.index + m[1]!.length + m[2]!.length + m[3]!.length;
    sentences.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) sentences.push(text.slice(start));
  return sentences;
}

/**
 * Enforces "no claim without a source". A citation covers its own sentence and the uncited
 * sentences directly before it in the same paragraph or list item; everything else that makes a
 * statement is removed. Kept without citation: headings, lead-ins ending in a colon (when cited
 * content follows) and explicit "the sources do not say" statements.
 */
export function validateAnswer(answer: string, passageCount: number): ValidatedAnswer {
  const invalid = new Set<number>();
  const cleaned = normalizeMarkers(answer).replace(MARKER, (marker, digits: string) => {
    const n = Number(digits);
    if (n >= 1 && n <= passageCount) return marker;
    invalid.add(n);
    return '';
  });

  let removed = 0;
  const units = splitUnits(cleaned);
  const kept: (Unit | null)[] = units.map((unit) => {
    if (unit.kind !== 'content') return unit;
    const sentences = splitSentences(unit.text);
    let lastCited = -1;
    sentences.forEach((s, i) => {
      if (/\[\d+\]/.test(s)) lastCited = i;
    });
    const out: string[] = [];
    sentences.forEach((s, i) => {
      if (i <= lastCited || NO_INFO.test(s)) out.push(s);
      else if (lastCited < 0 && sentences.length === 1 && /:\s*(\*\*|__)?\s*$/.test(s)) out.push(s);
      else if (s.trim()) removed++;
    });
    if (!out.length) return null;
    const leadIn = lastCited < 0 && !out.some((s) => NO_INFO.test(s));
    return { kind: 'content', text: out.join('').trimEnd(), leadIn };
  });

  // Headings and lead-ins only survive when something they introduce survived.
  let contentBelow = false;
  for (let i = kept.length - 1; i >= 0; i--) {
    const unit = kept[i];
    if (!unit) continue;
    if (unit.kind === 'heading') {
      if (!contentBelow) kept[i] = null;
      contentBelow = false;
    } else if (unit.kind === 'content') {
      if (unit.leadIn) {
        if (!contentBelow) kept[i] = null;
      } else {
        contentBelow = true;
      }
    }
  }

  const text = kept
    .flatMap((unit) => (unit ? [unit.text] : []))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .trim();

  const used: number[] = [];
  const renumbered = text.replace(MARKER, (_marker, digits: string) => {
    const n = Number(digits);
    let index = used.indexOf(n);
    if (index < 0) index = used.push(n) - 1;
    return `[${index + 1}]`;
  });
  return {
    text: renumbered.replace(/(\[\d+\])(?:\1)+/g, '$1'),
    used,
    removed,
    invalid: [...invalid].sort((a, b) => a - b),
  };
}

// ---------------------------------------------------------------------------------------------
// Quote verification
// ---------------------------------------------------------------------------------------------

interface Normalized {
  text: string;
  /** Index into the original string for every character of `text`. */
  map: number[];
}

function normalizeForMatch(input: string): Normalized {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '­' || ch === '​') continue;
    if (/\s/.test(ch) || ch === ' ') {
      pendingSpace = text.length > 0;
      continue;
    }
    let out = ch.normalize('NFKC').toLowerCase();
    if (/["„“”«»‚‘’'`´]/.test(out)) out = '"';
    else if (/[‐‑‒–—−]/.test(out)) out = '-';
    if (pendingSpace) {
      text += ' ';
      map.push(i);
      pendingSpace = false;
    }
    for (const c of out) {
      text += c;
      map.push(i);
    }
  }
  return { text, map };
}

const MIN_QUOTE_CHARS = 12;
/** Shortest run that counts as evidence when only part of a quote is verbatim. */
const MIN_PARTIAL_CHARS = 40;

/** Longest run of characters two strings share, as `[startInA, length]`. */
function longestCommonRun(a: string, b: string): [number, number] {
  let best = 0;
  let bestEnd = 0;
  let previous = new Uint16Array(b.length + 1);
  let current = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const run = ca === b.charCodeAt(j - 1) ? previous[j - 1]! + 1 : 0;
      current[j] = run;
      if (run > best) {
        best = run;
        bestEnd = i;
      }
    }
    [previous, current] = [current, previous];
  }
  return [bestEnd - best, best];
}

/**
 * Returns the passage's own wording for `quote` if the quote occurs in the passage – compared
 * case-insensitively with whitespace, quote characters and dashes normalised. Models often stitch
 * two sentences together or turn a bullet list into a sentence; then the longest part that is
 * verbatim (at least ${MIN_PARTIAL_CHARS} characters) is returned instead. `null` when nothing of
 * substance matches: the model paraphrased, translated or invented the quote.
 */
export function findVerbatim(passage: string, quote: string): string | null {
  const haystack = normalizeForMatch(passage);
  const slice = (at: number, length: number) =>
    passage.slice(haystack.map[at]!, haystack.map[at + length - 1]! + 1).replace(/\s+/g, ' ').trim();
  const fragments = quote
    .split(/\s*(?:\[\s*(?:\.{3}|…)\s*\]|\(\s*(?:\.{3}|…)\s*\)|\.{3,}|…)\s*/)
    .map((f) => f.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const fragment of fragments) {
    for (const candidate of [fragment, fragment.replace(/[.,;:!?]+$/, '')]) {
      const needle = normalizeForMatch(candidate).text.replace(/^"+|"+$/g, '').trim();
      if (needle.length < MIN_QUOTE_CHARS) continue;
      const at = haystack.text.indexOf(needle);
      if (at >= 0) return slice(at, needle.length);
    }
  }

  const needle = normalizeForMatch(quote).text;
  let [at, length] = longestCommonRun(haystack.text, needle);
  // Do not start or end in the middle of a word.
  const isWord = (i: number) => /[\p{L}\p{N}]/u.test(haystack.text[i] ?? '');
  while (length > 0 && isWord(at - 1) && isWord(at)) {
    at++;
    length--;
  }
  while (length > 0 && !isWord(at)) {
    at++;
    length--;
  }
  while (length > 0 && isWord(at + length) && isWord(at + length - 1)) length--;
  while (length > 0 && /[\s,;:(\-]/.test(haystack.text[at + length - 1]!)) length--;
  return length >= MIN_PARTIAL_CHARS ? slice(at, length) : null;
}

// ---------------------------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------------------------

/**
 * Forwards only the answer section of the streamed output: drops the `ANTWORT:` header and stops
 * at `BELEGE:`. Text that might be the beginning of a header is held back until it is decided.
 */
export function createAnswerStreamFilter(emit: (delta: string) => void): {
  push(delta: string): void;
  end(): void;
} {
  const headers = [...SECTION_NAMES, ...ANSWER_NAMES];
  let pending = '';
  let started = false;
  let stopped = false;

  const couldBecomeHeader = (line: string): boolean => {
    const bare = line.replace(/^[\s#*_]+/, '').replace(/[\s:*_]+$/, '').toUpperCase();
    return line.length <= 24 && headers.some((h) => h.startsWith(bare));
  };

  const drain = (final: boolean) => {
    if (stopped) return;
    if (!started) {
      const firstBreak = pending.indexOf('\n');
      if (!final && firstBreak < 0 && pending.trimStart().length < 24) return;
      pending = pending.replace(ANSWER_HEADER, '').replace(ANSWER_HEADER_INLINE, '').replace(/^\s+/, '');
      started = true;
    }
    const header = QUOTES_HEADER.exec(pending);
    // A header match at the very end may still grow into an ordinary line ("Belege finden sich …").
    if (header && (final || header.index + header[0].length < pending.length)) {
      const before = pending.slice(0, header.index).trimEnd();
      if (before) emit(before);
      pending = '';
      stopped = true;
      return;
    }
    if (final) {
      if (pending.trimEnd()) emit(pending.trimEnd());
      pending = '';
      return;
    }
    const lastBreak = pending.lastIndexOf('\n');
    const tail = pending.slice(lastBreak + 1);
    if (!couldBecomeHeader(tail)) {
      emit(pending);
      pending = '';
      return;
    }
    // Hold back trailing blank lines as well so the stream never ends in dangling whitespace.
    const safe = pending.slice(0, Math.max(lastBreak, 0)).replace(/\s+$/, '');
    if (safe) {
      emit(safe);
      pending = pending.slice(safe.length);
    }
  };

  return {
    push(delta: string) {
      pending += delta;
      drain(false);
    },
    end() {
      drain(true);
    },
  };
}
