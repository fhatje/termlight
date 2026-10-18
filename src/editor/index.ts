export { MedEditor } from './med-editor.ts';
export type { MedEditorTheme } from './med-editor.ts';

// CodeMirror 6 building blocks, for hosts that bring their own editor setup.
export {
  medHighlight,
  highlightField,
  getAnnotations,
  annotationAt,
  hiddenTypes,
  setHiddenTypes,
  refreshHighlights,
  rebaseAnnotations,
  setAnnotationsEffect,
  setHiddenTypesEffect,
} from './highlight.ts';
export type { MedHighlightOptions, HighlightRunInfo, RecognizerRunStat } from './highlight.ts';
export { medTransientMarks, setSpokenRange, setActiveTerm, setInterimText } from './marks.ts';
export { medHighlightTheme, medEditorTheme, termRules, FONT_TEXT, FONT_UI, FONT_SANS, FONT_SERIF } from './theme.ts';
export { CONCEPT_TYPES, CONCEPT_STYLES, conceptVar, termClass } from './concepts.ts';
export type { ConceptStyle, ConceptFace } from './concepts.ts';

export { parseMarkdown, parseInline, markdownToPlainText, safeUrl } from './markdown.ts';
export type { Block, Inline } from './markdown.ts';
export { i18n, strings, quickChips } from './i18n.ts';
export type { Strings, QuickChip } from './i18n.ts';
