/**
 * Context rules: assertion (negated / uncertain) and laterality of a mention, derived from
 * trigger phrases in the same clause. The rules are plain data so that callers can extend or
 * replace them; the defaults cover German clinical / radiology prose plus basic English.
 */
import type { Annotation, Assertion, ConceptType, Laterality } from '../types.ts';

/**
 * A plain phrase (case-insensitive, whole words, flexible whitespace, a "." also matches with
 * following blanks so `v.a.` covers "V. a.") or `{ re }` with a regular expression source
 * (flags `iu`; no named groups). The same trigger may be listed for several roles.
 */
export type ContextTrigger = string | { re: string };

export interface ContextRules {
  /** Triggers standing before the mention: "kein Erguss". */
  negationBefore: ContextTrigger[];
  /** Triggers standing after the mention: "Erguss nicht nachweisbar". */
  negationAfter: ContextTrigger[];
  uncertainBefore: ContextTrigger[];
  uncertainAfter: ContextTrigger[];
  /**
   * Uncertainty triggers that introduce an enumeration ("DD", "differential diagnosis"): they
   * reach across commas to every mention up to the end of the sentence. Ordinary triggers stop
   * at a comma, because in telegram style the next clause is a new statement.
   */
  listBefore?: ContextTrigger[];
  /** Phrases that look like a trigger but are none ("nicht nur"); they win over shorter triggers. */
  pseudo: ContextTrigger[];
  /** Words that end the scope of a trigger inside a clause ("aber", "jedoch", "bei"). */
  scopeBreakers: string[];
  /** Lower-case abbreviations whose trailing dot is not a sentence end ("bds", "ca"). */
  abbreviations: string[];
  /** Regular expression sources, matched case-insensitively as whole words. */
  laterality: Record<Laterality, string[]>;
  /** Concept types that get an `assertion`. */
  assertionTypes: ConceptType[];
  /** Concept types that get a `laterality`. */
  lateralityTypes: ConceptType[];
  /** Max. distance in characters between a trigger and the mention. */
  beforeWindow: number;
  afterWindow: number;
  lateralityWindow: number;
}

const DE_ADJ = '(?:e|er|es|en|em)?';
// Shared objects: a trigger listed with the same source on both sides works in both directions.
const FRAGLICH: ContextTrigger = { re: 'fraglich' + DE_ADJ };
const MOEGLICH: ContextTrigger = { re: 'möglich' + DE_ADJ };
const WAHRSCHEINLICH: ContextTrigger = { re: 'wahrscheinlich' + DE_ADJ };

export const GERMAN_CONTEXT_RULES: ContextRules = {
  negationBefore: [
    // "kein sicherer Hinweis auf", "keine Zeichen einer", "kein Nachweis von", "kein Anhalt für"
    {
      re: `kein${DE_ADJ}(?:\\s+[\\p{L}]+${DE_ADJ}){0,2}\\s+(?:hinweis${DE_ADJ}|anhalt|nachweis|zeichen|verdacht|anzeichen)(?:\\s+(?:auf|für|fuer|von|eine[rsmn]?|de[rsmn]))*`,
    },
    { re: 'kein(?:e|er|es|en|em)?' },
    'ohne',
    'ohne hinweis auf',
    'ohne nachweis',
    'ohne nachweis von',
    'ohne nachweis einer',
    'ohne nachweis eines',
    'ohne zeichen einer',
    'ohne zeichen eines',
    'ohne anhalt für',
    'ausschluss von',
    'weder',
    'frei von',
    'negativ für',
    'negativ auf',
  ],
  negationAfter: [
    { re: 'nicht(?:\\s+mehr)?\\s+(?:nachweisbar|nachgewiesen|erkennbar|abgrenzbar|darstellbar|vorhanden|zu\\s+erkennen|zu\\s+sehen|gegeben)' },
    { re: '(?:ist|sind|wurde|wurden|war)?\\s*ausgeschlossen' },
    'liegt nicht vor',
    'liegen nicht vor',
    'besteht nicht',
    'bestehen nicht',
    'zeigt sich nicht',
    'zeigen sich nicht',
    'findet sich nicht',
    'finden sich nicht',
    'negativ',
    // A bare "nicht" only counts when it closes the clause: "Eine Fraktur zeigt sich nicht."
    { re: 'nicht(?=\\s*(?:[.,;!?\\n]|$))' },
  ],
  uncertainBefore: [
    'verdacht auf',
    'v.a.',
    'verdächtig auf',
    'verdächtig für',
    'suspekt auf',
    'suspekt für',
    'dd',
    'differentialdiagnose',
    'differenzialdiagnose',
    'differentialdiagnostisch',
    'differenzialdiagnostisch',
    FRAGLICH,
    MOEGLICH,
    'möglicherweise',
    WAHRSCHEINLICH,
    { re: 'vermutlich' + DE_ADJ },
    { re: 'unsicher' + DE_ADJ },
    { re: 'unklar' + DE_ADJ },
    'eventuell',
    'evtl.',
    'ggf.',
    'vereinbar mit',
    'passend zu',
    'am ehesten',
    'zum ausschluss',
    'z.a.',
    'ausschluss',
    'frage nach',
    'fragestellung',
    'nicht sicher',
    'nicht eindeutig',
  ],
  uncertainAfter: [
    { re: '(?:ist|sind|bleibt|bleiben|wäre|waere)?\\s*(?:nicht|kaum)\\s+(?:sicher\\s+|gänzlich\\s+|ganz\\s+|vollständig\\s+)?(?:auszuschlie(?:ß|ss)en|ausgeschlossen|ausschlie(?:ß|ss)bar)' },
    MOEGLICH,
    'denkbar',
    FRAGLICH,
    WAHRSCHEINLICH,
    'unwahrscheinlich',
    'zu diskutieren',
    'in erster linie',
    'kann nicht ausgeschlossen werden',
    'können nicht ausgeschlossen werden',
    '?',
  ],
  listBefore: ['DD', 'Differentialdiagnose', 'Differentialdiagnosen', 'Differenzialdiagnose', 'Differenzialdiagnosen', 'differentialdiagnostisch', 'differenzialdiagnostisch'],
  pseudo: ['nicht nur', 'ohne weiteres', 'ohne zweifel', 'kein zweifel', 'nicht zuletzt', 'nach wie vor'],
  scopeBreakers: ['aber', 'jedoch', 'hingegen', 'dagegen', 'allerdings', 'sondern', 'bei', 'wegen', 'aufgrund', 'infolge', 'trotz'],
  abbreviations: [
    'v', 'a', 'z', 'n', 'b', 'd', 'i', 'e', 's', 'u', 'o', 'ca', 'bds', 'bzw', 'ggf', 'evtl', 'inkl', 'exkl', 'li', 're',
    'lig', 'art', 'med', 'lat', 'ant', 'post', 'sup', 'inf', 'prox', 'dist', 'max', 'min', 'mind', 'vgl', 'dr', 'prof',
    'nr', 'abb', 'sog', 'usw', 'etc', 'zb', 'st', 'str', 'tel', 'geb', 'pat',
  ],
  laterality: {
    bilateral: ['beidseits', 'beiderseits', 'beidseitig' + DE_ADJ, 'bilateral' + DE_ADJ, 'bds\\.?', 'bipulmonal' + DE_ADJ, 'beide[rn]?'],
    left: [
      'links',
      'link(?:e|er|em|es|en)',
      'li\\.',
      'links(?:seitig|basal|apikal|lateral|zentral|betont|thorakal|frontal|temporal|parietal|okzipital|hemisphärisch|hilär|pulmonal|zervikal)' + DE_ADJ,
      'sinist(?:er|ra|rum|ri|rae)',
      'sinistral' + DE_ADJ,
    ],
    right: [
      'rechts',
      'recht(?:e|er|em|es|en)',
      're\\.',
      'rechts(?:seitig|basal|apikal|lateral|zentral|betont|thorakal|frontal|temporal|parietal|okzipital|hemisphärisch|hilär|pulmonal|zervikal)' + DE_ADJ,
      'dext(?:er|ra|rum|ri|rae)',
      'dextral' + DE_ADJ,
    ],
  },
  assertionTypes: ['disease', 'symptom', 'finding'],
  lateralityTypes: ['anatomy', 'disease', 'symptom', 'finding', 'procedure'],
  beforeWindow: 96,
  afterWindow: 64,
  lateralityWindow: 72,
};

export const ENGLISH_CONTEXT_RULES: ContextRules = {
  negationBefore: [
    { re: 'no(?:\\s+[a-z]+){0,2}\\s+(?:evidence|sign|signs|finding|findings|suspicion)\\s+(?:of|for)' },
    'no',
    'without',
    'without evidence of',
    'negative for',
    'free of',
    'absence of',
    'denies',
    'denied',
  ],
  negationAfter: [
    { re: '(?:is|are|was|were|has\\s+been|have\\s+been)?\\s*(?:ruled\\s+out|excluded|absent)' },
    { re: '(?:is|are|was|were)?\\s*not\\s+(?:seen|identified|present|detected|visualized|visualised|demonstrated|evident)' },
    'negative',
  ],
  uncertainBefore: [
    'suspected',
    'suspicion of',
    'suspicious for',
    'possible',
    'possibly',
    'probable',
    'probably',
    'likely',
    'questionable',
    'presumed',
    'consistent with',
    'compatible with',
    'concerning for',
    'rule out',
    'r/o',
    'differential diagnosis',
    'may represent',
    'could represent',
    'not excluded',
  ],
  uncertainAfter: [
    { re: '(?:can\\s*not|cannot|could\\s+not|can\\s+not)\\s+be\\s+(?:excluded|ruled\\s+out)' },
    { re: '(?:is|are)\\s+(?:possible|suspected|likely|not\\s+excluded)' },
    'not excluded',
  ],
  listBefore: ['differential diagnosis', 'differential diagnoses', 'differential', 'DDx'],
  pseudo: ['not only', 'no increase', 'no change', 'no further', 'not certain if', 'without difficulty'],
  scopeBreakers: ['but', 'however', 'although', 'though', 'except', 'apart from', 'because', 'due to'],
  abbreviations: ['dr', 'mr', 'mrs', 'ms', 'vs', 'e', 'g', 'i', 'no', 'fig', 'approx', 'lt', 'rt'],
  laterality: {
    bilateral: ['bilateral(?:ly)?', 'both', 'bibasilar', 'bibasal'],
    left: ['left', 'left-sided', 'lt\\.'],
    right: ['right', 'right-sided', 'rt\\.'],
  },
  assertionTypes: ['disease', 'symptom', 'finding'],
  lateralityTypes: ['anatomy', 'disease', 'symptom', 'finding', 'procedure'],
  beforeWindow: 96,
  afterWindow: 64,
  lateralityWindow: 72,
};

/**
 * French report style. Triggers ending in an elided article ("pas d'", "absence d'") are listed
 * without the apostrophe: it is not a word character, so the bare "d" already ends the trigger.
 * Accented letters are written as classes because reports are often typed without accents.
 */
export const FRENCH_CONTEXT_RULES: ContextRules = {
  negationBefore: [
    { re: '(?:pas|absence|sans)\\s+(?:de\\s+|d[\'’]\\s*)?(?:signes?|arguments?|[ée]l[ée]ments?|anomalies?)\\s+(?:en\\s+faveur\\s+)?(?:de\\s|d[\'’]|pour\\s)' },
    'pas de',
    'pas d',
    'absence de',
    'absence d',
    'sans',
    'aucun',
    'aucune',
    'ni',
    { re: '[ée]limin(?:e|ant)' },
    { re: 'exclu(?:t|ant)' },
  ],
  negationAfter: [
    { re: '(?:est|sont)?\\s*(?:absente?s?|exclue?s?|[ée]limin[ée]e?s?)' },
    { re: '(?:n[\'’]est|ne\\s+sont)\\s+pas\\s+(?:visible|visualis[ée]|retrouv[ée]|identifi[ée]|mis)\\p{L}*' },
    { re: 'non\\s+(?:visible|visualis[ée]|retrouv[ée]|identifi[ée]|d[ée]cel[ée])\\p{L}*' },
  ],
  uncertainBefore: [
    'suspicion de',
    'suspicion d',
    { re: 'suspecte?s?\\s+d(?:e\\s|[\'’])' },
    'possible',
    'possibles',
    'probable',
    'probables',
    'probablement',
    { re: '[ée]vocat(?:eur|rice)s?\\s+d(?:e\\s|[\'’])' },
    { re: '[ée]voquant' },
    'compatible avec',
    'compatibles avec',
    { re: 'douteu(?:x|se)s?' },
    { re: '[ée]ventuel(?:le)?s?' },
    'diagnostic différentiel',
    'diagnostic differentiel',
    'DD',
    { re: '[àa]\\s+confronter' },
  ],
  uncertainAfter: [
    { re: 'ne\\s+peu(?:t|vent)\\s+(?:pas\\s+)?[êe]tre\\s+(?:formellement\\s+)?(?:exclue?s?|[ée]limin[ée]e?s?)' },
    { re: '(?:est|sont)\\s+(?:possibles?|probables?|suspect[ée]e?s?)' },
    { re: '[àa]\\s+confirmer' },
    { re: 'non\\s+(?:exclue?s?|[ée]limin[ée]e?s?)' },
  ],
  listBefore: ['diagnostic différentiel', 'diagnostic differentiel', 'diagnostics différentiels', 'DD'],
  pseudo: ['sans changement', 'sans modification', 'pas de changement', 'pas de modification', 'pas seulement', 'sans injection', 'sans produit de contraste', 'sans particularité'],
  scopeBreakers: ['mais', 'cependant', 'toutefois', 'hormis', 'sauf', 'en dehors de', 'en raison de', 'avec'],
  abbreviations: ['dr', 'pr', 'mme', 'm', 'cf', 'env', 'dt', 'g'],
  laterality: {
    bilateral: ['bilat[ée]ra(?:l|le|ux|les)', 'bilat[ée]ralement', 'des\\s+deux\\s+c[ôo]t[ée]s'],
    left: ['gauches?'],
    right: ['droite?s?'],
  },
  assertionTypes: ['disease', 'symptom', 'finding'],
  lateralityTypes: ['anatomy', 'disease', 'symptom', 'finding', 'procedure'],
  beforeWindow: 96,
  afterWindow: 64,
  lateralityWindow: 72,
};

function union<T>(a: readonly T[], b: readonly T[]): T[] {
  return [...new Set([...a, ...b])];
}

/** Combines rule sets; lists are concatenated, windows take the larger value. */
export function mergeContextRules(...sets: ContextRules[]): ContextRules {
  const [first, ...rest] = sets;
  if (!first) throw new Error('mergeContextRules needs at least one rule set');
  let out: ContextRules = { ...first, laterality: { ...first.laterality } };
  for (const r of rest) {
    out = {
      negationBefore: [...out.negationBefore, ...r.negationBefore],
      negationAfter: [...out.negationAfter, ...r.negationAfter],
      uncertainBefore: [...out.uncertainBefore, ...r.uncertainBefore],
      uncertainAfter: [...out.uncertainAfter, ...r.uncertainAfter],
      listBefore: [...(out.listBefore ?? []), ...(r.listBefore ?? [])],
      pseudo: [...out.pseudo, ...r.pseudo],
      scopeBreakers: union(out.scopeBreakers, r.scopeBreakers),
      abbreviations: union(out.abbreviations, r.abbreviations),
      laterality: {
        left: union(out.laterality.left, r.laterality.left),
        right: union(out.laterality.right, r.laterality.right),
        bilateral: union(out.laterality.bilateral, r.laterality.bilateral),
      },
      assertionTypes: union(out.assertionTypes, r.assertionTypes),
      lateralityTypes: union(out.lateralityTypes, r.lateralityTypes),
      beforeWindow: Math.max(out.beforeWindow, r.beforeWindow),
      afterWindow: Math.max(out.afterWindow, r.afterWindow),
      lateralityWindow: Math.max(out.lateralityWindow, r.lateralityWindow),
    };
  }
  return out;
}

export const DEFAULT_CONTEXT_RULES: ContextRules = mergeContextRules(GERMAN_CONTEXT_RULES, ENGLISH_CONTEXT_RULES);

// ---------------------------------------------------------------------------------------------

// Bit set: one phrase can act in several roles ("möglich" before and after the mention).
const K_PSEUDO = 0;
const K_NEG_BEFORE = 1;
const K_NEG_AFTER = 2;
const K_UNC_BEFORE = 4;
const K_UNC_AFTER = 8;
const K_LIST = 16;
/** How far a list trigger reaches, in characters. */
const LIST_WINDOW = 240;

interface Span {
  from: number;
  to: number;
  kind: number;
}

export interface ContextAnnotator {
  /** Sets `assertion` / `laterality` on the annotations (in place) and returns them. */
  annotate(text: string, annotations: Annotation[]): Annotation[];
}

const WORD = '[\\p{L}\\p{N}]';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function triggerSource(trigger: ContextTrigger): { source: string; weight: number } {
  if (typeof trigger !== 'string') return { source: trigger.re, weight: 1000 + trigger.re.length };
  const source = trigger
    .trim()
    .split(/\s+/)
    .map((word) => escapeRe(word).replace(/\\\./g, '\\.[ \\t]*'))
    .join('\\s+');
  return { source, weight: trigger.length };
}

export function createContextAnnotator(rules: ContextRules = DEFAULT_CONTEXT_RULES): ContextAnnotator {
  // One alternation over all triggers, regex triggers first, then phrases longest first, so that
  // "nicht auszuschließen" (uncertain) is consumed before a shorter negation can see its "nicht".
  const bySource = new Map<string, { source: string; weight: number; kind: number }>();
  const add = (list: ContextTrigger[], kind: number): void => {
    for (const t of list) {
      const compiled = triggerSource(t);
      // Matching ignores case, so "dd" and "DD" are one trigger and share their kinds.
      const key = compiled.source.toLowerCase();
      const known = bySource.get(key);
      if (known) known.kind |= kind;
      else bySource.set(key, { ...compiled, kind });
    }
  };
  add(rules.pseudo, K_PSEUDO);
  add(rules.negationBefore, K_NEG_BEFORE);
  add(rules.negationAfter, K_NEG_AFTER);
  add(rules.uncertainBefore, K_UNC_BEFORE);
  add(rules.uncertainAfter, K_UNC_AFTER);
  add(rules.listBefore ?? [], K_UNC_BEFORE | K_LIST);
  const all = [...bySource.values()].sort((a, b) => b.weight - a.weight);
  const bounded = (source: string, index: number): string => {
    // Word boundaries only where the trigger itself starts / ends with a word character.
    const left = /^[\p{L}\p{N}(\[]/u.test(source) ? `(?<!${WORD})` : '';
    const right = /[\p{L}\p{N})\]?*+]$/u.test(source) && !source.endsWith('\\?') && !source.endsWith('\\.[ \\t]*') ? `(?!${WORD})` : '';
    return `(?<t${index}>${left}(?:${source})${right})`;
  };
  const triggerRe = all.length ? new RegExp(all.map((t, i) => bounded(t.source, i)).join('|'), 'giu') : null;

  const breakerRe = rules.scopeBreakers.length
    ? new RegExp(`(?<!${WORD})(?:${rules.scopeBreakers.map((w) => escapeRe(w).replace(/ /g, '\\s+')).join('|')})(?!${WORD})`, 'giu')
    : null;
  const abbreviations = new Set(rules.abbreviations.map((a) => a.toLowerCase()));

  const sideRe = (side: Laterality): RegExp =>
    new RegExp(`(?<!${WORD})(?:${rules.laterality[side].join('|')})(?!${WORD})`, 'giu');
  const lateralityRes: [Laterality, RegExp][] = [
    ['bilateral', sideRe('bilateral')],
    ['left', sideRe('left')],
    ['right', sideRe('right')],
  ];
  const assertionTypes = new Set<ConceptType>(rules.assertionTypes);
  const lateralityTypes = new Set<ConceptType>(rules.lateralityTypes);

  function findTriggers(text: string): Span[] {
    const out: Span[] = [];
    if (!triggerRe) return out;
    triggerRe.lastIndex = 0;
    for (let m = triggerRe.exec(text); m !== null; m = triggerRe.exec(text)) {
      if (m[0].length === 0) {
        triggerRe.lastIndex++;
        continue;
      }
      let kind = K_PSEUDO;
      const groups = m.groups ?? {};
      for (let i = 0; i < all.length; i++) {
        if (groups[`t${i}`] !== undefined) {
          kind = (all[i] as { kind: number }).kind;
          break;
        }
      }
      // Leading blanks belong to optional auxiliaries ("ist ausgeschlossen"); trim them off.
      const lead = m[0].length - m[0].trimStart().length;
      out.push({ from: m.index + lead, to: m.index + m[0].length, kind });
    }
    return out;
  }

  function isSentenceDot(text: string, i: number): boolean {
    const next = text.charCodeAt(i + 1);
    // Dots inside dates, decimals and "V.a." are not followed by white space.
    if (!Number.isNaN(next) && next !== 0x20 && next !== 0x0a && next !== 0x0d && next !== 0x09 && next !== 0xa0) return false;
    let start = i;
    while (start > 0 && /[\p{L}\p{N}]/u.test(text.charAt(start - 1))) start--;
    const word = text.slice(start, i).toLowerCase();
    if (word.length === 0) return true;
    if (/^\p{L}$/u.test(word)) return false;
    return !abbreviations.has(word);
  }

  function findBoundaries(text: string, triggers: Span[]): number[] {
    const raw: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x2c || c === 0x3b || c === 0x21 || c === 0x3f || c === 0x0a) raw.push(i);
      else if (c === 0x2e && isSentenceDot(text, i)) raw.push(i);
    }
    if (breakerRe) {
      breakerRe.lastIndex = 0;
      for (let m = breakerRe.exec(text); m !== null; m = breakerRe.exec(text)) raw.push(m.index);
      raw.sort((a, b) => a - b);
    }
    // Punctuation that is part of a trigger ("v.a.", "?", "evtl.") must not split the clause in
    // front of the trigger; the trigger's last character may still close it.
    const out: number[] = [];
    let t = 0;
    for (const pos of raw) {
      while (t < triggers.length && (triggers[t] as Span).to <= pos) t++;
      const trig = triggers[t];
      if (trig && trig.from <= pos && pos < trig.to - 1) continue;
      out.push(pos);
    }
    return out;
  }

  function crossesSentenceEnd(text: string, from: number, to: number): boolean {
    for (let i = from; i < to; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x3b || c === 0x21 || c === 0x3f || c === 0x0a) return true;
      if (c === 0x2e && isSentenceDot(text, i)) return true;
    }
    return false;
  }

  /** Index of the first element `>= value`. */
  function lowerBound(sorted: number[], value: number): number {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sorted[mid] as number) < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function annotate(text: string, annotations: Annotation[]): Annotation[] {
    if (annotations.length === 0) return annotations;
    const triggers = findTriggers(text);
    const boundaries = findBoundaries(text, triggers);
    const triggerStarts = triggers.map((t) => t.from);

    const sides: { from: number; to: number; side: Laterality }[] = [];
    for (const [side, re] of lateralityRes) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        sides.push({ from: m.index, to: m.index + m[0].length, side });
      }
    }
    sides.sort((a, b) => a.from - b.from);
    const sideStarts = sides.map((s) => s.from);

    for (const a of annotations) {
      const wantsAssertion = assertionTypes.has(a.type);
      const wantsSide = lateralityTypes.has(a.type);
      if (!wantsAssertion && !wantsSide) continue;

      const bi = lowerBound(boundaries, a.from);
      const prev = bi > 0 ? (boundaries[bi - 1] as number) : -1;
      // A boundary strictly inside the mention ("A. carotis") does not end its clause.
      const ei = lowerBound(boundaries, a.to);
      const clauseStart = prev + 1;
      const clauseEnd = ei < boundaries.length ? (boundaries[ei] as number) : text.length;

      if (wantsAssertion) {
        let assertion: Assertion = 'present';
        const minFrom = Math.max(clauseStart, a.from - rules.beforeWindow);
        // Nearest trigger in front of the mention wins.
        let decided = false;
        for (let i = lowerBound(triggerStarts, a.from) - 1; i >= 0; i--) {
          const t = triggers[i] as Span;
          if (t.from < minFrom) break;
          if (t.to > a.from) continue;
          if (t.kind & K_UNC_BEFORE) assertion = 'uncertain';
          else if (t.kind & K_NEG_BEFORE) assertion = 'negated';
          else continue;
          decided = true;
          break;
        }
        if (!decided) {
          // The closing "?" of a clause is a trigger itself, so the window is inclusive.
          const maxTo = Math.min(clauseEnd + 1, a.to + rules.afterWindow);
          for (let i = lowerBound(triggerStarts, a.to); i < triggers.length; i++) {
            const t = triggers[i] as Span;
            if (t.to > maxTo) break;
            if (t.kind & K_UNC_AFTER) assertion = 'uncertain';
            else if (t.kind & K_NEG_AFTER) assertion = 'negated';
            else continue;
            break;
          }
        }
        if (assertion === 'present') {
          // "DD A, B, C": a list trigger earlier in the same sentence covers every item.
          for (let i = lowerBound(triggerStarts, clauseStart) - 1; i >= 0; i--) {
            const t = triggers[i] as Span;
            if (a.from - t.to > LIST_WINDOW) break;
            if (!(t.kind & K_LIST)) continue;
            if (!crossesSentenceEnd(text, t.to, a.from)) assertion = 'uncertain';
            break;
          }
        }
        a.assertion = assertion;
      }

      if (wantsSide && sides.length > 0) {
        const lo = Math.max(clauseStart, a.from - rules.lateralityWindow);
        const hi = Math.min(clauseEnd, a.to + rules.lateralityWindow);
        let best: Laterality | undefined;
        let bestDistance = Infinity;
        for (let i = lowerBound(sideStarts, lo); i < sides.length; i++) {
          const s = sides[i] as { from: number; to: number; side: Laterality };
          if (s.from >= hi) break;
          if (s.to > hi) continue;
          const distance = Math.max(a.from - s.to, s.from - a.to, 0);
          if (distance < bestDistance || (distance === bestDistance && s.side === 'bilateral')) {
            best = s.side;
            bestDistance = distance;
          }
        }
        if (best) a.laterality = best;
      }
    }
    return annotations;
  }

  return { annotate };
}
