// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleStt, createWebSpeechStt } from './index.ts';
import type { RecognitionLike } from './web-speech-stt.ts';

type Result = ArrayLike<{ transcript: string }> & { isFinal: boolean };
const result = (transcript: string, isFinal: boolean): Result => Object.assign([{ transcript }], { isFinal });

class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition;
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: RecognitionLike['onstart'] = null;
  onend: RecognitionLike['onend'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onresult: RecognitionLike['onresult'] = null;
  starts = 0;
  failWith?: string;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.starts++;
    queueMicrotask(() => {
      if (this.failWith) {
        this.onerror?.({ error: this.failWith });
        this.onend?.();
      } else {
        this.onstart?.();
      }
    });
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    this.stop();
  }
  emit(results: Result[], resultIndex = 0) {
    this.onresult?.({ resultIndex, results });
  }
}

describe('createWebSpeechStt', () => {
  it('is marked remote and warns about Google in its description', () => {
    const stt = createWebSpeechStt({ Recognition: FakeRecognition });
    expect(stt.locality).toBe('remote');
    expect(stt.description).toMatch(/Google/);
    expect(stt.description).toMatch(/Patientendaten/);
  });

  it('delivers interim and normalised final results and restarts after browser timeouts', async () => {
    const finals: string[] = [];
    const interims: string[] = [];
    const session = await createWebSpeechStt({ Recognition: FakeRecognition }).start({
      language: 'de',
      onFinal: (t) => finals.push(t),
      onInterim: (t) => interims.push(t),
    });
    const rec = FakeRecognition.last;
    expect(rec).toMatchObject({ lang: 'de-DE', continuous: true, interimResults: true });

    rec.emit([result('der Patient', false)]);
    rec.emit([result('der Patient ist stabil Punkt', true)]);
    rec.emit([result('der Patient ist stabil Punkt', true), result(' neue', false)], 1);
    expect(finals).toEqual(['der Patient ist stabil.']);
    expect(interims).toEqual(['der Patient', '', 'neue']);

    rec.onerror?.({ error: 'no-speech' });
    rec.onend?.(); // Chrome ends the session on silence
    expect(rec.starts).toBe(2);

    await session.stop();
    expect(rec.starts).toBe(2);
    expect(interims.at(-1)).toBe('');
  });

  it('rejects start on permission errors and reports later errors', async () => {
    class Denied extends FakeRecognition {
      override failWith = 'not-allowed';
    }
    await expect(createWebSpeechStt({ Recognition: Denied }).start({ onFinal: () => {} })).rejects.toThrow(/Mikrofon/);

    const onError = vi.fn();
    await createWebSpeechStt({ Recognition: FakeRecognition }).start({ onFinal: () => {}, onError });
    FakeRecognition.last.onerror?.({ error: 'network' });
    FakeRecognition.last.onend?.();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/nicht erreichbar/) }));
    expect(FakeRecognition.last.starts).toBe(1);
  });
});

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (mime: string) => mime === 'audio/webm';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: ((e: unknown) => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? '';
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([`audio-${FakeRecorder.instances.indexOf(this)}`]) });
      this.onstop?.({});
    });
  }
}

function fakeAudioContext(level: { value: number }) {
  return class {
    createAnalyser() {
      return {
        fftSize: 0,
        getFloatTimeDomainData(target: Float32Array) {
          target.fill(level.value);
        },
      };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    async close() {}
  } as unknown as typeof AudioContext;
}

describe('createOpenAiCompatibleStt', () => {
  const setup = () => {
    FakeRecorder.instances = [];
    const tracks = [{ stop: vi.fn() }];
    const forms: FormData[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      const n = forms.length;
      // the first transcription is slower than the second – order must still be kept
      await new Promise((r) => setTimeout(r, n === 1 ? 30 : 1));
      return new Response(JSON.stringify({ text: n === 1 ? ' Erster Teil Komma' : ' zweiter Teil Punkt' }));
    }) as unknown as typeof globalThis.fetch;
    return {
      forms,
      tracks,
      base: {
        fetch,
        getUserMedia: async () => ({ getTracks: () => tracks }) as unknown as MediaStream,
        MediaRecorder: FakeRecorder as unknown as typeof MediaRecorder,
      },
    };
  };

  it('cuts segments at pauses, skips silence and delivers transcripts in order', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const { forms, tracks, base } = setup();
      const level = { value: 0 };
      const finals: string[] = [];
      const stt = createOpenAiCompatibleStt({ ...base, baseUrl: 'http://localhost:8000/v1', prompt: 'Arztbrief', AudioContext: fakeAudioContext(level) });
      const session = await stt.start({ language: 'de-DE', onFinal: (t) => finals.push(t) });
      expect(stt.locality).toBe('local');

      level.value = 0.2; // speaking
      vi.advanceTimersByTime(2000);
      expect(FakeRecorder.instances).toHaveLength(1);
      level.value = 0; // pause → segment 1 is cut
      vi.advanceTimersByTime(1000);
      expect(FakeRecorder.instances).toHaveLength(2);
      vi.advanceTimersByTime(5000); // silence only: no further cut
      expect(FakeRecorder.instances).toHaveLength(2);
      level.value = 0.2;
      vi.advanceTimersByTime(2000);
      level.value = 0;
      vi.advanceTimersByTime(1000); // segment 2 is cut, segment 3 stays silent
      expect(FakeRecorder.instances).toHaveLength(3);

      vi.useRealTimers();
      await session.stop();
      expect(forms).toHaveLength(2); // the silent third segment is not sent
      expect(finals).toEqual(['Erster Teil,', 'zweiter Teil.']);
      const form = forms[0]!;
      expect(form.get('model')).toBe('whisper-1');
      expect(form.get('language')).toBe('de');
      expect(form.get('prompt')).toBe('Arztbrief');
      expect((form.get('file') as File).name).toBe('diktat.webm');
      expect(await (form.get('file') as File).text()).toBe('audio-0');
      expect(tracks[0]!.stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records one segment and sends it on stop when pause detection is unavailable', async () => {
    const { forms, base } = setup();
    const finals: string[] = [];
    const stt = createOpenAiCompatibleStt({ ...base, baseUrl: '/api/openai', AudioContext: null, normalize: false });
    const session = await stt.start({ onFinal: (t) => finals.push(t) });
    await session.stop();
    expect(forms).toHaveLength(1);
    expect(finals).toEqual(['Erster Teil Komma']);
    expect(stt.locality).toBe('remote');
  });

  it('reports a denied microphone and transcription errors', async () => {
    const { base } = setup();
    const denied = createOpenAiCompatibleStt({ ...base, baseUrl: '/api/openai', getUserMedia: async () => Promise.reject(new Error('NotAllowedError')) });
    await expect(denied.start({ onFinal: () => {} })).rejects.toThrow(/Mikrofon/);

    const onError = vi.fn();
    const failing = createOpenAiCompatibleStt({
      ...base,
      baseUrl: '/api/openai',
      AudioContext: null,
      fetch: (async () => new Response('{"error":"model missing"}', { status: 500 })) as unknown as typeof globalThis.fetch,
    });
    const session = await failing.start({ onFinal: () => {}, onError });
    await session.stop();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/HTTP 500: model missing/) }));
  });
});
