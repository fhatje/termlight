/**
 * Shared query understanding of the research sources: which substance / concept a question is
 * about (resolved to English and codes through the term bridge), which label sections it asks
 * for, and how to rank and size passages accordingly.
 */
import type { CallOptions, ResearchQuery, SourceDocument } from '../../core/types.ts';
import { isDrug } from '../lookup/resolve.ts';
import type { TermResolver, TermVariants } from '../lookup/resolve.ts';
import { raceSignal } from '../shared/http.ts';
import { chunkText, fold, unique } from '../shared/text.ts';

export type Topic =
  | 'contraindications'
  | 'dosage'
  | 'interactions'
  | 'adverse'
  | 'pregnancy'
  | 'indications'
  | 'warnings'
  | 'overdose'
  | 'pharmacokinetics'
  | 'mechanism'
  | 'renal'
  | 'hepatic'
  | 'pediatric'
  | 'therapy'
  | 'diagnosis';

interface TopicRule {
  /** Matches the (folded) question. */
  ask: RegExp;
  /** Matches (folded) section headings in German and English that answer the topic. */
  heading?: RegExp;
  /** Matches (folded) body text; counts as weaker evidence than a heading. */
  text?: RegExp;
  /** Clinical context ("Niereninsuffizienz") rather than a label section: also kept as search term. */
  context?: boolean;
  /** Boolean expression for literature databases (Europe PMC and PubMed syntax). */
  en: string;
}

// All patterns run against `fold()`ed text: lower case, no umlauts (ä → a), ß → ss.
const TOPICS: Record<Topic, TopicRule> = {
  contraindications: {
    ask: /kontraindi|gegenanzeig|contraindic|contre-?indic|nicht (anwenden|geben|einnehmen)|darf nicht/,
    heading: /kontraindikation|gegenanzeige|contraindication|contre-?indication|do not use|nicht angewendet werden/,
    text: /kontraindiziert|contraindicated/,
    en: '(contraindications OR contraindication OR contraindicated)',
  },
  dosage: {
    ask: /dosier|dosis|\bdose\b|dosage|dosing|posolog/,
    heading: /(^|[^a-z])(dosierung|dosage|dosis|directions|posology)|wie verwenden sie/,
    en: '(dosage OR dose OR dosing)',
  },
  interactions: {
    ask: /wechselwirk|interakt|interact|interaction|kombination|zusammen mit/,
    heading: /interaktion|wechselwirkung|interaction/,
    en: '(interaction OR interactions)',
  },
  adverse: {
    ask: /nebenwirk|unerwunscht|\buaw\b|adverse|side effect|effets? (indesirable|secondaire)/,
    heading: /nebenwirkung|unerwunschte wirkung|adverse reaction|side effect|effets indesirables/,
    en: '("adverse effects" OR "adverse events" OR "side effects" OR safety)',
  },
  pregnancy: {
    ask: /schwanger|stillzeit|stillen|pregnan|lactat|breastfeed|breast-feed|graviditat|grossesse|allaitement|enceinte/,
    heading: /schwangerschaft|stillzeit|pregnan|nursing|lactation|breast|grossesse|allaitement/,
    en: '(pregnancy OR lactation OR breastfeeding)',
  },
  indications: {
    ask: /(^|[^a-z])(indikation|anwendungsgebiet|indication|wofur|wann wird)/,
    heading: /(^|[^a-z])(indikation|anwendungsgebiet|anwendungsmoglichkeit|indications|uses|wann wird es angewendet)/,
    en: '(indication OR indications OR efficacy)',
  },
  warnings: {
    ask: /warnhinweis|vorsicht|warning|precaution/,
    heading: /warnhinweis|vorsicht|warning|precaution|ask a doctor/,
    en: '(warning OR precautions OR safety)',
  },
  overdose: {
    ask: /uberdosier|intoxik|vergiftung|overdos/,
    heading: /uberdosierung|overdos/,
    en: '(overdose OR intoxication OR poisoning)',
  },
  pharmacokinetics: {
    ask: /pharmakokinet|halbwertszeit|pharmacokinet|half-life|bioverfugbar/,
    heading: /pharmakokinetik|pharmacokinetic|clinical pharmacology/,
    en: '(pharmacokinetics OR pharmacokinetic)',
  },
  mechanism: {
    ask: /wirkmechanismus|wirkungsweise|wirkungsmechanismus|mechanism/,
    heading: /wirkmechanismus|wirkungsmechanismus|eigenschaften\/wirkungen|wirkungsweise|mechanism of action|pharmacodynamic/,
    en: '("mechanism of action" OR pharmacodynamics)',
  },
  renal: {
    ask: /niereninsuff|nierenfunktion|nierenversagen|nierenschwache|\bnieren?\b|renal|kidney|dialyse|\bgfr\b|\breins?\b/,
    heading: /nierenfunktion|niereninsuff|renal impairment/,
    text: /nierenfunktion|niereninsuff|nierenversagen|\brenal|kidney|dialys|kreatinin|creatinine|\bgfr\b/,
    context: true,
    en: '(renal OR kidney)',
  },
  hepatic: {
    ask: /leberinsuff|leberfunktion|leberzirrhose|\bleber\b|hepatic|hepatisch|liver|hepatique|\bfoie\b/,
    heading: /leberfunktion|leberinsuff|hepatic impairment/,
    text: /leberfunktion|leberinsuff|\bhepat|liver|zirrhose|cirrhosis/,
    context: true,
    en: '(hepatic OR liver)',
  },
  pediatric: {
    ask: /\bkind(er|ern|es)?\b|padiatr|saugling|pediatric|paediatric|children/,
    heading: /pediatric|kinder und jugendliche/,
    text: /\bkinder|saugling|jugendliche|pediatric|children|infants/,
    context: true,
    en: '(pediatric OR paediatric OR children)',
  },
  therapy: {
    ask: /therap|behandlung|treatment|traitement/,
    heading: /therapie|behandlung|treatment|management/,
    en: '(therapy OR treatment OR management)',
  },
  diagnosis: {
    ask: /diagnos/,
    heading: /diagnos/,
    en: '(diagnosis OR diagnostic)',
  },
};

const STOPWORDS = new Set(
  (
    'fur bei mit und oder von der die das den dem des ein eine einer einem einen im in zu zur zum auf als ist sind ' +
    'was wie wann welche welcher welches gibt es nach unter uber gegen wird werden kann konnen patient patienten patientin ' +
    'zwischen sowie auch nicht man darf durfen soll sollte beim vom am an aus um ohne wegen trotz wenn ob dass sich ' +
    'for of the and or with on to what are is how when which a an during between in by from at as can should does do ' +
    'bitte frage fragen info informationen information about uber hinsichtlich bezuglich ' +
    'le la les un une du de des et ou avec sans pour chez dans sur en au aux par quel quelle quels quelles est sont que qui lors pendant'
  ).split(' '),
);

export interface AnalyzedTerm {
  /** As it appears in the question / concept label. */
  raw: string;
  variants: TermVariants;
  drug: boolean;
  /** English name when resolved, otherwise the raw term. */
  english: string;
  /** All known names, folded – for counting mentions in passages. */
  names: string[];
}

export interface QueryAnalysis {
  question: string;
  /** Language of the question. */
  language: string;
  topics: Topic[];
  /** The concept of the query first, then terms of the question in order; at most three. */
  terms: AnalyzedTerm[];
  drugs: AnalyzedTerm[];
  /** Set when the term bridge could not be reached; terms are then unresolved. */
  resolveError?: Error;
}

export function detectTopics(question: string): Topic[] {
  const q = fold(question);
  return (Object.keys(TOPICS) as Topic[]).filter((topic) => TOPICS[topic].ask.test(q));
}

/** Content words of a question that are neither stop words nor topic words. */
export function extractTerms(question: string, skip: string[] = []): string[] {
  const skipFolded = skip.flatMap((s) => fold(s).split(/[^a-z0-9]+/));
  const out: string[] = [];
  for (const token of question.split(/[^\p{L}\p{N}-]+/u)) {
    const word = token.replace(/^-+|-+$/g, '');
    const f = fold(word);
    if (f.length < 3 || STOPWORDS.has(f) || skipFolded.includes(f)) continue;
    // Pure section words ("Kontraindikationen") are no search terms; clinical context words
    // ("Niereninsuffizienz") are both a topic and a term worth resolving.
    if ((Object.values(TOPICS) as TopicRule[]).some((rule) => !rule.context && rule.ask.test(f))) continue;
    out.push(word);
  }
  return unique(out, fold);
}

function toTerm(raw: string, variants: TermVariants): AnalyzedTerm {
  const names = unique(
    [raw, variants.english, ...Object.values(variants.labels ?? {}), ...variants.aliases]
      .filter((n): n is string => !!n)
      .map(fold)
      // Very short aliases (abbreviations) match everywhere and would distort passage ranking.
      .filter((n) => n.length >= 4),
  );
  return { raw, variants, drug: isDrug(variants), english: variants.english ?? raw, names };
}

export type QueryAnalyzer = (query: ResearchQuery, opts?: CallOptions) => Promise<QueryAnalysis>;

/**
 * Analyses are cached per question, so the sources of one research run share the work when they
 * were created with the same resolver.
 */
export function createQueryAnalyzer(resolve: TermResolver): QueryAnalyzer {
  const cache = new Map<string, Promise<QueryAnalysis>>();

  async function analyze(query: ResearchQuery, language: string): Promise<QueryAnalysis> {
    const concept = query.concept;
    const raws = extractTerms(query.question, concept ? [concept.label] : []).slice(0, concept ? 2 : 3);
    const jobs = [
      ...(concept ? [resolve(concept.label, { language, codes: concept.codes, type: concept.type })] : []),
      ...raws.map((raw) => resolve(raw, { language })),
    ];
    const labels = [...(concept ? [concept.label] : []), ...raws];
    const settled = await Promise.allSettled(jobs);
    let resolveError: Error | undefined;
    const terms = settled.map((result, i) => {
      if (result.status === 'fulfilled') return toTerm(labels[i]!, result.value);
      resolveError ??= result.reason instanceof Error ? result.reason : new Error(String(result.reason));
      return toTerm(labels[i]!, { term: labels[i]!, language, aliases: [], codes: [] });
    });
    return {
      question: query.question,
      language,
      topics: detectTopics(query.question),
      terms,
      drugs: terms.filter((t) => t.drug),
      resolveError,
    };
  }

  return (query, opts) => {
    const language = (query.language ?? opts?.language ?? 'de').split('-')[0]!.toLowerCase();
    const key = JSON.stringify([query.question, query.concept?.conceptId, query.concept?.label, language]);
    let pending = cache.get(key);
    if (!pending) {
      pending = analyze(query, language);
      cache.set(key, pending);
      // Do not keep an analysis that ran without the bridge; the next call should retry.
      pending.then((a) => a.resolveError && cache.delete(key), () => cache.delete(key));
      if (cache.size > 50) cache.delete(cache.keys().next().value!);
    }
    return raceSignal(pending, opts?.signal);
  };
}

export interface Section {
  heading?: string;
  text: string;
}

function countMatches(text: string, needle: string): number {
  let count = 0;
  for (let i = text.indexOf(needle); i !== -1 && count < 5; i = text.indexOf(needle, i + needle.length)) count++;
  return count;
}

/**
 * Orders sections by relevance to the question (asked-for section first, then sections that
 * mention the other terms of the question), splits oversized sections and caps the total.
 * Nothing is dropped for being off-topic: the remaining sections follow in document order.
 */
export function rankPassages(
  sections: Section[],
  analysis: QueryAnalysis,
  o: { subject?: AnalyzedTerm; maxChars?: number; maxPassages?: number } = {},
): SourceDocument['passages'] {
  const maxChars = o.maxChars ?? 2800;
  const maxPassages = o.maxPassages ?? 10;
  const rules = analysis.topics.map((t) => TOPICS[t]);
  // Terms other than the document's own subject: a section naming them is what the user asks about.
  const others = analysis.terms.filter((t) => t !== o.subject).flatMap((t) => t.names);

  const chunks = sections.flatMap((section, order) => {
    const parts = chunkText(section.text.trim(), maxChars);
    return parts.map((text, part) => ({
      heading: section.heading && parts.length > 1 ? `${section.heading} (${part + 1}/${parts.length})` : section.heading,
      baseHeading: section.heading,
      text,
      order: order + part / 1000,
    }));
  });

  const scored = chunks.map((chunk) => {
    const heading = fold(chunk.baseHeading ?? '');
    const text = fold(chunk.text);
    let score = 0;
    for (const rule of rules) {
      if (rule.heading?.test(heading)) score += 10;
      if (rule.text) score += Math.min(4, text.match(new RegExp(rule.text.source, 'g'))?.length ?? 0);
    }
    for (const name of others) score += 2 * countMatches(text, name);
    return { chunk, score };
  });
  scored.sort((a, b) => b.score - a.score || a.chunk.order - b.chunk.order);
  return scored.slice(0, maxPassages).map(({ chunk }) => (chunk.heading ? { heading: chunk.heading, text: chunk.text } : { text: chunk.text }));
}

/**
 * Boolean search expressions of the detected topics, e.g. `['(dosage OR dose OR dosing)']`.
 * A topic that is already covered by a term of the question (e.g. renal ← "Niereninsuffizienz")
 * is left out, the resolved term is the more precise search word.
 */
export function topicWords(analysis: QueryAnalysis): string[] {
  return analysis.topics
    .filter((topic) => !analysis.terms.some((term) => term.variants.english && TOPICS[topic].ask.test(fold(term.raw))))
    .map((topic) => TOPICS[topic].en);
}

export function limitOf(opts: { limit?: number } | undefined, fallback: number, max = 10): number {
  const n = opts?.limit;
  return n && n > 0 ? Math.min(Math.floor(n), max) : fallback;
}
