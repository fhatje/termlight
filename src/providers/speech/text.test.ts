// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { splitIntoChunks, toSpeechLocale } from './chunking.ts';
import { normalizeDictation } from './normalize-dictation.ts';

describe('splitIntoChunks', () => {
  const text =
    'Der Patient erhielt Metamizol 1 g i.v. bei Schmerzen. Am 3. Tag z. B. trat Fieber auf! Danach Besserung.\n\nEntlassung in gutem Allgemeinzustand.';

  it('keeps exact offsets and loses no text', () => {
    const chunks = splitIntoChunks(text, 40, 80);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });

  it('splits at sentence ends but not at abbreviations or ordinals', () => {
    expect(splitIntoChunks(text, 1, 200).map((c) => c.text.trim())).toEqual([
      'Der Patient erhielt Metamizol 1 g i.v. bei Schmerzen.',
      'Am 3. Tag z. B. trat Fieber auf!',
      'Danach Besserung.',
      'Entlassung in gutem Allgemeinzustand.',
    ]);
  });

  it('merges short sentences up to the target and never across paragraphs', () => {
    const merged = splitIntoChunks(text, 500, 600).map((c) => c.text.trim());
    expect(merged).toHaveLength(2);
    expect(merged[1]).toBe('Entlassung in gutem Allgemeinzustand.');
  });

  it('cuts overlong sentences at commas or spaces', () => {
    const long = `${'Wort, '.repeat(100)}Ende.`;
    const chunks = splitIntoChunks(long, 100, 120);
    expect(chunks.every((c) => c.text.length <= 120)).toBe(true);
    expect(chunks.map((c) => c.text).join('')).toBe(long);
  });

  it('handles empty input and maps locales', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   \n ')).toEqual([]);
    expect(toSpeechLocale('de')).toBe('de-DE');
    expect(toSpeechLocale('de-CH')).toBe('de-CH');
    expect(toSpeechLocale(undefined)).toBe('de-DE');
  });
});

describe('normalizeDictation', () => {
  it('turns spoken German punctuation into characters', () => {
    expect(normalizeDictation('der Patient ist stabil Komma keine Dyspnoe Punkt neue Zeile Entlassung morgen Punkt')).toBe(
      'der Patient ist stabil, keine Dyspnoe.\nEntlassung morgen.',
    );
    expect(normalizeDictation('Diagnosen Doppelpunkt Absatz Pneumonie Klammer auf links Klammer zu Fragezeichen')).toBe('Diagnosen:\n\nPneumonie (links)?');
  });

  it('copes with the punctuation Whisper adds around the command words', () => {
    expect(normalizeDictation('Der Patient ist stabil, Komma, keine Dyspnoe. Punkt. Neuer Absatz. Entlassung morgen.')).toBe(
      'Der Patient ist stabil, keine Dyspnoe.\n\nEntlassung morgen.',
    );
  });

  it('leaves compounds and already punctuated text alone', () => {
    expect(normalizeDictation('Druckschmerz am McBurney-Punkt, Kommazahl 3,5.')).toBe('Druckschmerz am McBurney-Punkt, Kommazahl 3,5.');
    expect(normalizeDictation('Schon fertig. Kein Befehl.')).toBe('Schon fertig. Kein Befehl.');
  });

  it('supports English and passes other languages through', () => {
    expect(normalizeDictation('no fever comma no cough period new line discharge tomorrow full stop', 'en-US')).toBe('no fever, no cough.\nDischarge tomorrow.');
    expect(normalizeDictation('  kein Fieber Komma ', 'it')).toBe('kein Fieber Komma');
  });

  it('supports French', () => {
    expect(normalizeDictation('pas de fièvre virgule pas de toux point à la ligne poumons normaux point', 'fr')).toBe('pas de fièvre, pas de toux.\nPoumons normaux.');
    expect(normalizeDictation('conclusion deux points embolie pulmonaire point d\'interrogation', 'fr')).toBe('conclusion: embolie pulmonaire?');
  });
});

describe('normalizeDictation capitalisation', () => {
  it('capitalises only after punctuation it inserted itself', () => {
    expect(normalizeDictation('Metamizol 1 g i.v. gegeben Punkt danach beschwerdefrei Fragezeichen nein')).toBe(
      'Metamizol 1 g i.v. gegeben. Danach beschwerdefrei? Nein',
    );
    expect(normalizeDictation('befund Doppelpunkt unauffällig Punkt Absatz weiter')).toBe('befund: unauffällig.\n\nWeiter');
  });
});
