// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createAnswerStreamFilter, findVerbatim, normalizeMarkers, parseModelOutput, validateAnswer } from './citations.ts';

describe('normalizeMarkers', () => {
  it('unifies the citation styles models produce', () => {
    expect(normalizeMarkers('a [1, 2] b [3-5] c [Passage 2] d 【4】 e [^1] f [Quelle 1 und 3]')).toBe(
      'a [1][2] b [3][4][5] c [2] d [4] e [1] f [1][3]',
    );
  });
  it('leaves markdown links and non-citations alone', () => {
    expect(normalizeMarkers('[1](https://x.test) und [siehe oben] und [2024-2025]')).toBe(
      '[1](https://x.test) und [siehe oben] und [2024-2025]',
    );
  });
});

describe('parseModelOutput', () => {
  it('parses the two-section format', () => {
    const out = parseModelOutput(
      'ANTWORT:\n- Agranulozytose in der Anamnese [1]\n- Letztes Trimenon [2]\n\nBELEGE:\n[1] "history of agranulocytosis"\n[2] „third trimester of pregnancy“\n',
    );
    expect(out.answer).toBe('- Agranulozytose in der Anamnese [1]\n- Letztes Trimenon [2]');
    expect(out.quotes.get(1)).toEqual(['history of agranulocytosis']);
    expect(out.quotes.get(2)).toEqual(['third trimester of pregnancy']);
  });
  it('tolerates decorated headers, bullets, missing brackets and reasoning tags', () => {
    const out = parseModelOutput('<think>hm</think>\n**Antwort:** Text [1].\n\n## Belege\n- 1: "abc def ghi"\n* [2]. \'second quote here\'');
    expect(out.answer).toBe('Text [1].');
    expect(out.quotes.get(1)).toEqual(['abc def ghi']);
    expect(out.quotes.get(2)).toEqual(['second quote here']);
  });
  it('degrades to an answer without quotes when the section is missing', () => {
    const out = parseModelOutput('Metamizol ist kontraindiziert bei X [1].');
    expect(out.answer).toBe('Metamizol ist kontraindiziert bei X [1].');
    expect(out.quotes.size).toBe(0);
  });
  it('accepts a JSON answer', () => {
    const out = parseModelOutput('```json\n{"antwort": "A [1].", "belege": [{"n": 1, "zitat": "some verbatim text"}]}\n```');
    expect(out.answer).toBe('A [1].');
    expect(out.quotes.get(1)).toEqual(['some verbatim text']);
  });
});

describe('validateAnswer', () => {
  it('keeps cited statements, lead-ins and headings and renumbers densely', () => {
    const v = validateAnswer('## Kontraindikationen\nMetamizol darf nicht angewendet werden bei:\n- Allergie gegen Pyrazolone [3]\n- Knochenmarkstörung [1][3]', 4);
    expect(v.text).toBe('## Kontraindikationen\nMetamizol darf nicht angewendet werden bei:\n- Allergie gegen Pyrazolone [1]\n- Knochenmarkstörung [2][1]');
    expect(v.used).toEqual([3, 1]);
    expect(v.removed).toBe(0);
  });

  it('removes uncited statements and orphaned structure', () => {
    const v = validateAnswer(
      'Kontraindiziert bei Agranulozytose [1]. Außerdem ist es in den USA nicht zugelassen.\n\n## Dosierung\nÜblich sind 500 mg.\n\n- Ohne Beleg',
      2,
    );
    expect(v.text).toBe('Kontraindiziert bei Agranulozytose [1].');
    expect(v.removed).toBe(3);
  });

  it('lets a citation cover the uncited sentence before it, but not after it', () => {
    const v = validateAnswer('Erster Satz. Zweiter Satz [1]. Dritter Satz.', 1);
    expect(v.text).toBe('Erster Satz. Zweiter Satz [1].');
    expect(v.removed).toBe(1);
  });

  it('drops invalid markers and the statements that depended on them', () => {
    const v = validateAnswer('- A [1]\n- B [7]\n- C [2][9]', 2);
    expect(v.text).toBe('- A [1]\n- C [2]');
    expect(v.invalid).toEqual([7, 9]);
    expect(v.removed).toBe(1);
  });

  it('keeps explicit statements that the sources lack the information', () => {
    const v = validateAnswer('Kontraindiziert bei X [1].\n\nZur Dosierung enthalten die Quellen keine Angaben.', 1);
    expect(v.text).toContain('Zur Dosierung enthalten die Quellen keine Angaben.');
    expect(v.removed).toBe(0);
  });

  it('does not split at abbreviations, ordinals or citations after the period', () => {
    const v = validateAnswer('Nicht im 3. Trimenon anwenden, z. B. wegen Ductusverschluss. [1] Kein Beleg hier.', 1);
    expect(v.text).toBe('Nicht im 3. Trimenon anwenden, z. B. wegen Ductusverschluss. [1]');
    expect(v.removed).toBe(1);
  });

  it('reports an answer without any citation as unsupported', () => {
    const v = validateAnswer('Metamizol ist ein Analgetikum. Es wirkt gut.', 3);
    expect(v.used).toEqual([]);
    expect(v.text).toBe('');
    expect(v.removed).toBe(2);
  });
});

describe('findVerbatim', () => {
  const passage = 'Metamizole is contra­indicated in patients with a history of\n  agranulocytosis – including “drug-induced” forms – and in the third trimester.';
  it('finds quotes regardless of case, whitespace, quote style and soft hyphens', () => {
    expect(findVerbatim(passage, 'contraindicated in patients with a HISTORY of agranulocytosis - including "drug-induced" forms')).toBe(
      'contra­indicated in patients with a history of agranulocytosis – including “drug-induced” forms',
    );
  });
  it('accepts the longest part of a quote shortened with an ellipsis', () => {
    expect(findVerbatim(passage, 'Metamizole is contraindicated […] in the third trimester.')).toBe('Metamizole is contra­indicated');
  });
  it('returns the longest verbatim part when the model stitched or reformatted the passage', () => {
    const list = 'Novalgin darf nicht angewendet werden bei\n- Agranulozytose in der Anamnese, die durch Metamizol ausgelöst wurde;\n- hepatischer Porphyrie;\n- Säuglingen unter 3 Monaten.';
    expect(findVerbatim(list, 'Novalgin darf nicht angewendet werden bei Agranulozytose in der Anamnese, die durch Metamizol ausgelöst wurde; hepatischer Porphyrie')).toBe(
      'Agranulozytose in der Anamnese, die durch Metamizol ausgelöst wurde',
    );
    // a short coincidental overlap is not evidence
    expect(findVerbatim(list, 'Metamizol sollte nicht angewendet werden bei Kindern mit Fieber unklarer Ursache')).toBeNull();
  });
  it('rejects paraphrases, translations and trivially short quotes', () => {
    expect(findVerbatim(passage, 'Metamizol ist bei Agranulozytose in der Anamnese kontraindiziert')).toBeNull();
    expect(findVerbatim(passage, 'should never be given to patients with agranulocytosis')).toBeNull();
    expect(findVerbatim(passage, 'history')).toBeNull();
  });
});

describe('createAnswerStreamFilter', () => {
  const run = (deltas: string[]) => {
    let out = '';
    const filter = createAnswerStreamFilter((d) => (out += d));
    for (const d of deltas) filter.push(d);
    filter.end();
    return out;
  };
  const full = 'ANTWORT:\n- Punkt eins [1]\n- Punkt zwei [2]\n\nBELEGE:\n[1] "quote one"\n[2] "quote two"';

  it('emits only the answer section', () => {
    expect(run([full])).toBe('- Punkt eins [1]\n- Punkt zwei [2]');
  });
  it('gives the same result for any chunking', () => {
    for (const size of [1, 2, 3, 5, 7, 11]) {
      const deltas = full.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'))!;
      expect(run(deltas)).toBe('- Punkt eins [1]\n- Punkt zwei [2]');
    }
  });
  it('passes plain output through and does not swallow words that merely start like a header', () => {
    expect(run(['Belege ', 'finden sich in [1].\nAnt', 'worten folgen.'])).toBe('Belege finden sich in [1].\nAntworten folgen.');
  });
  it('handles a missing answer header and a decorated quotes header', () => {
    expect(run(['Text [1].\n\n', '**Bele', 'ge:**\n[1] "x"'])).toBe('Text [1].');
  });
});
