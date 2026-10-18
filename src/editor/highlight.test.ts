import { ChangeSet, EditorState, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { Annotation } from '../core/types.ts';
import {
  annotationAt,
  getAnnotations,
  highlightField,
  medHighlight,
  rebaseAnnotations,
  setAnnotationsEffect,
  setHiddenTypesEffect,
} from './highlight.ts';

function find(doc: string, word: string, extra: Partial<Annotation> = {}): Annotation {
  const from = doc.indexOf(word);
  return { from, to: from + word.length, text: word, conceptId: `t:${word}`, label: word, type: 'finding', source: 'dict', ...extra };
}

const DOC = 'Kein Pleuraerguss. V.a. Pneumonie rechts.';

function stateWith(annotations: Annotation[]): EditorState {
  const state = EditorState.create({ doc: DOC, extensions: [medHighlight({ recognizers: [] })] });
  return state.update({ effects: setAnnotationsEffect.of(annotations) }).state;
}

function classesOf(state: EditorState): string[] {
  const out: string[] = [];
  const cursor = state.field(highlightField).visible.iter();
  while (cursor.value) {
    out.push((cursor.value.spec as { class: string }).class);
    cursor.next();
  }
  return out;
}

describe('highlight state', () => {
  const erguss = find(DOC, 'Pleuraerguss', { assertion: 'negated' });
  const pneumonie = find(DOC, 'Pneumonie', { type: 'disease', assertion: 'uncertain', laterality: 'right' });

  it('builds one mark per annotation with type and assertion classes', () => {
    const state = stateWith([pneumonie, erguss]);
    expect(classesOf(state)).toEqual(['med-term med-t-finding med-a-negated', 'med-term med-t-disease med-a-uncertain']);
    expect(getAnnotations(state).map((a) => a.text)).toEqual(['Pleuraerguss', 'Pneumonie']);
  });

  it('exposes laterality as a data attribute', () => {
    const state = stateWith([pneumonie]);
    const cursor = state.field(highlightField).visible.iter();
    expect((cursor.value!.spec as { attributes: Record<string, string> }).attributes['data-med-lat']).toBe('re');
  });

  it('moves annotations with edits before them and reports fresh offsets', () => {
    let state = stateWith([erguss, pneumonie]);
    state = state.update({ changes: { from: 0, insert: 'Befund: ' } }).state;
    const [first, second] = getAnnotations(state);
    expect(first!.from).toBe(erguss.from + 8);
    expect(state.sliceDoc(first!.from, first!.to)).toBe('Pleuraerguss');
    expect(state.sliceDoc(second!.from, second!.to)).toBe('Pneumonie');
  });

  it('does not grow a mark when typing at its edges', () => {
    let state = stateWith([erguss]);
    state = state.update({ changes: { from: erguss.to, insert: 'XY' } }).state;
    state = state.update({ changes: { from: erguss.from, insert: 'Z' } }).state;
    const [a] = getAnnotations(state);
    expect(state.sliceDoc(a!.from, a!.to)).toBe('Pleuraerguss');
  });

  it('drops an annotation whose text was deleted', () => {
    let state = stateWith([erguss, pneumonie]);
    state = state.update({ changes: { from: erguss.from - 1, to: erguss.to + 1 } }).state;
    expect(getAnnotations(state).map((a) => a.label)).toEqual(['Pneumonie']);
  });

  it('hides concept types without forgetting their annotations', () => {
    let state = stateWith([erguss, pneumonie]);
    state = state.update({ effects: setHiddenTypesEffect.of(new Set(['finding'] as const)) }).state;
    expect(classesOf(state)).toEqual(['med-term med-t-disease med-a-uncertain']);
    expect(getAnnotations(state)).toHaveLength(2);
    expect(annotationAt(state, erguss.from + 1)).toBeNull();
    // edits keep both sets in sync
    state = state.update({ changes: { from: 0, insert: '  ' } }).state;
    state = state.update({ effects: setHiddenTypesEffect.of(new Set()) }).state;
    expect(getAnnotations(state).map((a) => state.sliceDoc(a.from, a.to))).toEqual(['Pleuraerguss', 'Pneumonie']);
    expect(classesOf(state)).toHaveLength(2);
  });

  it('finds the annotation at a position, including both edges', () => {
    const state = stateWith([erguss]);
    expect(annotationAt(state, erguss.from)?.label).toBe('Pleuraerguss');
    expect(annotationAt(state, erguss.to)?.label).toBe('Pleuraerguss');
    expect(annotationAt(state, erguss.to + 2)).toBeNull();
  });

  it('ignores out-of-range and overlapping input instead of throwing', () => {
    const state = stateWith([erguss, { ...erguss, from: erguss.from + 2, to: erguss.to - 2, conceptId: 'inner' }, { ...pneumonie, from: 500, to: 510 }]);
    expect(getAnnotations(state).map((a) => a.conceptId)).toEqual(['t:Pleuraerguss']);
  });
});

describe('rebaseAnnotations (answer for an older document version)', () => {
  const oldDoc = Text.of([DOC]);
  const erguss = find(DOC, 'Pleuraerguss');
  const pneumonie = find(DOC, 'Pneumonie', { type: 'disease' });

  it('passes results through when nothing changed', () => {
    expect(rebaseAnnotations([erguss, pneumonie], null, oldDoc, [])).toEqual([erguss, pneumonie]);
  });

  it('shifts results behind an insertion and verifies their text', () => {
    const changes = ChangeSet.of({ from: 19, insert: 'Lunge frei. ' }, DOC.length);
    const doc = changes.apply(oldDoc);
    const out = rebaseAnnotations([erguss, pneumonie], changes, doc, []);
    expect(out.map((a) => doc.sliceString(a.from, a.to))).toEqual(['Pleuraerguss', 'Pneumonie']);
    expect(out[1]!.from).toBe(pneumonie.from + 12);
  });

  it('never applies a result to text that was edited in the meantime', () => {
    // user turned "Pneumonie" into "Pneumonien" while the recognizer was running
    const changes = ChangeSet.of({ from: pneumonie.to, insert: 'n' }, DOC.length);
    const doc = changes.apply(oldDoc);
    const out = rebaseAnnotations([erguss, pneumonie], changes, doc, []);
    expect(out.map((a) => a.label)).toEqual(['Pleuraerguss']);
  });

  it('drops results inside a replaced range', () => {
    const changes = ChangeSet.of({ from: 0, to: 18, insert: 'Lunge frei.' }, DOC.length);
    const doc = changes.apply(oldDoc);
    const out = rebaseAnnotations([erguss, pneumonie], changes, doc, []);
    expect(out.map((a) => doc.sliceString(a.from, a.to))).toEqual(['Pneumonie']);
  });

  it('keeps what is currently shown next to the edit, so highlights do not flicker', () => {
    const changes = ChangeSet.of({ from: pneumonie.to, insert: 'n' }, DOC.length);
    const doc = changes.apply(oldDoc);
    // the editor mapped its own (older) annotation through the edit already
    const shown = [{ ...pneumonie }];
    const out = rebaseAnnotations([erguss, pneumonie], changes, doc, shown);
    expect(out.map((a) => a.label).sort()).toEqual(['Pleuraerguss', 'Pneumonie']);
  });

  it('handles several edits composed into one change set', () => {
    const first = ChangeSet.of({ from: 0, insert: 'A ' }, DOC.length);
    const second = ChangeSet.of({ from: DOC.length + 2, insert: ' Ende' }, DOC.length + 2);
    const changes = first.compose(second);
    const doc = changes.apply(oldDoc);
    const out = rebaseAnnotations([erguss, pneumonie], changes, doc, []);
    expect(out.map((a) => doc.sliceString(a.from, a.to))).toEqual(['Pleuraerguss', 'Pneumonie']);
  });
});
