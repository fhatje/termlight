import { StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

/** Transient, non-semantic marks: the range being read aloud, pending dictation, the card's term. */

interface Range {
  from: number;
  to: number;
}

interface MarksValue {
  spoken: Range | null;
  active: Range | null;
  /** Interim dictation text, rendered as a ghost at the caret. Never part of the document. */
  interim: string;
  decorations: DecorationSet;
}

export const setSpokenRange = StateEffect.define<Range | null>();
export const setActiveTerm = StateEffect.define<Range | null>();
export const setInterimText = StateEffect.define<string>();

class InterimWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  eq(other: InterimWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'med-interim';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = this.text;
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const spokenMark = Decoration.mark({ class: 'med-spoken' });
const activeMark = Decoration.mark({ class: 'med-active' });

function mapRange(range: Range | null, tr: { changes: { mapPos(pos: number, assoc?: number): number } }): Range | null {
  if (!range) return null;
  const from = tr.changes.mapPos(range.from, 1);
  const to = tr.changes.mapPos(range.to, -1);
  return to > from ? { from, to } : null;
}

function clamp(range: Range | null, length: number): Range | null {
  if (!range) return null;
  const from = Math.max(0, Math.min(range.from, length));
  const to = Math.max(from, Math.min(range.to, length));
  return to > from ? { from, to } : null;
}

const marksField = StateField.define<MarksValue>({
  create: () => ({ spoken: null, active: null, interim: '', decorations: Decoration.none }),
  update(value, tr) {
    let { spoken, active, interim } = value;
    let changed = false;
    if (tr.docChanged) {
      spoken = mapRange(spoken, tr);
      active = mapRange(active, tr);
      changed = true;
    }
    for (const effect of tr.effects) {
      if (effect.is(setSpokenRange)) {
        spoken = clamp(effect.value, tr.state.doc.length);
        changed = true;
      } else if (effect.is(setActiveTerm)) {
        active = clamp(effect.value, tr.state.doc.length);
        changed = true;
      } else if (effect.is(setInterimText)) {
        interim = effect.value;
        changed = true;
      }
    }
    // The ghost follows the caret.
    if (interim && tr.selection) changed = true;
    if (!changed) return value;
    const ranges = [];
    if (active) ranges.push(activeMark.range(active.from, active.to));
    if (spoken) ranges.push(spokenMark.range(spoken.from, spoken.to));
    if (interim) {
      const head = tr.state.selection.main.head;
      // The final text gets its space on insertion; the preview needs one too or it glues to the last word.
      const glued = head > 0 && !/\s/.test(tr.state.sliceDoc(head - 1, head));
      ranges.push(Decoration.widget({ widget: new InterimWidget(glued ? ` ${interim}` : interim), side: 1 }).range(head));
    }
    return { spoken, active, interim, decorations: Decoration.set(ranges, true) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function spokenRange(view: EditorView): Range | null {
  return view.state.field(marksField, false)?.spoken ?? null;
}

/** Extension for the spoken-range highlight, the dictation ghost text and the active-term tint. */
export function medTransientMarks(): Extension {
  return marksField;
}
