import type { Annotation, ConceptType } from '../core/types.ts';

/** Display order: what a radiology report mentions most comes first. */
export const CONCEPT_TYPES: readonly ConceptType[] = [
  'anatomy',
  'finding',
  'disease',
  'symptom',
  'medication',
  'substance',
  'procedure',
  'lab',
  'physiology',
  'modifier',
  'other',
];

/** `text` = the monospace the report is set in, `sans` and `serif` are the two contrasting voices. */
export type ConceptFace = 'text' | 'sans' | 'serif';

export interface ConceptStyle {
  /** Ink colour on the light / dark surface; light ≥ 7:1, dark ≥ 4.5:1 against the default surfaces. */
  light: string;
  dark: string;
  /** Second, colour-independent channel: typeface, weight and slope instead of boxes or lines. */
  face: ConceptFace;
  weight: number;
  italic: boolean;
}

/**
 * The type system of the highlighting, built like a syntax theme: no backgrounds, no underlines.
 * What the report is about (anatomy, findings, diagnoses) stays in the text monospace and differs
 * by weight and slope; what comes from outside the image (drugs, substances) switches to the sans;
 * examination technique and lab values to the serif (one colour, told apart by weight and slope).
 * Violet is reserved for negated terms, see theme.ts. Types that share a voice sit on opposite
 * sides of the blue–yellow axis, so they stay apart under red–green colour blindness.
 */
export const CONCEPT_STYLES: Record<ConceptType, ConceptStyle> = {
  anatomy: { light: '#15528C', dark: '#7DB9F0', face: 'text', weight: 400, italic: false },
  finding: { light: '#12623A', dark: '#6CCB93', face: 'text', weight: 700, italic: false },
  disease: { light: '#A3152F', dark: '#F58BA0', face: 'text', weight: 700, italic: true },
  symptom: { light: '#8F3F00', dark: '#F0A261', face: 'text', weight: 400, italic: true },
  medication: { light: '#8C1A7A', dark: '#E891DA', face: 'sans', weight: 600, italic: false },
  substance: { light: '#6A4E00', dark: '#D9BC55', face: 'sans', weight: 400, italic: false },
  procedure: { light: '#075B6C', dark: '#5CC8DA', face: 'serif', weight: 400, italic: true },
  lab: { light: '#075B6C', dark: '#5CC8DA', face: 'serif', weight: 600, italic: false },
  physiology: { light: '#07634F', dark: '#5FCDB2', face: 'sans', weight: 400, italic: true },
  modifier: { light: '#43517F', dark: '#A9B6E0', face: 'text', weight: 400, italic: true },
  other: { light: '#4E5763', dark: '#A5AEB9', face: 'sans', weight: 400, italic: false },
};

/**
 * CSS custom property an embedder can set to recolour a concept type, e.g. `--med-anatomy`.
 * With the suffixes `-font`, `-weight` and `-style` it overrides family, weight and slope.
 */
export function conceptVar(type: ConceptType): string {
  return `--med-${type}`;
}

/** Class list of the mark for an annotation; also used for the samples in legend and card. */
export function termClass(a: Pick<Annotation, 'type' | 'assertion'>): string {
  const assertion = a.assertion ?? 'present';
  return assertion === 'present' ? `med-term med-t-${a.type}` : `med-term med-t-${a.type} med-a-${assertion}`;
}
