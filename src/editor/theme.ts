import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CONCEPT_STYLES, CONCEPT_TYPES, conceptVar } from './concepts.ts';

type StyleSpec = Record<string, string | number>;

/** The writing face. JetBrains Mono ships with the module (see fonts.ts); the rest are fallbacks. */
export const FONT_TEXT =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';
export const FONT_UI =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif';
export const FONT_SANS =
  '"Avenir Next", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", "Noto Sans", system-ui, sans-serif';
export const FONT_SERIF =
  'Charter, "Bitstream Charter", "Sitka Text", Cambria, "Iowan Old Style", Georgia, serif';

/** Family and optical size per voice: next to the wide mono, sans and serif look small at equal font-size. */
const FACES = {
  text: { family: 'inherit', size: '1em', spacing: 'normal' },
  sans: { family: `var(--med-font-sans, ${FONT_SANS})`, size: '1.06em', spacing: '0.005em' },
  serif: { family: `var(--med-font-serif, ${FONT_SERIF})`, size: '1.1em', spacing: '0.01em' },
} as const;

/**
 * Rules shared by the CodeMirror theme and the samples in legend/card/status bar. Everything is
 * driven by `--med-c` (the ink of the concept type) so one rule set covers all types.
 */
export function termRules(scope: string, scheme: 'light' | 'dark'): Record<string, StyleSpec> {
  const rules: Record<string, StyleSpec> = {};
  const sel = (s: string) => (scope ? `${scope} ${s}` : s);
  rules[sel('.med-term')] = { color: 'var(--med-c)', textDecoration: 'none' };
  for (const type of CONCEPT_TYPES) {
    const style = CONCEPT_STYLES[type];
    const face = FACES[style.face];
    rules[sel(`.med-t-${type}`)] = {
      '--med-c': `var(${conceptVar(type)}, ${style[scheme]})`,
      // Embedders can restyle a type, e.g. --med-finding-weight: 600 for a font without a bold.
      fontFamily: `var(${conceptVar(type)}-font, ${face.family})`,
      fontSize: face.size,
      letterSpacing: face.spacing,
      fontWeight: `var(${conceptVar(type)}-weight, ${style.weight})`,
      fontStyle: `var(${conceptVar(type)}-style, ${style.italic ? 'italic' : 'normal'})`,
    };
  }
  // Negated: a pertinent negative matters as much as a finding, so it gets a prime colour of its
  // own instead of fading to grey: violet, the complement of the green of a present finding.
  // Medium weight and upright in the text face, whatever the type; the weight keeps it apart
  // from a bold, present finding when colour is not available.
  rules[sel('.med-term.med-a-negated')] = {
    color: `var(--med-negated-ink, ${scheme === 'dark' ? '#B9A0F7' : '#5A2EB0'})`,
    fontFamily: 'inherit',
    fontSize: '1em',
    letterSpacing: 'normal',
    fontWeight: 500,
    fontStyle: 'normal',
  };
  // Uncertain: the type's voice, but lighter in ink and weight and always sloped. No extra mark.
  // On white the thin strokes wash out sooner, so the light scheme fades less (stays ≥ 4.5:1).
  rules[sel('.med-term.med-a-uncertain')] = {
    color: `color-mix(in srgb, var(--med-c) ${scheme === 'dark' ? '68%, #171c23' : '80%, #ffffff'})`,
    fontWeight: 400,
    fontStyle: 'italic',
  };
  return rules;
}

function editorTermRules(): Record<string, StyleSpec> {
  const rules: Record<string, StyleSpec> = {
    ...termRules('&light', 'light'),
    ...termRules('&dark', 'dark'),
    // The term whose card is open: a hairline frame, since fills and underlines are not part of the theme.
    '.med-active': {
      outline: '1px solid color-mix(in srgb, currentColor 45%, transparent)',
      outlineOffset: '2px',
      borderRadius: '3px',
    },
    // Neither uncertainty nor laterality gets a marker of its own: superscripts beside the terms
    // turned the page into footnotes. Both are spelled out in the term card.
    '.med-spoken': {
      backgroundColor: 'var(--med-spoken, color-mix(in srgb, #E9B824 38%, transparent))',
      borderRadius: '3px',
      boxShadow: '0 0 0 2px var(--med-spoken, color-mix(in srgb, #E9B824 38%, transparent))',
    },
    '.med-interim': { opacity: '0.55', fontStyle: 'italic' },
  };
  return rules;
}

/** Styles for the marks produced by `medHighlight` and `medTransientMarks`; works in any CM6 editor. */
export const medHighlightTheme: Extension = EditorView.baseTheme(editorTermRules() as never);

/** The writing surface of `<med-editor>`; reads the element's `--_*` custom properties. */
export const medEditorTheme: Extension = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--_ink)',
    backgroundColor: 'transparent',
    fontFamily: 'var(--_font-text)',
    fontSize: 'var(--med-font-size, 0.9375rem)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.8',
    overflow: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--_line-strong) transparent',
  },
  '.cm-content': {
    // Full width by default; embedders can set a reading measure, e.g. --med-measure: 42rem.
    maxWidth: 'var(--med-measure, none)',
    padding: 'var(--med-content-padding, 1.5rem clamp(1rem, 4.5%, 3rem) 5rem)',
    minHeight: 'var(--med-min-height, 0)',
    caretColor: 'var(--_accent)',
    // Code ligatures (->, !=, >=) have no place in prose.
    fontVariantLigatures: 'none',
  },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--_faint)', fontStyle: 'italic' },
  '.cm-content ::selection': { backgroundColor: 'var(--_selection)' },
  '&.cm-focused .cm-content ::selection': { backgroundColor: 'var(--_selection)' },
  '.cm-cursor': { borderLeftColor: 'var(--_accent)', borderLeftWidth: '1.5px' },
});
