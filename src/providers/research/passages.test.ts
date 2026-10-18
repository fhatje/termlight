// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SourceDocument } from '../../core/types.ts';
import { chunkText, rankPassages } from './passages.ts';
import { detectAspect } from './question.ts';

const doc = (id: string, title: string, passages: SourceDocument['passages']): SourceDocument => ({
  id,
  title,
  url: `https://example.org/${id}`,
  source: 'fake',
  passages,
});

describe('chunkText', () => {
  it('keeps short text and splits long text at sentence boundaries within the limit', () => {
    expect(chunkText('Kurz.')).toEqual(['Kurz.']);
    const long = Array.from({ length: 60 }, (_, i) => `Satz Nummer ${i} mit etwas Inhalt.`).join(' ');
    const chunks = chunkText(long, 300);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
    expect(chunks.every((c) => c.endsWith('.'))).toBe(true);
    expect(chunks.join(' ')).toBe(long);
  });
});

describe('rankPassages', () => {
  const docs = [
    {
      sourceLabel: 'Label',
      doc: doc('metamizole', 'Metamizole', [
        { heading: 'Pharmacokinetics', text: 'Metamizole is hydrolysed to 4-MAA.' },
        { heading: 'Contraindications', text: 'Hypersensitivity to pyrazolones; history of agranulocytosis.' },
        { heading: 'Storage', text: 'Store below 25 °C.' },
      ]),
    },
    { sourceLabel: 'Other', doc: doc('ibuprofen', 'Ibuprofen', [{ heading: 'Contraindications', text: 'Active gastrointestinal bleeding.' }]) },
  ];

  it('puts the passage matching entity and aspect first and numbers from 1', () => {
    const ranked = rankPassages({
      docs,
      question: 'Kontraindikationen für Metamizol',
      entityNames: ['Metamizol', 'metamizole'],
      aspect: detectAspect('Kontraindikationen'),
      maxPassages: 3,
    });
    const best = [...ranked].sort((a, b) => b.score - a.score)[0]!;
    expect(best.heading).toBe('Contraindications');
    expect(best.doc.id).toBe('metamizole');
    expect(ranked.map((p) => p.n)).toEqual([1, 2, 3]);
    // passages of one document stay together, in reading order
    expect(ranked.filter((p) => p.doc.id === 'metamizole').map((p) => p.heading)).toEqual(['Pharmacokinetics', 'Contraindications']);
  });

  it('respects the passage and per-document limits', () => {
    const many = [{ sourceLabel: 'L', doc: doc('d', 'Metamizol', Array.from({ length: 20 }, (_, i) => ({ text: `Metamizol Passage ${i}` }))) }];
    const ranked = rankPassages({ docs: many, question: 'Metamizol', entityNames: ['Metamizol'], maxPassages: 8 });
    expect(ranked).toHaveLength(4);
  });
});
