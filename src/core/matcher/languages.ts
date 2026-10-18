import { ENGLISH_CONTEXT_RULES, FRENCH_CONTEXT_RULES, GERMAN_CONTEXT_RULES } from './context.ts';
import type { ContextRules } from './context.ts';
import { ENGLISH_STOPWORDS, FRENCH_STOPWORDS, GERMAN_STOPWORDS } from './stopwords.ts';

/**
 * Everything the matcher needs to know about a language. German has its own inflection logic in
 * the matcher (noun/adjective classes, umlaut plurals, compounds); every other language gets by
 * with a suffix list, so adding one is a data-only change: `registerLanguage({ ... })`.
 */
export interface LanguageRules {
  /** ISO 639-1, lower case. */
  code: string;
  name: string;
  /** Ordinary words that are never highlighted as single-word terms. */
  stopwords: readonly string[];
  /** Negation, uncertainty and laterality triggers. */
  context: ContextRules;
  /**
   * `[suffix, replacement]` stripped from a text word to reach the dictionary form of a term of
   * this language ("nodules" → "nodule", "pleuraux" → "pleural").
   */
  suffixes?: [string, string][];
}

const LANGUAGES = new Map<string, LanguageRules>();

export function languageCode(tag: string | undefined): string {
  return (tag ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
}

export function registerLanguage(rules: LanguageRules): void {
  LANGUAGES.set(languageCode(rules.code), rules);
}

export function getLanguage(tag: string | undefined): LanguageRules | undefined {
  return LANGUAGES.get(languageCode(tag));
}

export function supportedLanguages(): LanguageRules[] {
  return [...LANGUAGES.values()];
}

registerLanguage({ code: 'de', name: 'Deutsch', stopwords: GERMAN_STOPWORDS, context: GERMAN_CONTEXT_RULES });
registerLanguage({
  code: 'en',
  name: 'English',
  stopwords: ENGLISH_STOPWORDS,
  context: ENGLISH_CONTEXT_RULES,
  suffixes: [
    ['s', ''],
    ['es', ''],
    ['ies', 'y'],
    ['ses', 'sis'],
    ['ae', 'a'],
  ],
});
registerLanguage({
  code: 'fr',
  name: 'Français',
  stopwords: FRENCH_STOPWORDS,
  context: FRENCH_CONTEXT_RULES,
  suffixes: [
    ['s', ''],
    ['x', ''],
    ['e', ''],
    ['es', ''],
    ['aux', 'al'],
    ['ale', 'al'],
    ['ales', 'al'],
    ['aux', 'ail'],
    ['euse', 'eux'],
    ['euses', 'eux'],
    ['ive', 'if'],
    ['ives', 'if'],
    ['ienne', 'ien'],
    ['iennes', 'ien'],
  ],
});
