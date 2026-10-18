import { isolateHistory } from '@codemirror/commands';
import type { ChangeDesc } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { DictationSession, SpeechHandle, SttProvider, TtsProvider, Voice } from '../core/types.ts';
import type { Strings } from './i18n.ts';
import { setInterimText, setSpokenRange } from './marks.ts';
import { errorMessage, isAbort, spaceDictation } from './text-utils.ts';

export interface SpeechHost {
  view(): EditorView | undefined;
  tts(): TtsProvider | undefined;
  stt(): SttProvider | undefined;
  language(): string | undefined;
  strings(): Strings;
  readonly(): boolean;
  changed(): void;
  notify(message: string, kind: 'info' | 'error' | 'status'): void;
}

export const RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export class SpeechController {
  ttsStatus: 'idle' | 'speaking' | 'paused' = 'idle';
  /** What is being read: the document (with range highlight) or a snippet from the concept card. */
  ttsOrigin: 'document' | 'snippet' = 'document';
  rate = 1;
  voiceId = '';
  voices: Voice[] = [];
  sttStatus: 'idle' | 'starting' | 'recording' = 'idle';

  private readonly host: SpeechHost;
  private handle: SpeechHandle | null = null;
  private speakToken = 0;
  /** Document offset of the first spoken character; moves with edits made while reading. */
  private base = 0;
  private spokenText = '';
  private voicesFor: TtsProvider | undefined;
  private session: DictationSession | null = null;
  private sttToken = 0;

  constructor(host: SpeechHost) {
    this.host = host;
  }

  // ----- reading aloud ---------------------------------------------------------------------

  async loadVoices(): Promise<void> {
    const provider = this.host.tts();
    if (provider === this.voicesFor) return;
    this.voicesFor = provider;
    this.voices = [];
    if (!provider?.voices) {
      this.host.changed();
      return;
    }
    try {
      const language = this.host.language();
      const voices = await provider.voices(language ? { language } : {});
      if (this.voicesFor !== provider) return;
      this.voices = voices;
      if (!voices.some((v) => v.id === this.voiceId)) this.voiceId = '';
    } catch {
      this.voices = [];
    }
    this.host.changed();
  }

  /** Reads the selection, or from the caret to the end when nothing is selected. */
  speakDocument(): void {
    const view = this.host.view();
    if (!view) return;
    const { main } = view.state.selection;
    let from = main.from;
    let to = main.empty ? view.state.doc.length : main.to;
    if (main.empty && !view.state.sliceDoc(from, to).trim()) from = 0;
    let text = view.state.sliceDoc(from, to);
    const lead = text.length - text.trimStart().length;
    from += lead;
    text = text.trim();
    if (!text) {
      this.host.notify(this.host.strings().nothingToRead, 'info');
      return;
    }
    this.start(text, 'document', from);
  }

  speakSnippet(text: string): void {
    if (text.trim()) this.start(text.trim(), 'snippet', 0);
  }

  private start(text: string, origin: 'document' | 'snippet', base: number): void {
    const provider = this.host.tts();
    if (!provider) return;
    this.stopSpeaking();
    const token = ++this.speakToken;
    this.base = base;
    this.spokenText = text;
    this.ttsOrigin = origin;
    const language = this.host.language();
    try {
      this.handle = provider.speak(text, {
        rate: this.rate,
        ...(this.voiceId ? { voice: this.voiceId } : {}),
        ...(language ? { language } : {}),
        ...(origin === 'document'
          ? { onBoundary: (index: number, length: number) => token === this.speakToken && this.boundary(index, length) }
          : {}),
      });
    } catch (error) {
      this.host.notify(this.host.strings().ttsFailed(errorMessage(error)), 'error');
      return;
    }
    this.ttsStatus = 'speaking';
    this.host.changed();
    const finish = (error?: unknown) => {
      if (token !== this.speakToken) return;
      this.handle = null;
      this.ttsStatus = 'idle';
      this.clearSpoken();
      if (error !== undefined && !isAbort(error)) this.host.notify(this.host.strings().ttsFailed(errorMessage(error)), 'error');
      this.host.changed();
    };
    this.handle.done.then(() => finish(), finish);
  }

  private boundary(index: number, length: number): void {
    const view = this.host.view();
    if (!view) return;
    // Some engines report no length; fall back to the word starting at `index`.
    const len = length > 0 ? length : (/^\S+/.exec(this.spokenText.slice(index))?.[0].length ?? 0);
    if (len <= 0) return;
    const from = this.base + index;
    const to = Math.min(from + len, view.state.doc.length);
    if (from >= to) return;
    view.dispatch({
      effects: [
        setSpokenRange.of({ from, to }),
        // Follow along only while the user is not working in the text themselves.
        ...(view.hasFocus ? [] : [EditorView.scrollIntoView(from, { y: 'nearest', yMargin: 48 })]),
      ],
    });
  }

  private clearSpoken(): void {
    const view = this.host.view();
    if (view) view.dispatch({ effects: setSpokenRange.of(null) });
  }

  pause(): void {
    if (this.ttsStatus !== 'speaking') return;
    this.handle?.pause();
    this.ttsStatus = 'paused';
    this.host.changed();
  }

  resume(): void {
    if (this.ttsStatus !== 'paused') return;
    this.handle?.resume();
    this.ttsStatus = 'speaking';
    this.host.changed();
  }

  stopSpeaking(): void {
    if (!this.handle) return;
    this.speakToken++;
    const handle = this.handle;
    this.handle = null;
    // Providers may reject `done` on cancel; that is not an error worth reporting.
    handle.done.catch(() => {});
    try {
      handle.cancel();
    } catch {
      /* already finished */
    }
    this.ttsStatus = 'idle';
    this.clearSpoken();
    this.host.changed();
  }

  /** Keeps the spoken-range offsets valid while the user edits during playback. */
  docChanged(changes: ChangeDesc): void {
    if (this.ttsStatus !== 'idle' && this.ttsOrigin === 'document') this.base = changes.mapPos(this.base, 1);
  }

  // ----- dictation -------------------------------------------------------------------------

  toggleDictation(): void {
    if (this.sttStatus === 'idle') void this.startDictation();
    else void this.stopDictation();
  }

  async startDictation(): Promise<void> {
    const provider = this.host.stt();
    if (!provider || this.sttStatus !== 'idle' || this.host.readonly()) return;
    const token = ++this.sttToken;
    this.sttStatus = 'starting';
    this.host.changed();
    const language = this.host.language();
    try {
      const session = await provider.start({
        ...(language ? { language } : {}),
        onInterim: (text) => token === this.sttToken && this.setInterim(text),
        onFinal: (text) => token === this.sttToken && this.insertFinal(text),
        onError: (error) => token === this.sttToken && this.dictationFailed(error),
      });
      if (token !== this.sttToken) {
        // Stopped (or failed) while the provider was still starting up.
        void session.stop().catch(() => {});
        return;
      }
      this.session = session;
      this.sttStatus = 'recording';
      this.host.notify(this.host.strings().dictationStarted, 'status');
      this.host.changed();
    } catch (error) {
      if (token === this.sttToken) this.dictationFailed(error);
    }
  }

  async stopDictation(): Promise<void> {
    if (this.sttStatus === 'idle') return;
    const session = this.session;
    this.session = null;
    const token = this.sttToken;
    if (session) {
      try {
        // Pending final chunks are still delivered (and inserted) before this resolves.
        await session.stop();
      } catch {
        /* nothing left to deliver */
      }
    }
    if (token !== this.sttToken) return;
    this.sttToken++;
    this.sttStatus = 'idle';
    this.setInterim('');
    this.host.notify(this.host.strings().dictationStopped, 'status');
    this.host.changed();
  }

  private dictationFailed(error: unknown): void {
    const s = this.host.strings();
    const name = error instanceof Error ? error.name : '';
    const message = errorMessage(error);
    const denied = name === 'NotAllowedError' || name === 'SecurityError' || /not-allowed|permission|denied/i.test(message);
    const missing = name === 'NotFoundError' || /audio-capture|no microphone/i.test(message);
    this.sttToken++;
    const session = this.session;
    this.session = null;
    void session?.stop().catch(() => {});
    this.sttStatus = 'idle';
    this.setInterim('');
    this.host.notify(denied ? s.micDenied : missing ? s.micMissing : s.sttFailed(message), 'error');
    this.host.changed();
  }

  private setInterim(text: string): void {
    const view = this.host.view();
    if (view) view.dispatch({ effects: setInterimText.of(text) });
  }

  private insertFinal(chunk: string): void {
    const view = this.host.view();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const text = spaceDictation(
      chunk,
      view.state.sliceDoc(Math.max(0, from - 2), from),
      view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 1)),
    );
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      effects: setInterimText.of(''),
      // Each dictated chunk is exactly one undo step, never merged with typing around it.
      annotations: isolateHistory.of('full'),
      userEvent: 'input.dictate',
      scrollIntoView: true,
    });
  }

  dispose(): void {
    this.stopSpeaking();
    void this.stopDictation();
  }
}
