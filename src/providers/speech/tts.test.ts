// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleTts, createWebSpeechTts } from './index.ts';
import type { AudioLike } from './openai-tts.ts';
import { sortVoices } from './web-speech-tts.ts';

const voice = (name: string, lang: string, localService = true, isDefault = false) =>
  ({ name, lang, localService, default: isDefault, voiceURI: `uri:${name}` }) as SpeechSynthesisVoice;
const VOICES = [voice('Samantha', 'en-US'), voice('Google Deutsch', 'de-DE', false), voice('Anna', 'de-DE'), voice('Petra', 'de-AT')];

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onboundary: ((e: { name: string; charIndex: number; charLength?: number }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeSynth(opts: { boundaries?: boolean; failAt?: number } = {}) {
  const spoken: FakeUtterance[] = [];
  let cancelled = false;
  const synth = {
    spoken,
    paused: false,
    getVoices: () => VOICES,
    speak(u: FakeUtterance) {
      spoken.push(u);
      queueMicrotask(() => {
        if (cancelled) return;
        if (opts.failAt === spoken.length) return u.onerror?.({ error: 'synthesis-failed' });
        u.onstart?.();
        if (opts.boundaries) {
          for (const m of u.text.matchAll(/\S+/g)) u.onboundary?.({ name: 'word', charIndex: m.index, charLength: m[0].length });
        }
        u.onend?.();
      });
    },
    cancel() {
      cancelled = spoken.length > 0;
    },
    pause() {
      synth.paused = true;
    },
    resume() {
      synth.paused = false;
    },
  };
  return synth;
}
const asSynth = (s: ReturnType<typeof fakeSynth>) => s as unknown as SpeechSynthesis;
const Utterance = FakeUtterance as unknown as typeof SpeechSynthesisUtterance;

describe('createWebSpeechTts', () => {
  const text = `${'Der erste Satz ist ziemlich lang und beschreibt den Aufnahmebefund sehr ausführlich. '.repeat(3)}Zweiter Abschnitt folgt hier.`;

  it('lists voices for the language, exact region and on-device voices first', async () => {
    expect(sortVoices(VOICES, 'de').map((v) => v.name)).toEqual(['Anna', 'Google Deutsch', 'Petra']);
    expect(sortVoices(VOICES, 'de-AT')[0]!.name).toBe('Petra');
    const tts = createWebSpeechTts({ synth: asSynth(fakeSynth()), Utterance });
    expect(await tts.voices!({ language: 'de' })).toEqual([
      { id: 'uri:Anna', label: 'Anna', language: 'de-DE' },
      { id: 'uri:Google Deutsch', label: 'Google Deutsch (online)', language: 'de-DE' },
      { id: 'uri:Petra', label: 'Petra', language: 'de-AT' },
    ]);
    expect(tts.locality).toBe('local');
    expect(tts.description).toMatch(/Netzwerkstimmen/);
  });

  it('speaks sentence-sized utterances and maps word boundaries to offsets in the full text', async () => {
    const synth = fakeSynth({ boundaries: true });
    const boundaries: [number, number][] = [];
    const handle = createWebSpeechTts({ synth: asSynth(synth), Utterance }).speak(text, {
      language: 'de',
      rate: 1.2,
      onBoundary: (i, l) => boundaries.push([i, l]),
    });
    await handle.done;
    expect(synth.spoken.length).toBeGreaterThan(1);
    expect(synth.spoken.map((u) => u.text).join('')).toBe(text);
    expect(synth.spoken.every((u) => u.text.length <= 260 && u.voice?.name === 'Anna' && u.rate === 1.2)).toBe(true);
    const words = boundaries.slice(1).map(([i, l]) => text.slice(i, i + l));
    expect(words).toEqual(text.match(/\S+/g));
  });

  it('falls back to sentence-level boundaries when the voice reports none', async () => {
    const synth = fakeSynth();
    const boundaries: [number, number][] = [];
    await createWebSpeechTts({ synth: asSynth(synth), Utterance }).speak(text, { onBoundary: (i, l) => boundaries.push([i, l]) }).done;
    expect(boundaries).toHaveLength(synth.spoken.length);
    expect(boundaries[0]![0]).toBe(0);
    expect(text.slice(boundaries.at(-1)![0], boundaries.at(-1)![0] + boundaries.at(-1)![1])).toMatch(/Zweiter Abschnitt folgt hier\.$/);
  });

  it('cancel resolves and stops the queue; errors reject', async () => {
    const synth = fakeSynth();
    const handle = createWebSpeechTts({ synth: asSynth(synth), Utterance }).speak(text);
    handle.cancel();
    await expect(handle.done).resolves.toBeUndefined();
    expect(synth.spoken.length).toBeLessThanOrEqual(1);

    const failing = createWebSpeechTts({ synth: asSynth(fakeSynth({ failAt: 2 })), Utterance }).speak(text);
    await expect(failing.done).rejects.toThrow(/synthesis-failed/);
  });
});

class FakeAudio implements AudioLike {
  static played: string[] = [];
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  async play() {
    this.paused = false;
    FakeAudio.played.push(this.src);
    setTimeout(() => {
      if (!this.paused) this.onended?.();
    }, 5);
  }
  pause() {
    this.paused = true;
  }
}

describe('createOpenAiCompatibleTts', () => {
  const text = `${'Dies ist ein längerer Satz für die Sprachausgabe über einen kompatiblen Server, der in Abschnitten synthetisiert wird. '.repeat(6)}Ende.`;
  const setup = (status = 200) => {
    FakeAudio.played = [];
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/audio/voices')) return new Response('{}', { status: 404 });
      bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
      return status === 200 ? new Response(new Blob(['mp3'], { type: 'audio/mpeg' })) : new Response('{"error":{"message":"voice unknown"}}', { status });
    }) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
    return { bodies, fetch };
  };

  it('synthesises chunk by chunk, reports boundaries and plays everything in order', async () => {
    const { bodies, fetch } = setup();
    const tts = createOpenAiCompatibleTts({ baseUrl: 'http://localhost:8880/v1', voice: 'thorsten', fetch, createAudio: () => new FakeAudio() });
    const boundaries: [number, number][] = [];
    await tts.speak(text, { rate: 1.5, onBoundary: (i, l) => boundaries.push([i, l]) }).done;

    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.map((b) => b.input).join(' ')).toBe(text);
    expect(bodies[0]).toMatchObject({ model: 'tts-1', voice: 'thorsten', response_format: 'mp3', speed: 1.5 });
    expect(FakeAudio.played).toHaveLength(bodies.length);
    expect(boundaries).toHaveLength(bodies.length);
    expect(boundaries.map(([i, l]) => text.slice(i, i + l)).join(' ')).toBe(text);
    expect(tts.locality).toBe('local');
    expect((await tts.voices!()).map((v) => v.id)).toContain('alloy');
  });

  it('pauses, resumes and cancels', async () => {
    const { fetch } = setup();
    const audio = new FakeAudio();
    const handle = createOpenAiCompatibleTts({ baseUrl: '/api/openai', fetch, createAudio: () => audio }).speak(text);
    handle.pause();
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeAudio.played).toHaveLength(0);
    handle.resume();
    await new Promise((r) => setTimeout(r, 2));
    expect(FakeAudio.played).toHaveLength(1);
    handle.cancel();
    await expect(handle.done).resolves.toBeUndefined();
    const playedAtCancel = FakeAudio.played.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeAudio.played).toHaveLength(playedAtCancel);
    expect(audio.paused).toBe(true);
  });

  it('rejects with the server error', async () => {
    const { fetch } = setup(400);
    const handle = createOpenAiCompatibleTts({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', fetch, createAudio: () => new FakeAudio() }).speak('Hallo.');
    await expect(handle.done).rejects.toThrow(/HTTP 400: voice unknown/);
  });
});
