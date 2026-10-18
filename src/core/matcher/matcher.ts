/**
 * Dictionary matcher: a trie over normalised tokens, built once from term packs. Scanning a text
 * is linear in its length (one hash lookup per token and candidate form, then trie steps only
 * along real term prefixes).
 *
 * Pure TypeScript without DOM or Node APIs; runs in the main thread, a worker and Node.
 */
import type { Annotation, PackConcept, TermPack } from '../types.ts';
import type { ContextRules } from './context.ts';
import { createContextAnnotator, DEFAULT_CONTEXT_RULES } from './context.ts';
import type { Token } from './normalize.ts';
import { GAP_HARD, GAP_JOIN, isAbbreviationLike, isAllLetters, isUpperInitial, normalizeToken, tokenize } from './normalize.ts';
import { getLanguage, languageCode } from './languages.ts';
import { DEFAULT_STOPWORDS } from './stopwords.ts';

/**
 * `PackConcept` plus the optional ambiguity control understood by the matcher.
 * (Proposed addition to the contract in `types.ts`.)
 */
export type MatcherConcept = PackConcept & {
  /**
   * Surface forms that only match in exactly this letter case and without inflection: abbreviations
   * ("KM", "LE") and short names that collide with ordinary words. Forms listed here need not be
   * repeated in `terms`; if they are (or equal the label), the exact rule applies to them.
   */
  exact?: string[];
};

/** `TermPack` plus an optional priority (higher wins on equal-length overlaps; default: pack order). */
export type MatcherPack = Omit<TermPack, 'concepts'> & {
  concepts: MatcherConcept[];
  priority?: number;
};

export interface InflectionRules {
  /** `[suffix, replacement]` stripped from a capitalised German text word to reach a dictionary noun. */
  nounSuffixes: [string, string][];
  /** Suffixes added to a noun whose stem vowel took an umlaut in the plural ("Ergüsse" → "Erguss"). */
  umlautSuffixes: string[];
  /** Endings of German adjectives; applied to both the dictionary form and the text word. */
  adjectiveSuffixes: string[];
  englishSuffixes: string[];
  /** Minimal length of what remains after stripping. */
  minStem: number;
}

export const DEFAULT_INFLECTION: InflectionRules = {
  nounSuffixes: [
    ['es', ''],
    ['s', ''],
    ['en', ''],
    ['n', ''],
    ['e', ''],
    ['nisse', 'nis'],
    ['nissen', 'nis'],
    ['itiden', 'itis'],
    ['en', 'a'],
    ['en', 'um'],
    ['en', 'us'],
    ['ien', 'ium'],
  ],
  umlautSuffixes: ['', 'e', 'en', 'er', 'ern', 'n'],
  adjectiveSuffixes: ['e', 'er', 'es', 'en', 'em'],
  englishSuffixes: ['s', 'es'],
  minStem: 4,
};

export interface MatcherOptions {
  /** `Annotation.source` of the results. Default `dictionary`. */
  source?: string;
  /**
   * Language of the documents (`de`, `en`, `fr`, …). Selects the negation / uncertainty /
   * laterality rules and the stopwords, and puts packs of any other language under a stricter
   * guard (see `foreignMinLength`). Unset: German and English rules together, no guard.
   */
  language?: string;
  /**
   * Shortest single-word term taken from a pack whose language differs from `language`. Short
   * foreign words collide with ordinary words of the document language far too often. Default 5.
   */
  foreignMinLength?: number;
  /** Single-word terms equal to one of these are dropped (see `stopwords.ts`). Default: by language. */
  stopwords?: Iterable<string>;
  /** `false` switches assertion / laterality detection off. */
  contextRules?: ContextRules | false;
  /** `false` switches inflection matching off. */
  inflection?: InflectionRules | false;
  /** Split unknown German compounds whose two halves are both dictionary nouns. Default true. */
  compounds?: boolean;
  /**
   * A German dictionary noun shorter than this only matches a capitalised text word, which keeps
   * verbs and adjectives apart from nouns ("leiden" / "Leiden", "wand" / "Wand"). Default 8.
   */
  nounCaseMinLength?: number;
  /** Terms with more tokens are ignored. Default 12. */
  maxTermTokens?: number;
}

export interface MatcherStats {
  packs: number;
  concepts: number;
  /** Surface forms in the trie. */
  terms: number;
  /** Surface forms rejected by the noise guards. */
  skippedTerms: number;
  tokens: number;
  nodes: number;
  buildMs: number;
}

export interface TermMatcher {
  /** All non-overlapping term occurrences, sorted by `from`. */
  match(text: string, options?: { source?: string }): Annotation[];
  readonly stats: MatcherStats;
}

// Token classes decide which inflected text forms may reach a dictionary token.
const C_FIXED = 0;
const C_DE_NOUN = 1;
const C_DE_ADJ = 2;
const C_EN = 3;
/** First class of the languages inflected by `LanguageRules.suffixes`. */
const C_SUFFIX = 4;

const F_LABEL = 1;
const F_EXACT = 2;

// Node ids and token ids are combined into one numeric map key; 2^21 tokens * 2^31 nodes < 2^53.
const STRIDE = 2097152;
const CACHE_LIMIT = 60000;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function isAllCaps(raw: string): boolean {
  return raw === raw.toUpperCase() && raw !== raw.toLowerCase();
}

const CASE_FOLD: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };

/** Spelling-tolerant but case-preserving form used to compare exact-case terms ("Fuß" = "Fuss" ≠ "fuss"). */
function caseKey(raw: string): string {
  if (/^[\x00-\x7f]*$/.test(raw)) return raw;
  return raw.normalize('NFC').replace(/[äöüÄÖÜß]/g, (c) => CASE_FOLD[c] ?? c);
}

export function createMatcher(packs: readonly (TermPack | MatcherPack)[], options: MatcherOptions = {}): TermMatcher {
  const started = now();
  const defaultSource = options.source ?? 'dictionary';
  const inflection = options.inflection === false ? null : (options.inflection ?? DEFAULT_INFLECTION);
  const compounds = options.compounds ?? true;
  const nounCaseMin = options.nounCaseMinLength ?? 8;
  const maxTermTokens = options.maxTermTokens ?? 12;
  const minStem = inflection?.minStem ?? 4;
  const docLanguage = languageCode(options.language);
  const docRules = getLanguage(docLanguage);
  const foreignMinLength = options.foreignMinLength ?? 5;
  const stopwords = new Set<string>();
  const addStopwords = (list: Iterable<string>): void => {
    for (const w of list) stopwords.add(normalizeToken(w));
  };
  if (options.stopwords) addStopwords(options.stopwords);
  else if (docRules) {
    // A pack's own language counts too: an English drug list must not light up "was" in German text.
    addStopwords(docRules.stopwords);
    for (const pack of packs) addStopwords(getLanguage(pack.language)?.stopwords ?? []);
  } else addStopwords(DEFAULT_STOPWORDS);
  const context =
    options.contextRules === false ? null : createContextAnnotator(options.contextRules ?? docRules?.context ?? DEFAULT_CONTEXT_RULES);
  // Languages inflected by a plain suffix list each get a token class of their own.
  const suffixClass = new Map<string, number>();
  const suffixRules: [cls: number, rules: [string, string][]][] = [];

  // ---- dictionary ---------------------------------------------------------------------------

  const tokenIds = new Map<string, number>(); // class digit + norm → id
  const tokenClass: number[] = [0];
  const vocab = new Map<string, number | number[]>(); // lookup key → token ids
  const rootNext: number[] = [0];
  const trans = new Map<number, number>();
  const nodeHead: number[] = [-1];
  const entryConcept: number[] = [];
  const entryFlags: number[] = [];
  const entryNext: number[] = [];
  const entryRaw = new Map<number, string>();
  const conceptPack: number[] = [];
  const conceptRef: PackConcept[] = [];
  const conceptIds: (string | undefined)[] = [];
  let skippedTerms = 0;

  // Rank 0 is the strongest pack.
  const order = packs.map((_, i) => i);
  order.sort((a, b) => ((packs[b] as MatcherPack).priority ?? 0) - ((packs[a] as MatcherPack).priority ?? 0) || a - b);
  const packRank: number[] = [];
  order.forEach((packIndex, rank) => {
    packRank[packIndex] = rank;
  });

  function register(key: string, id: number): void {
    const known = vocab.get(key);
    if (known === undefined) vocab.set(key, id);
    else if (typeof known === 'number') {
      if (known !== id) vocab.set(key, [known, id]);
    } else if (!known.includes(id)) known.push(id);
  }

  function adjectiveStem(norm: string): string | null {
    if (!inflection) return null;
    let best: string | null = null;
    for (const suffix of inflection.adjectiveSuffixes) {
      if (norm.length - suffix.length >= minStem && norm.endsWith(suffix)) {
        const stem = norm.slice(0, norm.length - suffix.length);
        if (best === null || stem.length < best.length) best = stem;
      }
    }
    return best;
  }

  function tokenId(norm: string, cls: number): number {
    const key = cls + norm;
    let id = tokenIds.get(key);
    if (id !== undefined) return id;
    id = tokenClass.length;
    tokenIds.set(key, id);
    tokenClass.push(cls);
    rootNext.push(0);
    register(norm, id);
    if (cls === C_DE_ADJ) {
      // Adjectives are reachable by their stem, whichever ending the pack happens to list.
      register('~' + norm, id);
      const stem = adjectiveStem(norm);
      if (stem) register('~' + stem, id);
    }
    return id;
  }

  function classOf(raw: string, language: string, exact: boolean): number {
    if (exact || !inflection || raw.length < 4 || !isAllLetters(raw) || isAllCaps(raw)) return C_FIXED;
    if (language === 'de') return isUpperInitial(raw) ? C_DE_NOUN : C_DE_ADJ;
    const rules = getLanguage(language)?.suffixes;
    // English without registered rules keeps the built-in plural handling.
    if (!rules) return language === 'en' ? C_EN : C_FIXED;
    let cls = suffixClass.get(language);
    if (cls === undefined) {
      cls = C_SUFFIX + suffixClass.size;
      suffixClass.set(language, cls);
      suffixRules.push([cls, rules]);
    }
    return cls;
  }

  function insert(path: number[], concept: number, flags: number, raw: string): void {
    let node = 0;
    for (const id of path) {
      let next: number | undefined;
      if (node === 0) {
        next = rootNext[id] || undefined;
      } else {
        next = trans.get(node * STRIDE + id);
      }
      if (next === undefined) {
        next = nodeHead.length;
        nodeHead.push(-1);
        if (node === 0) rootNext[id] = next;
        else trans.set(node * STRIDE + id, next);
      }
      node = next;
    }
    for (let e = nodeHead[node] as number; e >= 0; e = entryNext[e] as number) {
      if (entryConcept[e] === concept && ((entryFlags[e] as number) & F_EXACT) === (flags & F_EXACT)) {
        if (flags & F_EXACT && entryRaw.get(e) !== raw) continue;
        return;
      }
    }
    const entry = entryConcept.length;
    entryConcept.push(concept);
    entryFlags.push(flags);
    entryNext.push(nodeHead[node] as number);
    nodeHead[node] = entry;
    if (flags & F_EXACT) entryRaw.set(entry, raw);
  }

  function addTerm(surface: string, concept: number, language: string, isLabel: boolean, explicitExact: boolean): void {
    const tokens = tokenize(surface);
    const foreign = docLanguage !== '' && language !== '' && language !== docLanguage;
    if (tokens.length === 0 || tokens.length > maxTermTokens) {
      skippedTerms++;
      return;
    }
    let exact = explicitExact;
    if (tokens.length === 1) {
      const raw = (tokens[0] as Token).raw;
      const norm = (tokens[0] as Token).norm;
      if (/^\p{N}+$/u.test(raw)) {
        skippedTerms++;
        return;
      }
      if (!exact && foreign && raw.length < foreignMinLength) {
        skippedTerms++;
        return;
      }
      if (!exact) {
        const caps = isAllCaps(raw) && raw.length >= 2;
        if (stopwords.has(norm)) {
          if (!caps) {
            skippedTerms++;
            return;
          }
          exact = true;
        } else if (raw.length <= 2) {
          if (!caps && !isAbbreviationLike(raw)) {
            skippedTerms++;
            return;
          }
          exact = true;
        } else if (raw.length <= 3 || isAbbreviationLike(raw)) {
          exact = true;
        }
      }
    } else if (!exact && tokens.every((t) => stopwords.has(t.norm) || /^\p{N}+$/u.test(t.raw))) {
      skippedTerms++;
      return;
    }

    const flags = (isLabel ? F_LABEL : 0) | (exact ? F_EXACT : 0);
    const compact = caseKey(tokens.map((t) => t.raw).join(''));
    const split = tokens.map((t) => tokenId(t.norm, classOf(t.raw, language, exact)));
    insert(split, concept, flags, compact);

    if (tokens.some((t, i) => i > 0 && t.gap === GAP_JOIN)) {
      // "Pleura-Erguss" is also stored as "Pleuraerguss".
      const joined: number[] = [];
      let raw = '';
      let norm = '';
      tokens.forEach((t, i) => {
        if (i > 0 && t.gap !== GAP_JOIN) {
          joined.push(tokenId(norm, classOf(raw, language, exact)));
          raw = '';
          norm = '';
        }
        raw += t.raw;
        norm += t.norm;
      });
      joined.push(tokenId(norm, classOf(raw, language, exact)));
      insert(joined, concept, flags, compact);
    }
  }

  packs.forEach((pack, packIndex) => {
    const language = (pack.language || '').toLowerCase().split('-')[0] ?? '';
    for (const concept of pack.concepts as MatcherConcept[]) {
      const index = conceptRef.length;
      conceptRef.push(concept);
      conceptPack.push(packIndex);
      conceptIds.push(undefined);
      const exact = new Set(concept.exact ?? []);
      addTerm(concept.label, index, language, true, exact.has(concept.label));
      if (concept.terms) for (const term of concept.terms) addTerm(term, index, language, false, exact.has(term));
      for (const term of exact) addTerm(term, index, language, term === concept.label, true);
    }
  });

  const stats: MatcherStats = {
    packs: packs.length,
    concepts: conceptRef.length,
    terms: entryConcept.length,
    skippedTerms,
    tokens: tokenClass.length - 1,
    nodes: nodeHead.length,
    buildMs: 0,
  };

  // ---- text side ----------------------------------------------------------------------------

  // Flat pairs [tokenId, inflected(0|1), ...] per raw text word; survives across calls because an
  // editor re-scans nearly the same text on every keystroke.
  let candidateCache = new Map<string, number[]>();
  let compoundCache = new Map<string, number[] | null>();
  const EMPTY: number[] = [];

  function pushIds(out: number[], key: string, inflected: number, accept: (cls: number) => boolean): void {
    const ids = vocab.get(key);
    if (ids === undefined) return;
    if (typeof ids === 'number') {
      if (accept(tokenClass[ids] as number) && !hasId(out, ids)) out.push(ids, inflected);
      return;
    }
    for (const id of ids) {
      if (accept(tokenClass[id] as number) && !hasId(out, id)) out.push(id, inflected);
    }
  }

  function hasId(out: number[], id: number): boolean {
    for (let i = 0; i < out.length; i += 2) if (out[i] === id) return true;
    return false;
  }

  const isGermanClass = (cls: number): boolean => cls === C_DE_NOUN || cls === C_DE_ADJ;
  const isNounClass = (cls: number): boolean => cls === C_DE_NOUN;
  const isEnglishClass = (cls: number): boolean => cls === C_EN;
  const anyClass = (): boolean => true;

  function computeCandidates(raw: string, norm: string): number[] {
    const out: number[] = [];
    const upper = isUpperInitial(raw);
    pushIds(out, norm, 0, upper || norm.length >= nounCaseMin ? anyClass : (cls) => cls !== C_DE_NOUN);
    if (!inflection || norm.length <= minStem) return out.length ? out : EMPTY;

    if (upper) {
      for (const [suffix, replacement] of inflection.nounSuffixes) {
        if (!norm.endsWith(suffix)) continue;
        const stem = norm.length - suffix.length;
        if (stem < (replacement ? minStem - 1 : minStem)) continue;
        pushIds(out, norm.slice(0, stem) + replacement, 1, isGermanClass);
      }
      const lower = raw.toLowerCase().normalize('NFC');
      if (/[äöü]/.test(lower)) {
        const plain = normalizeToken(lower.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u'));
        for (const suffix of inflection.umlautSuffixes) {
          if (plain.length - suffix.length < minStem || !plain.endsWith(suffix)) continue;
          pushIds(out, plain.slice(0, plain.length - suffix.length), 1, isNounClass);
        }
      }
    }
    for (const suffix of inflection.adjectiveSuffixes) {
      if (norm.length - suffix.length < minStem || !norm.endsWith(suffix)) continue;
      pushIds(out, '~' + norm.slice(0, norm.length - suffix.length), 1, anyClass);
    }
    pushIds(out, '~' + norm, 1, anyClass);
    for (const suffix of inflection.englishSuffixes) {
      if (norm.length - suffix.length < minStem || !norm.endsWith(suffix)) continue;
      pushIds(out, norm.slice(0, norm.length - suffix.length), 1, isEnglishClass);
    }
    for (const [cls, rules] of suffixRules) {
      const sameClass = (c: number): boolean => c === cls;
      for (const [suffix, replacement] of rules) {
        if (!norm.endsWith(suffix)) continue;
        const stem = norm.length - suffix.length;
        if (stem < (replacement ? minStem - 1 : minStem)) continue;
        pushIds(out, norm.slice(0, stem) + replacement, 1, sameClass);
      }
    }
    return out.length ? out : EMPTY;
  }

  function candidates(raw: string, norm: string): number[] {
    let c = candidateCache.get(raw);
    if (c === undefined) {
      if (candidateCache.size > CACHE_LIMIT) candidateCache = new Map();
      c = computeCandidates(raw, norm);
      candidateCache.set(raw, c);
    }
    return c;
  }

  /** Best entry that ends at `node`, or -1. `compact` is the matched text without separators. */
  function bestEntry(node: number, compact: () => string, plainOnly: boolean): number {
    let best = -1;
    let bestRank = 0;
    for (let e = nodeHead[node] as number; e >= 0; e = entryNext[e] as number) {
      const flags = entryFlags[e] as number;
      if (flags & F_EXACT) {
        if (plainOnly || entryRaw.get(e) !== compact()) continue;
      }
      const concept = entryConcept[e] as number;
      // pack rank, then label before synonym, then pack order of the concepts
      const rank = (packRank[conceptPack[concept] as number] as number) * 2 + (flags & F_LABEL ? 0 : 1);
      if (best < 0 || rank < bestRank || (rank === bestRank && concept < (entryConcept[best] as number))) {
        best = e;
        bestRank = rank;
      }
    }
    return best;
  }

  /** A single-word, non-exact dictionary noun reachable from the candidates, as [entry, inflected] or null. */
  function nounEntry(cands: number[]): [number, number] | null {
    let found: [number, number] | null = null;
    for (let i = 0; i < cands.length; i += 2) {
      const id = cands[i] as number;
      if (tokenClass[id] !== C_DE_NOUN) continue;
      const node = rootNext[id] as number;
      if (!node) continue;
      const entry = bestEntry(node, () => '', true);
      if (entry < 0) continue;
      if (!found || (cands[i + 1] as number) < found[1]) found = [entry, cands[i + 1] as number];
    }
    return found;
  }

  /**
   * "Unterlappenpneumonie" → Unterlappen + Pneumonie. Only when both halves are dictionary nouns,
   * so ordinary compounds stay untouched. Result: [cut, leftEntry, rightEntry] (cut in raw chars).
   */
  function splitCompound(raw: string): number[] | null {
    let cached = compoundCache.get(raw);
    if (cached !== undefined) return cached;
    cached = null;
    // Offsets of the halves must map back to the raw word: per-character normalisation lengths.
    const ends: number[] = [];
    let norm = '';
    for (const ch of raw) {
      norm += normalizeToken(ch);
      ends.push(norm.length);
    }
    let bestScore = -1;
    for (let k = 0, rawCut = 0; k < ends.length - 1; k++) {
      rawCut += (raw.codePointAt(rawCut) as number) > 0xffff ? 2 : 1;
      const cut = ends[k] as number;
      if (cut < minStem || norm.length - cut < minStem) continue;
      const left = nounEntry(computeCandidates('A' + norm.slice(0, cut), norm.slice(0, cut)));
      if (!left) continue;
      const right = nounEntry(computeCandidates('A' + raw.slice(rawCut), norm.slice(cut)));
      if (!right) continue;
      const score = 4 - 2 * left[1] - right[1] + cut / 1000;
      if (score > bestScore) {
        bestScore = score;
        cached = [rawCut, left[0], right[0]];
      }
    }
    if (compoundCache.size > CACHE_LIMIT) compoundCache = new Map();
    compoundCache.set(raw, cached);
    return cached;
  }

  function conceptId(concept: number): string {
    let id = conceptIds[concept];
    if (id === undefined) {
      id = `${(packs[conceptPack[concept] as number] as TermPack).id}:${(conceptRef[concept] as PackConcept).id}`;
      conceptIds[concept] = id;
    }
    return id;
  }

  function annotation(text: string, from: number, to: number, entry: number, confidence: number, source: string): Annotation {
    const index = entryConcept[entry] as number;
    const concept = conceptRef[index] as PackConcept;
    const a: Annotation = {
      from,
      to,
      text: text.slice(from, to),
      conceptId: conceptId(index),
      label: concept.label,
      type: concept.type,
      source,
      confidence,
    };
    if (concept.codes && concept.codes.length) a.codes = concept.codes;
    return a;
  }

  function match(text: string, matchOptions?: { source?: string }): Annotation[] {
    const source = matchOptions?.source ?? defaultSource;
    const tokens = tokenize(text);
    const n = tokens.length;
    if (n === 0 || entryConcept.length === 0) return [];

    // Candidate matches as parallel arrays: first token, last token, entry, inflected.
    const mFirst: number[] = [];
    const mLast: number[] = [];
    const mEntry: number[] = [];
    const mInflected: number[] = [];
    const stack: number[] = [];

    for (let i = 0; i < n; i++) {
      stack.length = 0;
      stack.push(0, i, 0);
      while (stack.length > 0) {
        const inflected = stack.pop() as number;
        const j = stack.pop() as number;
        const node = stack.pop() as number;
        if (j >= n) continue;
        if (j > i && (tokens[j] as Token).gap === GAP_HARD) continue;
        // One token, or up to three tokens glued by hyphens taken as one word.
        let raw = '';
        let norm = '';
        for (let width = 1; width <= 3 && j + width <= n; width++) {
          const t = tokens[j + width - 1] as Token;
          if (width > 1 && t.gap !== GAP_JOIN) break;
          raw += t.raw;
          norm += t.norm;
          const cands = candidates(raw, norm);
          for (let c = 0; c < cands.length; c += 2) {
            const id = cands[c] as number;
            const next = node === 0 ? (rootNext[id] as number) : trans.get(node * STRIDE + id);
            if (!next) continue;
            const flag = inflected | (cands[c + 1] as number);
            const last = j + width - 1;
            if ((nodeHead[next] as number) >= 0) {
              const entry = bestEntry(
                next,
                () => {
                  let s = '';
                  for (let k = i; k <= last; k++) s += (tokens[k] as Token).raw;
                  return caseKey(s);
                },
                false,
              );
              if (entry >= 0) {
                mFirst.push(i);
                mLast.push(last);
                mEntry.push(entry);
                mInflected.push(flag);
              }
            }
            stack.push(next, last + 1, flag);
          }
        }
      }
    }

    // Longest match wins, then the stronger pack, then the earlier position.
    const rankOf = (m: number): number => {
      const entry = mEntry[m] as number;
      return (packRank[conceptPack[entryConcept[entry] as number] as number] as number) * 2 + ((entryFlags[entry] as number) & F_LABEL ? 0 : 1);
    };
    const lengthOf = (m: number): number => (tokens[mLast[m] as number] as Token).to - (tokens[mFirst[m] as number] as Token).from;
    const orderOfMatches = mFirst.map((_, m) => m);
    orderOfMatches.sort(
      (a, b) =>
        lengthOf(b) - lengthOf(a) ||
        rankOf(a) - rankOf(b) ||
        (mFirst[a] as number) - (mFirst[b] as number) ||
        (mInflected[a] as number) - (mInflected[b] as number) ||
        (mEntry[a] as number) - (mEntry[b] as number),
    );
    const taken = new Uint8Array(n);
    const out: Annotation[] = [];
    for (const m of orderOfMatches) {
      const first = mFirst[m] as number;
      const last = mLast[m] as number;
      if (taken[first] === 1 || taken[last] === 1) continue;
      taken.fill(1, first, last + 1);
      const entry = mEntry[m] as number;
      let confidence = (entryFlags[entry] as number) & F_LABEL ? 0.97 : 0.92;
      if (mInflected[m]) confidence -= 0.02;
      out.push(annotation(text, (tokens[first] as Token).from, (tokens[last] as Token).to, entry, confidence, source));
    }

    if (compounds && inflection) {
      for (let i = 0; i < n; i++) {
        if (taken[i] === 1) continue;
        const t = tokens[i] as Token;
        if (t.raw.length < 2 * minStem || !isUpperInitial(t.raw) || !isAllLetters(t.raw)) continue;
        const parts = splitCompound(t.raw);
        if (!parts) continue;
        const cut = t.from + (parts[0] as number);
        out.push(annotation(text, t.from, cut, parts[1] as number, 0.8, source));
        out.push(annotation(text, cut, t.to, parts[2] as number, 0.8, source));
      }
    }

    out.sort((a, b) => a.from - b.from);
    return context ? context.annotate(text, out) : out;
  }

  stats.buildMs = Math.round((now() - started) * 100) / 100;
  return { match, stats };
}
