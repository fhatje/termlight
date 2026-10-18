import { Facet, StateEffect, StateField } from '@codemirror/state';
import type { ChangeDesc, ChangeSet, EditorState, Extension, Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Annotation, ConceptType, Laterality, Recognizer } from '../core/types.ts';
import { termClass } from './concepts.ts';
import { resolveOverlaps } from './overlap.ts';

export interface RecognizerRunStat {
  id: string;
  label: string;
  /** Wall-clock duration of `recognize()`. */
  ms: number;
  count: number;
  error?: Error;
}

export interface HighlightRunInfo {
  /** Slowest recognizer of the run = time until the highlights were complete. */
  latencyMs: number;
  recognizers: RecognizerRunStat[];
}

export interface MedHighlightOptions {
  /** Active recognizers; a function is re-evaluated at the start of every run. */
  recognizers: readonly Recognizer[] | (() => readonly Recognizer[]);
  language?: string | (() => string | undefined);
  /** Quiet time after the last change before recognizers run. Default 150 ms. */
  debounce?: number;
  /** Value of the `data-med-lat` attribute per `Annotation.laterality` (not drawn by the default theme). `null` omits it. */
  lateralityMark?: Record<Laterality, string> | null;
  /** Called whenever the applied annotation set changes (not on every keystroke). */
  onAnnotations?(annotations: Annotation[]): void;
  onRunStart?(): void;
  onRunEnd?(info: HighlightRunInfo): void;
}

interface ResolvedOptions extends MedHighlightOptions {
  debounce: number;
}

const optionsFacet = Facet.define<ResolvedOptions, ResolvedOptions | null>({
  combine: (values) => values[0] ?? null,
});

/** Replaces all annotations. Offsets refer to the document the transaction produces. */
export const setAnnotationsEffect = StateEffect.define<readonly Annotation[]>();
export const setHiddenTypesEffect = StateEffect.define<ReadonlySet<ConceptType>>();
const rerunEffect = StateEffect.define<null>();

interface HighlightValue {
  /** Every annotation, as a mark decoration carrying the annotation in `spec.annotation`. */
  all: DecorationSet;
  /** `all` minus the concept types the user switched off in the legend. */
  visible: DecorationSet;
  hidden: ReadonlySet<ConceptType>;
}

const NO_HIDDEN: ReadonlySet<ConceptType> = new Set();
const DEFAULT_LATERALITY: Record<Laterality, string> = { left: 'li', right: 're', bilateral: 'bds' };

function markFor(a: Annotation, lateralityMark: Record<Laterality, string> | null): Decoration {
  const attributes: Record<string, string> = {};
  if (a.laterality && lateralityMark) attributes['data-med-lat'] = lateralityMark[a.laterality];
  return Decoration.mark({
    class: termClass(a),
    attributes,
    // Typing at either edge must not extend the mark: the new text has not been recognised yet.
    inclusive: false,
    annotation: a,
  });
}

function buildSet(
  annotations: readonly Annotation[],
  docLength: number,
  lateralityMark: Record<Laterality, string> | null,
): DecorationSet {
  const ranges = [];
  for (const a of annotations) {
    if (a.from >= 0 && a.to > a.from && a.to <= docLength) ranges.push(markFor(a, lateralityMark).range(a.from, a.to));
  }
  return Decoration.set(ranges, true);
}

function filterVisible(all: DecorationSet, hidden: ReadonlySet<ConceptType>): DecorationSet {
  if (hidden.size === 0) return all;
  return all.update({ filter: (_f, _t, value) => !hidden.has((value.spec.annotation as Annotation).type) });
}

export const highlightField = StateField.define<HighlightValue>({
  create: () => ({ all: Decoration.none, visible: Decoration.none, hidden: NO_HIDDEN }),
  update(value, tr) {
    let { all, visible, hidden } = value;
    if (tr.docChanged) {
      // Keeps existing highlights glued to their text until the next recognition result arrives.
      const same = visible === all;
      all = all.map(tr.changes);
      visible = same ? all : visible.map(tr.changes);
    }
    for (const effect of tr.effects) {
      if (effect.is(setAnnotationsEffect)) {
        const options = tr.state.facet(optionsFacet);
        const lateralityMark = options ? (options.lateralityMark === undefined ? DEFAULT_LATERALITY : options.lateralityMark) : DEFAULT_LATERALITY;
        all = buildSet(resolveOverlaps([effect.value], tr.state.doc.length), tr.state.doc.length, lateralityMark);
        visible = filterVisible(all, hidden);
      } else if (effect.is(setHiddenTypesEffect)) {
        hidden = effect.value;
        visible = filterVisible(all, hidden);
      }
    }
    return all === value.all && visible === value.visible && hidden === value.hidden ? value : { all, visible, hidden };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.visible),
});

/** Current annotations with up-to-date offsets (they move with edits between recognitions). */
export function getAnnotations(state: EditorState): Annotation[] {
  const value = state.field(highlightField, false);
  if (!value) return [];
  const out: Annotation[] = [];
  const cursor = value.all.iter();
  while (cursor.value) {
    const a = cursor.value.spec.annotation as Annotation;
    out.push(
      a.from === cursor.from && a.to === cursor.to
        ? a
        : { ...a, from: cursor.from, to: cursor.to, text: state.doc.sliceString(cursor.from, cursor.to) },
    );
    cursor.next();
  }
  return out;
}

/** The visible annotation covering `pos` (inclusive at both ends, so a caret right after a term counts). */
export function annotationAt(state: EditorState, pos: number): Annotation | null {
  const value = state.field(highlightField, false);
  if (!value) return null;
  let found: Annotation | null = null;
  value.visible.between(pos, pos, (from, to, deco) => {
    const a = deco.spec.annotation as Annotation;
    found = a.from === from && a.to === to ? a : { ...a, from, to, text: state.doc.sliceString(from, to) };
    return false;
  });
  return found;
}

export function hiddenTypes(state: EditorState): ReadonlySet<ConceptType> {
  return state.field(highlightField, false)?.hidden ?? NO_HIDDEN;
}

export function setHiddenTypes(view: EditorView, types: Iterable<ConceptType>): void {
  view.dispatch({ effects: setHiddenTypesEffect.of(new Set(types)) });
}

/** Re-runs recognition immediately, e.g. after the set of active recognizers changed. */
export function refreshHighlights(view: EditorView): void {
  view.dispatch({ effects: rerunEffect.of(null) });
}

// ---------------------------------------------------------------------------------------------
// Bringing results of an older document version forward
// ---------------------------------------------------------------------------------------------

function touchesAny(from: number, to: number, ranges: readonly (readonly [number, number])[]): boolean {
  // Adjacency counts: text typed right next to a term may have changed the term itself
  // ("Pneumo" → "Pneumonie") or its context ("Kein " in front of it).
  for (const [rFrom, rTo] of ranges) if (from <= rTo && to >= rFrom) return true;
  return false;
}

/**
 * A recognizer answered for document version A, but the user kept typing and the editor is at
 * version B. Results in untouched regions are moved to their new offsets (and double-checked
 * against the text); around the edits the answer is unreliable, so there the annotations that
 * are currently shown are kept until the follow-up run delivers.
 */
export function rebaseAnnotations(
  fresh: readonly Annotation[],
  changes: ChangeDesc | null,
  doc: Text,
  current: readonly Annotation[],
): Annotation[] {
  if (!changes || changes.empty) return fresh.filter((a) => a.to <= doc.length);
  const changed: [number, number][] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => void changed.push([fromB, toB]));
  const out: Annotation[] = [];
  for (const a of fresh) {
    const from = changes.mapPos(a.from, 1);
    const to = changes.mapPos(a.to, -1);
    if (to <= from || to - from !== a.to - a.from) continue;
    if (touchesAny(from, to, changed)) continue;
    if (doc.sliceString(from, to) !== a.text) continue;
    out.push(from === a.from ? a : { ...a, from, to });
  }
  for (const a of current) if (touchesAny(a.from, a.to, changed)) out.push(a);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------------------------

interface Run {
  controller: AbortController;
  recognizers: readonly Recognizer[];
  /** Per recognizer: its result in start-document coordinates, `null` while pending. */
  results: (Annotation[] | null)[];
  stats: RecognizerRunStat[];
  /** Everything typed since the run started; `null` = document unchanged. */
  changes: ChangeSet | null;
}

class RecognitionScheduler {
  private readonly view: EditorView;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private applyTimer: ReturnType<typeof setTimeout> | undefined;
  private run: Run | null = null;
  /** The annotation list listeners were last told about. */
  private reported: Annotation[] = [];
  /** Document changed since the last run started → another run is needed. */
  private dirty = false;
  private destroyed = false;

  constructor(view: EditorView) {
    this.view = view;
    this.schedule(0);
  }

  update(update: ViewUpdate): void {
    let rerun = false;
    for (const tr of update.transactions) {
      for (const effect of tr.effects) if (effect.is(rerunEffect)) rerun = true;
    }
    if (update.docChanged) {
      if (this.run) this.run.changes = this.run.changes ? this.run.changes.compose(update.changes) : update.changes;
      this.dirty = true;
      this.schedule(this.options?.debounce ?? 150);
    }
    if (rerun) {
      // The provider set changed: the in-flight answer belongs to the old set.
      this.abortRun();
      this.schedule(0);
    }
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    clearTimeout(this.applyTimer);
    this.abortRun();
  }

  private get options(): ResolvedOptions | null {
    return this.view.state.facet(optionsFacet);
  }

  private abortRun(): void {
    this.run?.controller.abort();
    this.run = null;
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.start(), delay);
  }

  private start(): void {
    this.timer = undefined;
    if (this.destroyed) return;
    // One run at a time. A slow (remote) recognizer would otherwise be restarted by every pause
    // in typing and never get to answer; its late answer is rebased instead, then we go again.
    if (this.run) return;
    const options = this.options;
    if (!options) return;
    this.dirty = false;
    const recognizers = typeof options.recognizers === 'function' ? options.recognizers() : options.recognizers;
    const language = typeof options.language === 'function' ? options.language() : options.language;
    const run: Run = {
      controller: new AbortController(),
      recognizers,
      results: recognizers.map(() => null),
      stats: [],
      changes: null,
    };
    this.run = run;
    options.onRunStart?.();
    if (recognizers.length === 0) {
      this.settle(run);
      return;
    }
    const text = this.view.state.doc.toString();
    recognizers.forEach((recognizer, index) => {
      const started = performance.now();
      const finish = (annotations: Annotation[], error?: Error) => {
        if (this.run !== run) return;
        run.results[index] = annotations;
        run.stats.push({
          id: recognizer.id,
          label: recognizer.label,
          ms: performance.now() - started,
          count: annotations.length,
          ...(error ? { error } : {}),
        });
        this.settle(run);
      };
      let promise: Promise<Annotation[]>;
      try {
        promise = recognizer.recognize(text, { signal: run.controller.signal, ...(language ? { language } : {}) });
      } catch (error) {
        promise = Promise.reject(error);
      }
      promise.then(
        (annotations) => finish(Array.isArray(annotations) ? annotations : []),
        (error: unknown) => finish([], error instanceof Error ? error : new Error(String(error))),
      );
    });
  }

  /** Called each time a recognizer of `run` finished: shows what is known so far. */
  private settle(run: Run): void {
    clearTimeout(this.applyTimer);
    if (this.destroyed || this.run !== run) return;
    if (this.view.composing) {
      // Touching the DOM around the composition would cancel the IME session.
      this.applyTimer = setTimeout(() => this.settle(run), 60);
      return;
    }
    const state = this.view.state;
    const current = getAnnotations(state);
    const pendingSources = new Set<string>();
    const lists: Annotation[][] = [];
    const failed = new Set(run.stats.filter((s) => s.error).map((s) => s.id));
    run.recognizers.forEach((recognizer, index) => {
      const result = run.results[index];
      // A failed recognizer keeps what it showed before rather than blanking its highlights.
      if (result && !failed.has(recognizer.id)) lists.push(rebaseAnnotations(result, run.changes, state.doc, []));
      else pendingSources.add(recognizer.id);
    });
    const carried: Annotation[] = [];
    if (run.changes && !run.changes.empty) {
      const activeSources = new Set(run.recognizers.map((r) => r.id));
      // Second half of the rebase: near the edits, keep what is on screen.
      carried.push(...rebaseAnnotations([], run.changes, state.doc, current).filter((a) => activeSources.has(a.source)));
    }
    // Recognizers that have not answered yet keep their highlights from the previous run.
    for (const a of current) if (pendingSources.has(a.source) && !carried.includes(a)) carried.push(a);
    lists.push(carried);

    const merged = resolveOverlaps(lists, state.doc.length);
    if (!sameAnnotations(current, merged)) this.view.dispatch({ effects: setAnnotationsEffect.of(merged) });
    // Compared with what was last reported, not with the state: edits remove highlights on their
    // own (deleting the whole text leaves none), and listeners have to hear about that as well.
    const applied = getAnnotations(this.view.state);
    if (!sameAnnotations(this.reported, applied)) {
      this.reported = applied;
      this.options?.onAnnotations?.(applied);
    }

    if (run.results.every((r) => r !== null)) {
      this.run = null;
      this.options?.onRunEnd?.({
        latencyMs: run.stats.reduce((max, s) => Math.max(max, s.ms), 0),
        recognizers: run.stats,
      });
      // The debounce timer may have fired while this run was in flight (and bailed out).
      if (this.dirty && this.timer === undefined) this.schedule(0);
    }
  }
}

function sameAnnotations(a: readonly Annotation[], b: readonly Annotation[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.from !== y.from ||
      x.to !== y.to ||
      x.conceptId !== y.conceptId ||
      x.type !== y.type ||
      x.assertion !== y.assertion ||
      x.laterality !== y.laterality ||
      x.source !== y.source ||
      x.label !== y.label
    ) {
      return false;
    }
  }
  return true;
}

const schedulerPlugin = ViewPlugin.fromClass(RecognitionScheduler);

/**
 * Semantic highlighting of medical terms for any CodeMirror 6 editor. Combine with
 * `medHighlightTheme` (or style the `.med-term` classes yourself).
 */
export function medHighlight(options: MedHighlightOptions): Extension {
  return [optionsFacet.of({ ...options, debounce: options.debounce ?? 150 }), highlightField, schedulerPlugin];
}
