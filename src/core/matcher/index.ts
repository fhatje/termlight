export { createMatcher, DEFAULT_INFLECTION } from './matcher.ts';
export type { InflectionRules, MatcherConcept, MatcherOptions, MatcherPack, MatcherStats, TermMatcher } from './matcher.ts';
export {
  createContextAnnotator,
  mergeContextRules,
  DEFAULT_CONTEXT_RULES,
  ENGLISH_CONTEXT_RULES,
  FRENCH_CONTEXT_RULES,
  GERMAN_CONTEXT_RULES,
} from './context.ts';
export type { ContextAnnotator, ContextRules, ContextTrigger } from './context.ts';
export { resolveOverlaps } from './overlap.ts';
export { normalizeToken, tokenize } from './normalize.ts';
export type { Token } from './normalize.ts';
export { DEFAULT_STOPWORDS, ENGLISH_STOPWORDS, FRENCH_STOPWORDS, GERMAN_STOPWORDS } from './stopwords.ts';
export { getLanguage, languageCode, registerLanguage, supportedLanguages } from './languages.ts';
export type { LanguageRules } from './languages.ts';
