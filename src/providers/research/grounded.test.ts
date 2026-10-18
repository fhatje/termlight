// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider, LlmRequest, ResearchProgress, ResearchQuery, ResearchSource, SourceDocument } from '../../core/types.ts';
import { createGroundedResearch, RESEARCH_DISCLAIMER_DE } from './index.ts';

const label: SourceDocument = {
  id: 'metamizole-label',
  title: 'Metamizole 500 mg tablets',
  url: 'https://labels.example/metamizole',
  source: 'labels',
  publisher: 'Example Medicines Agency',
  language: 'en',
  date: '2024-03-01',
  passages: [
    { heading: 'Contraindications', text: 'Metamizole is contraindicated in patients with a history of agranulocytosis. It must not be used in the third trimester of pregnancy.' },
    { heading: 'Storage', text: 'Store below 25 °C.' },
  ],
};
const wiki: SourceDocument = {
  id: 'Metamizol',
  title: 'Metamizol',
  url: 'https://de.wikipedia.example/Metamizol',
  source: 'wiki',
  language: 'de',
  passages: [{ heading: 'Gegenanzeigen', text: 'Metamizol darf bei bekannter Überempfindlichkeit gegen Pyrazolone nicht angewendet werden.' }],
};

function source(id: string, languages: string[], docs: SourceDocument[] | Error, seen?: ResearchQuery[]): ResearchSource {
  return {
    id,
    label: id === 'labels' ? 'Arzneimittel-Labels' : id === 'wiki' ? 'Wikipedia' : id,
    locality: 'remote',
    kind: 'drug-label',
    languages,
    search: async (q) => {
      seen?.push(q);
      if (docs instanceof Error) throw docs;
      return docs;
    },
  };
}

function fakeLlm(output: string | ((request: LlmRequest) => string)): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    id: 'fake',
    label: 'Testmodell',
    locality: 'local',
    requests,
    complete: async (request) => {
      requests.push(request);
      const text = typeof output === 'string' ? output : output(request);
      for (const piece of text.match(/[\s\S]{1,9}/g) ?? []) request.onToken?.(piece);
      return { text };
    },
  };
}

/** Finds the number a passage got in the prompt by a snippet of its text. */
const numberOf = (prompt: string, snippet: string) => {
  const m = [...prompt.matchAll(/<passage nr="(\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g)].find((x) => x[2]!.includes(snippet));
  if (!m) throw new Error(`passage not in prompt: ${snippet}`);
  return Number(m[1]);
};

describe('createGroundedResearch', () => {
  it('answers from passages with verified quotes and dense citations', async () => {
    const seen: ResearchQuery[] = [];
    const llm = fakeLlm((request) => {
      const prompt = request.messages[0]!.content;
      const a = numberOf(prompt, 'agranulocytosis');
      const p = numberOf(prompt, 'Pyrazolone');
      return `ANTWORT:\nMetamizol ist kontraindiziert bei:\n- Agranulozytose in der Anamnese [${a}]\n- letztem Schwangerschaftsdrittel [${a}]\n- Überempfindlichkeit gegen Pyrazolone [${p}]\n\nBELEGE:\n[${a}] "contraindicated in patients with a history of agranulocytosis"\n[${p}] "Überempfindlichkeit gegen Pyrazolone"`;
    });
    const progress: ResearchProgress[] = [];
    const provider = createGroundedResearch({
      llm,
      sources: [source('labels', ['en'], [label], seen), source('wiki', ['de'], [wiki], seen)],
      resolve: async (term) => ({ term, language: 'de', english: 'metamizole', aliases: ['Novaminsulfon', 'dipyrone'], codes: [{ system: 'ATC', code: 'N02BB02' }] }),
    });
    const answer = await provider.research({ question: 'Kontraindikationen für Metamizol' }, { onProgress: (p) => progress.push(p) });

    expect(answer.grounded).toBe(true);
    expect(answer.answer).toBe(
      'Metamizol ist kontraindiziert bei:\n- Agranulozytose in der Anamnese [1]\n- letztem Schwangerschaftsdrittel [1]\n- Überempfindlichkeit gegen Pyrazolone [2]',
    );
    expect(answer.citations).toEqual([
      {
        index: 1,
        title: 'Metamizole 500 mg tablets – Contraindications',
        url: 'https://labels.example/metamizole',
        source: 'Example Medicines Agency',
        quote: 'contraindicated in patients with a history of agranulocytosis',
        date: '2024-03-01',
      },
      { index: 2, title: 'Metamizol – Gegenanzeigen', url: 'https://de.wikipedia.example/Metamizol', source: 'Wikipedia', quote: 'Überempfindlichkeit gegen Pyrazolone' },
    ]);
    expect(answer.sourcesSearched).toEqual(['Arzneimittel-Labels', 'Wikipedia']);
    expect(answer.warnings).toBeUndefined();
    expect(answer.provider).toBe('grounded');

    // sources get the question as asked; they translate terms themselves
    expect(seen).toEqual([
      { question: 'Kontraindikationen für Metamizol', language: 'de' },
      { question: 'Kontraindikationen für Metamizol', language: 'de' },
    ]);

    // prompt: passages before the question, German instructions, aliases given
    const request = llm.requests[0]!;
    expect(llm.requests).toHaveLength(1);
    const prompt = request.messages[0]!.content;
    expect(prompt.indexOf('<passagen>')).toBeLessThan(prompt.indexOf('Frage: Kontraindikationen für Metamizol'));
    expect(prompt).toContain('engl. metamizole');
    expect(request.system).toContain('Antworte auf Deutsch');

    // streamed text is the answer section only
    const streamed = progress.map((p) => p.delta ?? '').join('');
    expect(streamed).toContain('Agranulozytose in der Anamnese');
    expect(streamed).not.toMatch(/ANTWORT|BELEGE|contraindicated in patients/);
    expect(progress.map((p) => p.stage).filter((s, i, all) => all.indexOf(s) === i)).toEqual(['resolving', 'searching', 'reading', 'answering']);
    expect(progress.some((p) => p.detail === 'Arzneimittel-Labels: 1 Dokument')).toBe(true);
  });

  it('does not call the model when nothing was retrieved', async () => {
    const llm = fakeLlm('should never be used');
    const provider = createGroundedResearch({ llm, sources: [source('labels', ['en'], []), source('wiki', ['de'], [])] });
    const answer = await provider.research({ question: 'Kontraindikationen für Metamizol' });
    expect(llm.requests).toHaveLength(0);
    expect(answer.grounded).toBe(false);
    expect(answer.citations).toEqual([]);
    expect(answer.answer).toContain('Arzneimittel-Labels, Wikipedia');
    expect(answer.answer).toContain('keine Antwort aus dem Modellwissen');
  });

  it('tolerates a failing source and records it', async () => {
    const llm = fakeLlm('ANTWORT:\nNicht bei Pyrazolon-Überempfindlichkeit [1].\n\nBELEGE:\n[1] "bekannter Überempfindlichkeit gegen Pyrazolone"');
    const provider = createGroundedResearch({ llm, sources: [source('labels', ['en'], new Error('HTTP 500')), source('wiki', ['de'], [wiki])] });
    const answer = await provider.research({ question: 'Kontraindikationen für Metamizol' });
    expect(answer.grounded).toBe(true);
    expect(answer.sourcesSearched).toEqual(['Arzneimittel-Labels', 'Wikipedia']);
    expect(answer.warnings).toEqual(['Arzneimittel-Labels: Suche fehlgeschlagen (HTTP 500).']);
  });

  it('drops unverifiable quotes, invalid markers and uncited claims, and says so', async () => {
    const llm = fakeLlm(
      'ANTWORT:\n- Nicht bei Pyrazolon-Überempfindlichkeit [1]\n- Nicht bei Kindern unter 3 Monaten [9]\n- Metamizol ist in Schweden nicht zugelassen.\n\nBELEGE:\n[1] "Metamizol ist bei Pyrazolon-Allergie verboten"',
    );
    const provider = createGroundedResearch({ llm, sources: [source('wiki', ['de'], [wiki])] });
    const answer = await provider.research({ question: 'Kontraindikationen für Metamizol' });
    expect(answer.answer).toBe('- Nicht bei Pyrazolon-Überempfindlichkeit [1]');
    expect(answer.grounded).toBe(true);
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]).not.toHaveProperty('quote');
    expect(answer.warnings).toEqual([
      'Verweise auf nicht vorhandene Passagen wurden entfernt: [9].',
      '2 Aussagen ohne Quellenbeleg wurden entfernt.',
      'Quelle [1]: Das vom Modell angegebene Zitat steht nicht wörtlich in der Passage und wurde verworfen.',
    ]);
  });

  it('degrades to citations without quotes when a small model ignores the format', async () => {
    const llm = fakeLlm('Metamizol darf bei Überempfindlichkeit gegen Pyrazolone nicht gegeben werden [Passage 1].');
    const provider = createGroundedResearch({ llm, sources: [source('wiki', ['de'], [wiki])] });
    const answer = await provider.research({ question: 'Kontraindikationen für Metamizol' });
    expect(answer.grounded).toBe(true);
    expect(answer.answer).toBe('Metamizol darf bei Überempfindlichkeit gegen Pyrazolone nicht gegeben werden [1].');
    expect(answer.warnings?.[0]).toMatch(/Kein wörtlicher Beleg/);
  });

  it('is ungrounded when the model answers without any citation or says the passages do not help', async () => {
    const sources = [source('wiki', ['de'], [wiki])];
    const guessed = await createGroundedResearch({ llm: fakeLlm('ANTWORT:\nMetamizol ist bei Asthma kontraindiziert.'), sources }).research({ question: 'Kontraindikationen für Metamizol' });
    expect(guessed.grounded).toBe(false);
    expect(guessed.answer).not.toContain('Asthma');
    expect(guessed.answer).toContain('keine belegbare Antwort');

    const honest = await createGroundedResearch({ llm: fakeLlm('ANTWORT:\nDie Quellen enthalten keine Angaben zur Dosierung.\n\nBELEGE:'), sources }).research({ question: 'Dosierung Metamizol' });
    expect(honest.grounded).toBe(false);
    expect(honest.answer).toContain('Die Quellen enthalten keine Angaben zur Dosierung.');
    expect(honest.citations).toEqual([]);
  });

  it('passes the concept on, survives a failing resolver and propagates aborts', async () => {
    const seen: ResearchQuery[] = [];
    const resolve = vi.fn(async () => {
      throw new Error('offline');
    });
    const llm = fakeLlm('ANTWORT:\nA [1].');
    const provider = createGroundedResearch({ llm, sources: [source('labels', ['en'], [label], seen)], resolve });
    await provider.research({
      question: 'Was sind die Kontraindikationen?',
      concept: { conceptId: 'wikidata:Q384809', label: 'Metamizol', type: 'medication', codes: [{ system: 'ATC', code: 'N02BB02' }] },
    });
    expect(resolve).toHaveBeenCalledWith('Metamizol', expect.objectContaining({ language: 'de', codes: [{ system: 'ATC', code: 'N02BB02' }] }));
    expect(seen[0]).toMatchObject({ question: 'Was sind die Kontraindikationen?', concept: { conceptId: 'wikidata:Q384809', label: 'Metamizol', type: 'medication' } });

    const abort = new AbortController();
    abort.abort();
    await expect(provider.research({ question: 'Kontraindikationen für Metamizol' }, { signal: abort.signal })).rejects.toThrow();
  });

  it('is local only when model and all sources are local', () => {
    const local = { ...source('pack', ['de'], []), locality: 'local' as const };
    expect(createGroundedResearch({ llm: fakeLlm(''), sources: [local] }).locality).toBe('local');
    expect(createGroundedResearch({ llm: fakeLlm(''), sources: [local, source('wiki', ['de'], [])] }).locality).toBe('remote');
    expect(RESEARCH_DISCLAIMER_DE).toMatch(/Fachinformation/);
  });
});

describe('createGroundedResearch with a complex question', () => {
  it('hands the entity extracted by the model to the sources', async () => {
    const seen: ResearchQuery[] = [];
    const llm = fakeLlm((request) =>
      request.system?.includes('JSON') ? '{"begriffe": ["Metamizol"], "aspekt": "Kontraindikationen"}' : 'ANTWORT:\nNicht bei Pyrazolon-Überempfindlichkeit [1].',
    );
    const provider = createGroundedResearch({ llm, sources: [source('wiki', ['de'], [wiki], seen)] });
    const question = 'Darf ich einem Patienten mit bekannter Allergie gegen Pyrazolone trotzdem Metamizol verabreichen oder nicht';
    const answer = await provider.research({ question });
    expect(llm.requests).toHaveLength(2);
    expect(seen[0]).toEqual({ question, language: 'de', concept: { conceptId: 'term:Metamizol', label: 'Metamizol', type: 'other' } });
    expect(answer.grounded).toBe(true);
  });
});
