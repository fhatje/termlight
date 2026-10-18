import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { Annotation as CmAnnotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { LitElement, html, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { createRegistry } from '../core/registry.ts';
import './fonts.ts';
import type { Registry, RegistryChange } from '../core/registry.ts';
import type { Annotation, ConceptRef, ConceptType, MedEditorConfig, ResearchAnswer } from '../core/types.ts';
import { CONCEPT_TYPES, termClass } from './concepts.ts';
import { annotationAt, getAnnotations, medHighlight, refreshHighlights, setHiddenTypes } from './highlight.ts';
import type { HighlightRunInfo } from './highlight.ts';
import { strings } from './i18n.ts';
import type { Strings } from './i18n.ts';
import { LookupStore } from './lookup-store.ts';
import { medTransientMarks, setActiveTerm } from './marks.ts';
import { ResearchController } from './research-controller.ts';
import type { ResearchHistoryItem } from './research-controller.ts';
import { SpeechController } from './speech-controller.ts';
import { answerToPlainText, padBlock } from './text-utils.ts';
import { medEditorTheme, medHighlightTheme } from './theme.ts';
import { renderCard } from './ui/card.ts';
import { icon } from './ui/icons.ts';
import { renderLegend, renderSettings, renderSpeechOptions } from './ui/popovers.ts';
import { renderResearch } from './ui/research.ts';
import { styles } from './ui/styles.ts';

export type MedEditorTheme = 'light' | 'dark' | 'auto';
type PopoverName = 'settings' | 'legend' | 'speech';

interface CardState {
  annotation: Annotation;
  /** Opened by keyboard or touch: stays until dismissed instead of following the pointer. */
  pinned: boolean;
}

/** Marks transactions caused by the `value` setter, which must not echo back as `change`. */
const externalValue = CmAnnotation.define<boolean>();

const NARROW_BELOW = 680;
const HOVER_OPEN_MS = 320;
const HOVER_CLOSE_MS = 260;
/** Pause of the writer before, and between, background lookups. */
const PREFETCH_INTERVAL_MS = 2000;
/** Shared by all editors of the page, see `prefetchNext`. */
let prefetching = false;
/** After a click inside the card, a pointer-leave within this time is the card re-flowing, not the reader leaving. */
const CARD_REFLOW_GRACE_MS = 500;

/**
 * `<med-editor>` – plain-text editor that highlights medical terms.
 *
 * @fires change - `detail`: the new text (user edits, dictation, inserted answers; not `value = …`)
 * @fires annotations - `detail`: `Annotation[]` after each recognition result
 * @fires research - `detail`: `ResearchAnswer` when a research run completed
 */
export class MedEditor extends LitElement {
  static override styles = styles;
  static override shadowRootOptions: ShadowRootInit = { mode: 'open', delegatesFocus: false };

  static override properties = {
    value: { type: String, noAccessor: true },
    config: { attribute: false },
    readonly: { type: Boolean, reflect: true },
    compact: { type: Boolean, reflect: true },
    prefetch: { type: Boolean, reflect: true },
    placeholder: { type: String },
    theme: { type: String, reflect: true },
    disclaimer: { type: String },
    storageKey: { type: String, attribute: 'storage-key' },
    ariaLabel: { type: String, attribute: 'aria-label', reflect: true },
  };

  declare config: MedEditorConfig | undefined;
  declare readonly: boolean;
  /** A bare text field that grows with its content: no toolbar, no status bar. Highlighting and the term card stay. */
  declare compact: boolean;
  /**
   * Fetch the term cards in the background while the writer pauses, one concept every two
   * seconds, so that a card opens without waiting. Off by default: it sends every recognised
   * term to the active lookup services, not only the ones the reader points at.
   */
  declare prefetch: boolean;
  declare placeholder: string;
  declare theme: MedEditorTheme;
  /** Shown under every research answer; defaults to the decision-support notice of the interface language. */
  declare disclaimer: string;
  /** localStorage key for the user's provider selection. */
  declare storageKey: string | undefined;

  // Everything prefixed with `_` is internal; it is only public so the render modules in ./ui can read it.
  _s: Strings = strings('de');
  _language: string | undefined;
  _registry: Registry = createRegistry({}, { storage: null });
  _lookups: LookupStore;
  _research: ResearchController;
  _speech: SpeechController;
  _card: CardState | null = null;
  _popover: PopoverName | null = null;
  _researchOpen = false;
  _draft = '';
  _activeCite: { block: number; n: number } | null = null;
  _copied = false;
  _counts = new Map<ConceptType, number>();
  _hidden = new Set<ConceptType>();
  _modKey = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘' : 'Strg';

  private view: EditorView | undefined;
  private initialValue = '';
  private unsubscribe: (() => void) | undefined;
  private readonly editable = new Compartment();
  private readonly placeholderConf = new Compartment();
  private readonly dark = new Compartment();
  private readonly contentAttributes = new Compartment();
  private narrow = false;
  private isDark = false;
  private latency: number | null = null;
  private slowRun = false;
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  private recognizerError = '';
  private cursorTerm: Annotation | null = null;
  private toast: { message: string; kind: 'info' | 'error' | 'status' } | null = null;
  private everFocused = false;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private hoverTarget: Element | null = null;
  private pointerInCard = false;
  private focusCardAfterRender = false;
  private focusQuestionAfterRender = false;
  private positionFrame = 0;
  private resizeObserver: ResizeObserver | undefined;
  private media: MediaQueryList | undefined;

  constructor() {
    super();
    this.readonly = false;
    this.compact = false;
    this.prefetch = false;
    this.placeholder = '';
    this.theme = 'auto';
    this.disclaimer = '';
    this._lookups = new LookupStore(
      () => this._registry.active('lookups'),
      () => this._language,
    );
    this._research = new ResearchController({
      provider: () => this._registry.activeOne('research'),
      language: () => this._language,
      changed: () => this.requestUpdate(),
      answered: (answer) => this.emit('research', answer),
    });
    this._speech = new SpeechController({
      view: () => this.view,
      tts: () => this._registry.activeOne('tts'),
      stt: () => this._registry.activeOne('stt'),
      language: () => this._language,
      strings: () => this._s,
      readonly: () => this.readonly,
      changed: () => this.requestUpdate(),
      notify: (message, kind) => this.notify(message, kind),
    });
  }

  // ----- public API ------------------------------------------------------------------------

  get value(): string {
    return this.view ? this.view.state.doc.toString() : this.initialValue;
  }

  set value(next: string) {
    const text = next ?? '';
    if (!this.view) {
      this.initialValue = text;
      return;
    }
    if (text === this.view.state.doc.toString()) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      annotations: externalValue.of(true),
    });
  }

  /** The provider registry behind the settings; use it to register providers at runtime. */
  get registry(): Registry {
    return this._registry;
  }

  /** The underlying CodeMirror view (undefined before the first render). */
  get editorView(): EditorView | undefined {
    return this.view;
  }

  override focus(): void {
    this.view?.focus();
  }

  getAnnotations(): Annotation[] {
    return this.view ? getAnnotations(this.view.state) : [];
  }

  /** Replaces the selection with `text` as one undo step and places the caret after it. */
  insertText(text: string): void {
    const view = this.view;
    if (!view || this.readonly) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      annotations: isolateHistory.of('full'),
      userEvent: 'input.insert',
      scrollIntoView: true,
    });
  }

  /**
   * Opens the research panel. Without arguments the current selection (or the term at the caret)
   * becomes the context. A given question is filled in but not sent: nothing leaves the device
   * without the user pressing "Fragen".
   */
  openResearch(question?: string, concept?: ConceptRef): void {
    const context = concept ?? this.contextFromSelection();
    this.closeCard(false);
    this._popover = null;
    if (context) this._research.concept = { conceptId: context.conceptId, label: context.label, type: context.type, ...(context.codes ? { codes: context.codes } : {}) };
    if (question !== undefined) this._draft = question;
    this._researchOpen = true;
    this.focusQuestionAfterRender = true;
    this.requestUpdate();
  }

  // ----- lifecycle -------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    this.media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    this.media?.addEventListener('change', this.onSchemeChange);
    document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    this.applyScheme();
    this.syncPrefetch();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? this.clientWidth;
        const narrow = width < NARROW_BELOW;
        if (narrow !== this.narrow) {
          this.narrow = narrow;
          this.requestUpdate();
        }
        this.schedulePosition();
      });
      this.resizeObserver.observe(this);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.media?.removeEventListener('change', this.onSchemeChange);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    this.resizeObserver?.disconnect();
    this._speech.dispose();
    this._research.cancel(false);
    clearTimeout(this.hoverTimer);
    clearTimeout(this.closeTimer);
    clearInterval(this.prefetchTimer);
    this.prefetchTimer = undefined;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('config') || changed.has('storageKey')) this.rebuildRegistry();
    if (changed.has('theme')) this.applyScheme();
  }

  protected override firstUpdated(): void {
    const parent = this.renderRoot.querySelector<HTMLElement>('.cm-host')!;
    this.view = new EditorView({
      parent,
      // Without this CodeMirror reads the selection from the document and never sees the caret
      // inside the shadow tree.
      root: this.renderRoot as ShadowRoot,
      state: EditorState.create({
        doc: this.initialValue,
        extensions: [
          history(),
          keymap.of([
            { key: 'Mod-i', run: () => this.openCardAtCursor(), preventDefault: true },
            { key: 'Alt-Enter', run: () => this.openCardAtCursor() },
            { key: 'Escape', run: () => this.dismiss() },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          this.placeholderConf.of(cmPlaceholder(this.placeholder || this._s.placeholder)),
          this.editable.of(this.editableExtension()),
          this.dark.of(EditorView.darkTheme.of(this.isDark)),
          this.contentAttributes.of(EditorView.contentAttributes.of({
            'aria-label': this.getAttribute('aria-label') ?? this._s.editorLabel,
            // Browser spell-checking underlines nearly every medical term in red.
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'sentences',
          })),
          medEditorTheme,
          medHighlightTheme,
          medTransientMarks(),
          medHighlight({
            recognizers: () => this._registry.active('recognizers'),
            language: () => this._language,
            lateralityMark: this._s.lateralityMark,
            onAnnotations: (annotations) => this.onAnnotations(annotations),
            onRunStart: () => this.onRunStart(),
            onRunEnd: (info) => this.onRunEnd(info),
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this._speech.docChanged(update.changes);
              if (this._card) queueMicrotask(() => this.closeCard(false));
              if (!update.transactions.some((tr) => tr.annotation(externalValue))) this.emit('change', this.value);
            }
            if (update.docChanged || update.selectionSet) {
              this.lastActivity = Date.now();
              this.updateCursorTerm();
            }
          }),
          EditorView.domEventHandlers({
            mousemove: (event) => this.onEditorMouseMove(event),
            mouseleave: () => this.onEditorMouseLeave(),
            focus: () => {
              this.everFocused = true;
              void Promise.resolve().then(() => this.requestUpdate());
            },
            blur: () => void Promise.resolve().then(() => this.requestUpdate()),
            click: (event) => this.onEditorClick(event),
            pointerup: (event) => this.onEditorPointerUp(event),
            keydown: () => {
              // Typing ends any hover interaction; the card must never sit on the line being written.
              clearTimeout(this.hoverTimer);
              this.hoverTarget = null;
              if (this._card && !this._card.pinned) this.closeCard(false);
            },
          }),
        ],
      }),
    });
    this.view.scrollDOM.addEventListener('scroll', () => this.schedulePosition(), { passive: true });
    if (this._hidden.size) setHiddenTypes(this.view, this._hidden);
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('prefetch')) this.syncPrefetch();
    const view = this.view;
    if (view) {
      if (changed.has('readonly')) view.dispatch({ effects: this.editable.reconfigure(this.editableExtension()) });
      if (changed.has('placeholder') || changed.has('config')) {
        view.dispatch({ effects: this.placeholderConf.reconfigure(cmPlaceholder(this.placeholder || this._s.placeholder)) });
      }
      if (changed.has('ariaLabel') || changed.has('config')) {
        view.dispatch({ effects: this.contentAttributes.reconfigure(EditorView.contentAttributes.of({
          'aria-label': this.getAttribute('aria-label') ?? this._s.editorLabel,
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'sentences',
        })) });
      }
    }
    if (this._card) {
      this.positionCard();
      if (this.focusCardAfterRender) {
        this.focusCardAfterRender = false;
        this.renderRoot.querySelector<HTMLElement>('.card')?.focus({ preventScroll: true });
      }
    }
    if (this.focusQuestionAfterRender) {
      this.focusQuestionAfterRender = false;
      const input = this.renderRoot.querySelector<HTMLTextAreaElement>('#question');
      if (input) {
        input.focus({ preventScroll: true });
        input.select();
      }
    }
  }

  private editableExtension() {
    return [EditorView.editable.of(!this.readonly), EditorState.readOnly.of(this.readonly)];
  }

  private rebuildRegistry(): void {
    this.unsubscribe?.();
    this._speech.dispose();
    this._research.cancel(false);
    const config = this.config ?? {};
    this._language = config.language;
    this._s = strings(config.language);
    this._registry = createRegistry(config, this.storageKey !== undefined ? { storageKey: this.storageKey } : {});
    this._lookups.clear();
    this.unsubscribe = this._registry.subscribe((change) => this.onRegistryChange(change));
    if (this.view) refreshHighlights(this.view);
    void this._speech.loadVoices();
  }

  private onRegistryChange(change: RegistryChange): void {
    if (change.slot === 'recognizers' && this.view) refreshHighlights(this.view);
    if (change.slot === 'tts') {
      this._speech.stopSpeaking();
      void this._speech.loadVoices();
    }
    if (change.slot === 'stt') void this._speech.stopDictation();
    if (change.slot === 'lookups' && this._card) this._lookups.load(this._card.annotation, () => this.requestUpdate());
    this.requestUpdate();
  }

  private readonly onSchemeChange = (): void => this.applyScheme();

  private applyScheme(): void {
    const dark = this.theme === 'dark' || (this.theme !== 'light' && !!this.media?.matches);
    this.isDark = dark;
    if (this.isConnected) this.setAttribute('data-scheme', dark ? 'dark' : 'light');
    this.view?.dispatch({ effects: this.dark.reconfigure(EditorView.darkTheme.of(dark)) });
  }

  private emit(type: 'change' | 'annotations' | 'research', detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private notify(message: string, kind: 'info' | 'error' | 'status'): void {
    clearTimeout(this.toastTimer);
    this.toast = { message, kind };
    this.toastTimer = setTimeout(
      () => {
        this.toast = null;
        this.requestUpdate();
      },
      kind === 'error' ? 9000 : 2600,
    );
    this.requestUpdate();
  }

  // ----- recognition feedback --------------------------------------------------------------

  // ----- background lookups ----------------------------------------------------------------

  private prefetchTimer: ReturnType<typeof setInterval> | undefined;
  private lastActivity = Date.now();

  private syncPrefetch(): void {
    if (this.prefetch && this.isConnected && !this.prefetchTimer) {
      this.prefetchTimer = setInterval(() => this.prefetchNext(), PREFETCH_INTERVAL_MS);
    } else if ((!this.prefetch || !this.isConnected) && this.prefetchTimer) {
      clearInterval(this.prefetchTimer);
      this.prefetchTimer = undefined;
    }
  }

  private prefetchNext(): void {
    const view = this.view;
    // One concept at a time across all editors on the page: the services allow one request per
    // second each, and a card the reader opens meanwhile must not queue behind a backlog.
    if (!view || prefetching || document.hidden || this._card) return;
    if (Date.now() - this.lastActivity < PREFETCH_INTERVAL_MS) return;
    const next = getAnnotations(view.state).find((a) => this._lookups.missing(a));
    if (!next) return;
    prefetching = true;
    this._lookups.prefetch(next, () => {
      prefetching = false;
    });
  }

  private onAnnotations(annotations: Annotation[]): void {
    const counts = new Map<ConceptType, number>();
    for (const a of annotations) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    this._counts = counts;
    this.updateCursorTerm();
    this.emit('annotations', annotations);
    this.requestUpdate();
  }

  private onRunStart(): void {
    // Only a run that is noticeably slow gets an indicator; a local one finishes within a frame.
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => {
      this.slowRun = true;
      this.requestUpdate();
    }, 400);
  }

  private onRunEnd(info: HighlightRunInfo): void {
    clearTimeout(this.slowTimer);
    const failed = info.recognizers.find((r) => r.error);
    const error = failed ? this._s.recognizerFailed(failed.label) : '';
    const latency = info.recognizers.length ? info.latencyMs : null;
    const rounded = (ms: number | null) => (ms === null ? null : ms < 10 ? Math.round(ms * 10) : Math.round(ms) * 10);
    const changed = this.slowRun || error !== this.recognizerError || rounded(latency) !== rounded(this.latency);
    this.slowRun = false;
    this.recognizerError = error;
    this.latency = latency;
    if (changed) this.requestUpdate();
  }

  private updateCursorTerm(): void {
    const view = this.view;
    if (!view) return;
    const { main } = view.state.selection;
    const term = main.empty ? annotationAt(view.state, main.head) : null;
    const prev = this.cursorTerm;
    if (term?.conceptId !== prev?.conceptId || term?.from !== prev?.from || term?.assertion !== prev?.assertion) {
      this.cursorTerm = term;
      this.requestUpdate();
    }
  }

  _toggleType(type: ConceptType): void {
    const hidden = new Set(this._hidden);
    if (hidden.has(type)) hidden.delete(type);
    else hidden.add(type);
    this._hidden = hidden;
    if (this.view) setHiddenTypes(this.view, hidden);
    if (this._card && hidden.has(this._card.annotation.type)) this.closeCard(false);
    this.updateCursorTerm();
    this.requestUpdate();
  }

  // ----- concept card ----------------------------------------------------------------------

  private termFromEvent(event: Event): { element: Element; annotation: Annotation } | null {
    const view = this.view;
    const target = event.target;
    if (!view || !(target instanceof Element)) return null;
    const element = target.closest('.med-term');
    if (!element || !view.contentDOM.contains(element)) return null;
    const annotation = annotationAt(view.state, view.posAtDOM(element));
    return annotation ? { element, annotation } : null;
  }

  private onEditorMouseMove(event: MouseEvent): void {
    if (event.buttons !== 0) return;
    const hit = this.termFromEvent(event);
    if (!hit) {
      this.onEditorMouseLeave();
      return;
    }
    clearTimeout(this.closeTimer);
    if (hit.element === this.hoverTarget) return;
    this.hoverTarget = hit.element;
    clearTimeout(this.hoverTimer);
    if (this._card && this._card.annotation.from === hit.annotation.from) return;
    if (this._card?.pinned) return;
    this.hoverTimer = setTimeout(() => this.openCard(hit.annotation, false, false), this._card ? 140 : HOVER_OPEN_MS);
  }

  private onEditorMouseLeave(): void {
    this.hoverTarget = null;
    clearTimeout(this.hoverTimer);
    this.scheduleCardClose();
  }

  private onEditorClick(event: MouseEvent): void {
    const view = this.view;
    if (!view || !view.state.selection.main.empty || event.detail !== 1) return;
    const hit = this.termFromEvent(event);
    if (hit) {
      clearTimeout(this.hoverTimer);
      this.openCard(hit.annotation, false, false);
    }
  }

  private onEditorPointerUp(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return;
    const hit = this.termFromEvent(event);
    // No hover on touch screens: a tap pins the card until the next tap elsewhere.
    if (hit) setTimeout(() => this.view?.state.selection.main.empty && this.openCard(hit.annotation, true, false), 0);
  }

  /**
   * A hover card lives exactly as long as the pointer is on its term or inside it. Focus does not
   * keep it open: after a click inside, it would otherwise linger until a click somewhere else.
   * Cards opened from the keyboard or by touch are pinned and close on Escape or an outside click.
   */
  private scheduleCardClose(): void {
    clearTimeout(this.closeTimer);
    if (!this._card || this._card.pinned) return;
    this.closeTimer = setTimeout(() => {
      if (this._card && !this._card.pinned && !this.pointerInCard) this.closeCard(false);
    }, HOVER_CLOSE_MS);
  }

  private cardHasFocus(): boolean {
    const active = (this.renderRoot as ShadowRoot).activeElement;
    return !!active && !!active.closest('.card');
  }

  /** When the reader last clicked inside the card. */
  private cardClickAt = 0;

  _cardClicked(): void {
    this.cardClickAt = performance.now();
  }

  _cardHover(inside: boolean): void {
    this.pointerInCard = inside;
    if (inside) {
      clearTimeout(this.closeTimer);
      return;
    }
    // A click can make the card re-flow (a retried lookup, an opened section) and slide out from
    // under a pointer that has not moved. That is not the reader leaving.
    if (performance.now() - this.cardClickAt < CARD_REFLOW_GRACE_MS) return;
    this.scheduleCardClose();
  }

  _cardKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeCard(true);
    }
  }

  private openCardAtCursor(): boolean {
    const view = this.view;
    if (!view) return false;
    const annotation = annotationAt(view.state, view.state.selection.main.head);
    if (!annotation) return false;
    view.dispatch({ effects: EditorView.scrollIntoView(annotation.from, { y: 'nearest', yMargin: 40 }) });
    this.openCard(annotation, true, true);
    return true;
  }

  private openCard(annotation: Annotation, pinned: boolean, focus: boolean): void {
    const view = this.view;
    if (!view) return;
    clearTimeout(this.closeTimer);
    this._popover = null;
    this._card = { annotation, pinned };
    this.focusCardAfterRender = focus;
    view.dispatch({ effects: setActiveTerm.of({ from: annotation.from, to: annotation.to }) });
    const conceptId = annotation.conceptId;
    this._lookups.load(annotation, () => {
      if (this._card?.annotation.conceptId === conceptId) this.requestUpdate();
    });
    this.requestUpdate();
  }

  private closeCard(refocus: boolean): void {
    clearTimeout(this.hoverTimer);
    clearTimeout(this.closeTimer);
    if (!this._card) return;
    const hadFocus = this.cardHasFocus();
    this._card = null;
    this.pointerInCard = false;
    if (this._speech.ttsOrigin === 'snippet') this._speech.stopSpeaking();
    this.view?.dispatch({ effects: setActiveTerm.of(null) });
    this.requestUpdate();
    if (refocus || hadFocus) this.view?.focus();
  }

  _retryLookup(providerId: string): void {
    if (!this._card) return;
    this._lookups.retry(this._card.annotation, providerId, () => this.requestUpdate());
    this.requestUpdate();
  }

  _cardSpeak(): void {
    const card = this._card;
    if (!card) return;
    if (this._speech.ttsStatus !== 'idle' && this._speech.ttsOrigin === 'snippet') {
      this._speech.stopSpeaking();
      return;
    }
    const definition = this._lookups.entries(card.annotation).find((e) => e.info?.definition)?.info?.definition;
    this._speech.speakSnippet(definition ? `${card.annotation.label}. ${definition}` : card.annotation.label);
  }

  private schedulePosition(): void {
    if (!this._card || this.positionFrame) return;
    this.positionFrame = requestAnimationFrame(() => {
      this.positionFrame = 0;
      this.positionCard();
    });
  }

  /** Places the card under (or above) its term. Written to `style` directly: no re-render needed. */
  private positionCard(): void {
    const view = this.view;
    const card = this.renderRoot.querySelector<HTMLElement>('.card');
    const frame = this.renderRoot.querySelector<HTMLElement>('.frame');
    if (!view || !card || !frame || !this._card) return;
    const { from, to } = this._card.annotation;
    const start = view.coordsAtPos(Math.min(from, view.state.doc.length), 1);
    const end = view.coordsAtPos(Math.min(to, view.state.doc.length), -1);
    const scroller = view.scrollDOM.getBoundingClientRect();
    if (!start || !end || end.bottom < scroller.top || start.top > scroller.bottom) {
      // The term scrolled out of sight: a card pointing at nothing is worse than none.
      this.closeCard(false);
      return;
    }
    const frameRect = frame.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const wrapped = end.top > start.top + 2;
    const spaceBelow = window.innerHeight - end.bottom;
    const below = spaceBelow >= height + 14 || spaceBelow >= start.top;
    const top = below ? end.bottom + 7 : start.top - height - 7;
    const anchorLeft = wrapped && below ? end.left - 40 : start.left - 10;
    const left = Math.max(8, Math.min(anchorLeft - frameRect.left, frameRect.width - width - 8));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top - frameRect.top)}px`;
    card.classList.add('placed');
  }

  // ----- popovers --------------------------------------------------------------------------

  private toggleMenu(name: PopoverName): void {
    this._popover = this._popover === name ? null : name;
    if (this._popover) this.closeCard(false);
    if (this._popover === 'speech') void this._speech.loadVoices();
    this.requestUpdate();
  }

  _closePopover(refocusTrigger: boolean): void {
    const name = this._popover;
    if (!name) return;
    this._popover = null;
    this.requestUpdate();
    if (refocusTrigger) {
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`[data-popover-trigger="${name}"]`)?.focus());
    }
  }

  /** Escape: closes the topmost transient surface. Returns false when there was nothing to close. */
  private dismiss(): boolean {
    if (this._popover) {
      this._closePopover(false);
      return true;
    }
    if (this._card) {
      this.closeCard(false);
      return true;
    }
    return false;
  }

  private readonly onDocumentPointerDown = (event: Event): void => {
    if (!this._popover && !this._card) return;
    const path = event.composedPath();
    const inside = (selector: string) => path.some((node) => node instanceof Element && node.matches(selector));
    if (this._popover && !inside('.popover') && !inside('[data-popover-trigger]')) {
      this._popover = null;
      this.requestUpdate();
    }
    if (this._card?.pinned && !inside('.card')) this.closeCard(false);
  };

  private onFrameKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (this._popover) {
      event.preventDefault();
      this._closePopover(true);
    }
  }

  _setRate(rate: number): void {
    this._speech.rate = rate;
    this.requestUpdate();
  }

  _setVoice(id: string): void {
    this._speech.voiceId = id;
    this.requestUpdate();
  }

  // ----- research --------------------------------------------------------------------------

  private contextFromSelection(): ConceptRef | undefined {
    const view = this.view;
    if (!view) return undefined;
    const { main } = view.state.selection;
    // A caret that was never placed by the user (still at 0) says nothing about intent.
    if (main.empty) return this.everFocused ? (annotationAt(view.state, main.head) ?? undefined) : undefined;
    const selected = view.state.sliceDoc(main.from, main.to).replace(/\s+/g, ' ').trim();
    if (!selected) return undefined;
    const term = annotationAt(view.state, main.from);
    if (term && term.from <= main.from && term.to >= main.to) return term;
    const label = selected.length > 160 ? selected.slice(0, 157) + '…' : selected;
    return { conceptId: `text:${label}`, label, type: 'other' };
  }

  _setResearchOpen(open: boolean): void {
    if (open) {
      this.openResearch();
      return;
    }
    this._researchOpen = false;
    this.requestUpdate();
    this.view?.focus();
  }

  _setDraft(text: string): void {
    const wasEmpty = !this._draft.trim();
    this._draft = text;
    // Only the enabled state of "Fragen" depends on the draft.
    if (wasEmpty !== !text.trim()) this.requestUpdate();
  }

  _ask(question: string): void {
    this._draft = question;
    this._activeCite = null;
    void this._research.ask(question);
    this.requestUpdate();
  }

  _showHistory(item: ResearchHistoryItem): void {
    this._activeCite = null;
    this._draft = item.question;
    this._research.show(item);
    this.renderRoot.querySelector('.research-scroll')?.scrollTo({ top: 0 });
  }

  _toggleCite(block: number, n: number): void {
    const same = this._activeCite?.block === block && this._activeCite.n === n;
    this._activeCite = same ? null : { block, n };
    this.requestUpdate();
  }

  _panelKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (this._activeCite) {
      this._activeCite = null;
      this.requestUpdate();
    } else if (this._research.running) this._research.cancel();
    else this._setResearchOpen(false);
  }

  private answerText(answer: ResearchAnswer): string {
    return answerToPlainText(answer, this._s.sourcesHeading);
  }

  _insertAnswer(): void {
    const view = this.view;
    const answer = this._research.answer;
    if (!view || !answer || !answer.grounded) return;
    const { from, to } = view.state.selection.main;
    this.insertText(
      padBlock(this.answerText(answer), view.state.sliceDoc(Math.max(0, from - 2), from), view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 1))),
    );
    this.notify(this._s.inserted, 'info');
  }

  async _copyAnswer(): Promise<void> {
    const answer = this._research.answer;
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(this.answerText(answer));
      this._copied = true;
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => {
        this._copied = false;
        this.requestUpdate();
      }, 1800);
      this.requestUpdate();
    } catch {
      this.notify(this._s.copyFailed, 'error');
    }
  }

  // ----- rendering -------------------------------------------------------------------------

  /** The compact field has no toolbar; with a dictation service it gets a microphone in its corner. */
  private renderCompactMic(): TemplateResult | typeof nothing {
    const s = this._s;
    const speech = this._speech;
    if (!this._registry.activeOne('stt') || this.readonly) return nothing;
    const recording = speech.sttStatus === 'recording';
    const label = recording ? s.dictateStop : s.dictate;
    return html`<button type="button" class="mic ${recording ? 'recording' : ''}" data-action="dictate" title=${label} aria-label=${label}
      aria-pressed=${speech.sttStatus === 'idle' ? 'false' : 'true'}
      @mousedown=${(event: Event) => event.preventDefault()} @click=${() => speech.toggleDictation()}>
      ${recording ? html`<span class="rec-dot" aria-hidden="true"></span>` : icon('mic')}
    </button>`;
  }

  private renderToolbar(): TemplateResult | typeof nothing {
    const s = this._s;
    const registry = this._registry;
    const hasTts = registry.list('tts').length > 0;
    const hasStt = registry.list('stt').length > 0;
    const hasResearch = registry.list('research').length > 0;
    const hasAny = hasTts || hasStt || hasResearch || registry.list('recognizers').length > 0 || registry.list('lookups').length > 0;
    if (!hasAny) return nothing;
    const speech = this._speech;
    const reading = speech.ttsStatus !== 'idle' && speech.ttsOrigin === 'document';
    // Mouse clicks on the speech controls must not pull the caret out of the text.
    const keepFocus = (event: Event) => event.preventDefault();

    return html`<div class="toolbar" role="toolbar" aria-label=${s.toolbarLabel}>
      ${hasTts
        ? html`<div class="group" data-group="tts">
            ${reading
              ? html`<button type="button" class="btn" data-action=${speech.ttsStatus === 'paused' ? 'resume' : 'pause'} @mousedown=${keepFocus}
                    @click=${() => (speech.ttsStatus === 'paused' ? speech.resume() : speech.pause())}>
                    ${icon(speech.ttsStatus === 'paused' ? 'play' : 'pause')}<span class="label">${speech.ttsStatus === 'paused' ? s.resume : s.pause}</span>
                  </button>
                  <button type="button" class="btn" data-action="stop" @mousedown=${keepFocus} @click=${() => speech.stopSpeaking()}>
                    ${icon('stop')}<span class="label">${s.stop}</span>
                  </button>`
              : html`<button type="button" class="btn" data-action="read" title=${s.readAloudHint} ?disabled=${!registry.activeOne('tts')}
                    @mousedown=${keepFocus} @click=${() => speech.speakDocument()}>
                    ${icon('play')}<span class="label">${s.readAloud}</span>
                  </button>`}
            <button type="button" class="btn icon-only" data-popover-trigger="speech" aria-label=${s.speechOptions} title=${s.speechOptions}
              aria-haspopup="dialog" aria-expanded=${this._popover === 'speech' ? 'true' : 'false'} @click=${() => this.toggleMenu('speech')}>
              ${icon('chevron')}
            </button>
          </div>`
        : nothing}
      ${hasTts && hasStt ? html`<span class="sep" role="separator"></span>` : nothing}
      ${hasStt
        ? html`<button type="button" class="btn ${speech.sttStatus === 'recording' ? 'recording' : ''}" data-action="dictate"
            aria-pressed=${speech.sttStatus === 'idle' ? 'false' : 'true'} ?disabled=${!registry.activeOne('stt') || this.readonly}
            @mousedown=${keepFocus} @click=${() => speech.toggleDictation()}>
            ${speech.sttStatus === 'recording' ? html`<span class="rec-dot" aria-hidden="true"></span>` : icon('mic')}
            <span class="label">${speech.sttStatus === 'recording' ? s.dictateStop : s.dictate}</span>
          </button>`
        : nothing}
      <span class="spacer"></span>
      ${hasResearch
        ? html`<button type="button" class="btn" data-action="research" aria-pressed=${this._researchOpen ? 'true' : 'false'}
            @click=${() => this._setResearchOpen(!this._researchOpen)}>
            ${icon('research')}<span class="label">${s.research}</span>
          </button>`
        : nothing}
      <button type="button" class="btn icon-only" data-popover-trigger="settings" aria-label=${s.settings} title=${s.settings}
        aria-haspopup="dialog" aria-expanded=${this._popover === 'settings' ? 'true' : 'false'} @click=${() => this.toggleMenu('settings')}>
        ${icon('gear')}
      </button>
    </div>`;
  }

  private renderStatus(): TemplateResult | typeof nothing {
    const s = this._s;
    const registry = this._registry;
    if (registry.list('recognizers').length === 0) return nothing;
    const active = registry.active('recognizers');
    const remote = active.filter((r) => r.locality === 'remote');
    const present = CONCEPT_TYPES.filter((type) => this._counts.has(type));
    const term = this.view?.hasFocus ? this.cursorTerm : null;

    return html`<div class="status chrome" role="group" aria-label=${s.statusLabel}>
      <button type="button" class="btn" data-popover-trigger="legend" aria-haspopup="dialog"
        aria-label=${s.legend} aria-expanded=${this._popover === 'legend' ? 'true' : 'false'} @click=${() => this.toggleMenu('legend')}>
        ${icon('key')}<span class="label">${s.legend}</span>
      </button>
      <div class="counts">
        ${active.length === 0
          ? html`<span class="count" style="cursor:default">${s.noRecognizer}</span>`
          : present.length === 0
            ? html`<span class="count" style="cursor:default">${s.noTerms}</span>`
            : present.map((type) => {
                const on = !this._hidden.has(type);
                return html`<button type="button" class="count" data-type=${type} aria-pressed=${on ? 'true' : 'false'}
                  title=${s.showType(s.conceptType[type])} @click=${() => this._toggleType(type)}>
                  <span class=${termClass({ type })}>${s.conceptType[type]}</span><span class="n">${this._counts.get(type)}</span>
                </button>`;
              })}
      </div>
      <div class="meta">
        ${term
          ? html`<span class="cursor-term" title=${`${this._modKey}+I ${s.shortcutCard}`}><kbd>${this._modKey}</kbd> <kbd>I</kbd> ${term.label}</span>`
          : nothing}
        ${this.recognizerError ? html`<span class="privacy remote" role="status">${icon('alert')}${this.recognizerError}</span>` : nothing}
        ${active.length === 0
          ? nothing
          : remote.length
            ? html`<span class="privacy remote" data-privacy="remote" title=${s.remoteActiveTitle(remote.map((r) => r.label).join(', '))}>
                ${icon('cloud')}${s.remoteActive}
              </span>`
            : html`<span class="privacy" data-privacy="local" title=${s.localOnlyTitle}>${icon('shield')}${s.localOnly}</span>`}
        ${this.slowRun
          ? html`<span class="latency" title=${s.recognizing}><span class="spinner" style="display:inline-block;vertical-align:-2px"></span></span>`
          : this.latency !== null
            ? html`<span class="latency" title=${s.latencyTitle}>${s.latency(this.latency)}</span>`
            : nothing}
      </div>
    </div>`;
  }

  protected override render(): TemplateResult {
    return html`<div class="frame ${this.narrow ? 'narrow' : ''}" part="frame" @keydown=${(e: KeyboardEvent) => this.onFrameKeydown(e)}>
      ${this.compact ? this.renderCompactMic() : this.renderToolbar()}
      <div class="body">
        <div class="doc" part="document"><div class="cm-host"></div></div>
        ${renderResearch(this)}
      </div>
      ${this.compact ? nothing : this.renderStatus()}
      ${this._popover === 'settings' ? renderSettings(this) : nothing}
      ${this._popover === 'legend' ? renderLegend(this) : nothing}
      ${this._popover === 'speech' ? renderSpeechOptions(this) : nothing}
      ${renderCard(this)}
      ${this.toast
        ? html`<div class=${this.toast.kind === 'status' ? 'sr-only' : `toast ${this.toast.kind}`} data-toast=${this.toast.kind}
            role=${this.toast.kind === 'error' ? 'alert' : 'status'}>${this.toast.message}</div>`
        : nothing}
    </div>`;
  }
}

if (!customElements.get('med-editor')) customElements.define('med-editor', MedEditor);

declare global {
  interface HTMLElementTagNameMap {
    'med-editor': MedEditor;
  }
}
