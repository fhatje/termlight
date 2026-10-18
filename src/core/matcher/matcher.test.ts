import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Annotation, TermPack } from '../types.ts';
import type { MatcherPack } from './index.ts';
import { createMatcher, resolveOverlaps } from './index.ts';

const seed = JSON.parse(readFileSync(resolve(process.cwd(), 'public/packs/seed.de.json'), 'utf8')) as TermPack;

function pack(concepts: MatcherPack['concepts'], extra: Partial<MatcherPack> = {}): MatcherPack {
  return { id: 't', name: 'Test', version: '1', language: 'de', license: 'CC0-1.0', attribution: 'test', concepts, ...extra };
}

const basic = pack([
  { id: 'pneu', label: 'Pneumonie', type: 'disease', terms: ['Lungenentzündung'] },
  { id: 'erguss', label: 'Pleuraerguss', type: 'finding', terms: ['Pleura-Erguss-Bildung'] },
  { id: 'fx', label: 'Fraktur', type: 'finding' },
  { id: 'ol', label: 'Oberlappen', type: 'anatomy', terms: ['rechter Oberlappen'] },
  { id: 'vkb', label: 'vorderes Kreuzband', type: 'anatomy', exact: ['VKB'] },
  { id: 'oedem', label: 'Ödem', type: 'finding' },
  { id: 'fuss', label: 'Fuß', type: 'anatomy' },
  { id: 'ct', label: 'Computertomographie', type: 'procedure', terms: ['CT', 'CT-Angiographie'] },
  { id: 'km', label: 'Kontrastmittel', type: 'substance', exact: ['KM'] },
  { id: 'akut', label: 'akut', type: 'modifier' },
  { id: 'aorta', label: 'Aorta', type: 'anatomy' },
  { id: 'bronchitis', label: 'akute Bronchitis', type: 'disease' },
  { id: 'wand', label: 'Wand', type: 'anatomy' },
  { id: 'leiden', label: 'Leiden', type: 'disease' },
  { id: 'unterlappen', label: 'Unterlappen', type: 'anatomy' },
  { id: 'arm', label: 'Arm', type: 'anatomy' },
  { id: 'was', label: 'Was', type: 'medication', terms: ['WAS'] },
  { id: 'carotis', label: 'Arteria carotis', type: 'anatomy', terms: ['A. carotis'] },
]);
const matcher = createMatcher([basic], { contextRules: false });

function hits(text: string, m = matcher): string[] {
  return m.match(text).map((a) => `${a.text}=${a.conceptId.split(':')[1]}`);
}

describe('matcher basics', () => {
  it('returns offsets into the original text', () => {
    const text = 'Befund: Pneumonie im Oberlappen.';
    const result = matcher.match(text);
    expect(result.map((a) => a.text)).toEqual(['Pneumonie', 'Oberlappen']);
    for (const a of result) expect(text.slice(a.from, a.to)).toBe(a.text);
    expect(result[0]).toMatchObject({ conceptId: 't:pneu', label: 'Pneumonie', type: 'disease', source: 'dictionary' });
  });

  it('is case-insensitive for long terms and handles ß/umlaut spellings', () => {
    expect(hits('PNEUMONIE, pneumonie, Lungenentzuendung')).toEqual(['PNEUMONIE=pneu', 'pneumonie=pneu', 'Lungenentzuendung=pneu']);
    expect(hits('Oedem am Fuss und am Fuß')).toEqual(['Oedem=oedem', 'Fuss=fuss', 'Fuß=fuss']);
  });

  it('keeps offsets right for decomposed (NFD) input', () => {
    const text = 'Kein Ödem, aber Lungenentzündung.';
    const result = matcher.match(text);
    expect(result.map((a) => a.conceptId)).toEqual(['t:oedem', 't:pneu']);
    for (const a of result) expect(text.slice(a.from, a.to)).toBe(a.text);
  });

  it('matches hyphen and joined variants both ways', () => {
    expect(hits('Pleura-Erguss rechts')).toEqual(['Pleura-Erguss=erguss']);
    expect(hits('Pleuraergussbildung')).toEqual(['Pleuraergussbildung=erguss']);
    expect(hits('CT Angiographie und CT-Angiographie')).toEqual(['CT Angiographie=ct', 'CT-Angiographie=ct']);
  });

  it('does not match inside words', () => {
    expect(hits('Pneumonieartig, Frakturlos')).toEqual([]);
  });

  it('matches German inflection of nouns', () => {
    expect(hits('des Pleuraergusses, mehrere Pneumonien, zwei Frakturen, des Oberlappens')).toEqual([
      'Pleuraergusses=erguss',
      'Pneumonien=pneu',
      'Frakturen=fx',
      'Oberlappens=ol',
    ]);
    expect(hits('Pleuraergüsse beidseits, Ödeme, der Aorten')).toEqual(['Pleuraergüsse=erguss', 'Ödeme=oedem', 'Aorten=aorta']);
  });

  it('matches inflected adjectives in multi-word terms', () => {
    expect(hits('Ruptur des vorderen Kreuzbandes')).toEqual(['vorderen Kreuzbandes=vkb']);
    expect(hits('im rechten Oberlappen, des rechten Oberlappens')).toEqual(['rechten Oberlappen=ol', 'rechten Oberlappens=ol']);
    expect(hits('bei akuter Bronchitis; akutes Geschehen')).toEqual(['akuter Bronchitis=bronchitis', 'akutes=akut']);
  });

  it('prefers the longest match', () => {
    expect(hits('rechter Oberlappen')).toEqual(['rechter Oberlappen=ol']);
    expect(hits('akute Bronchitis')).toEqual(['akute Bronchitis=bronchitis']);
  });

  it('glues abbreviation dots but not sentence ends', () => {
    expect(hits('Stenose der A. carotis links')).toEqual(['A. carotis=carotis']);
    expect(hits('Arteria. Carotis')).toEqual([]);
  });

  it('splits compounds only when both halves are dictionary nouns', () => {
    expect(hits('Unterlappenpneumonie')).toEqual(['Unterlappen=unterlappen', 'pneumonie=pneu']);
    expect(hits('Oberlappenfrakturen')).toEqual(['Oberlappen=ol', 'frakturen=fx']);
    expect(hits('Unterlappenspezialist, Zeitungsfraktur')).toEqual([]);
  });
});

describe('noise guards', () => {
  it('matches abbreviations only in exact case', () => {
    expect(hits('CT mit KM, VKB intakt')).toEqual(['CT=ct', 'KM=km', 'VKB=vkb']);
    expect(hits('ct mit km, Km 5, vkb')).toEqual([]);
  });

  it('drops stop words unless the pack lists an all-caps form', () => {
    expect(hits('Was ist das? Das WAS-Protein')).toEqual(['WAS=was']);
  });

  it('matches three-letter words only in their dictionary case', () => {
    expect(hits('Der Arm ist arm dran.')).toEqual(['Arm=arm']);
  });

  it('requires capitalisation for short German nouns', () => {
    expect(hits('Sie wand sich. Viele leiden. Die Wand, das Leiden.')).toEqual(['Wand=wand', 'Leiden=leiden']);
    expect(hits('Wir wandern und wanden uns.')).toEqual([]);
  });

  it('skips numbers and one-letter terms', () => {
    const m = createMatcher([pack([{ id: 'x', label: 'X', type: 'other', terms: ['12', 'a', 'Ab'] }])]);
    expect(m.stats.terms).toBe(0);
    expect(m.stats.skippedTerms).toBe(4);
  });
});

describe('priorities and overlaps', () => {
  const a = pack([{ id: 'a', label: 'Embolie', type: 'finding' }], { id: 'a' });
  const b = pack([{ id: 'b', label: 'Lungenembolie', type: 'disease', terms: ['Embolie'] }], { id: 'b' });

  it('prefers earlier packs, labels before synonyms, explicit priority first', () => {
    expect(createMatcher([a, b]).match('Embolie')[0]?.conceptId).toBe('a:a');
    expect(createMatcher([b, a]).match('Embolie')[0]?.conceptId).toBe('b:b');
    expect(createMatcher([b, { ...a, priority: 5 }]).match('Embolie')[0]?.conceptId).toBe('a:a');
  });

  it('resolveOverlaps keeps the longer span, then the earlier list', () => {
    const mk = (from: number, to: number, id: string): Annotation => ({ from, to, text: 'x'.repeat(to - from), conceptId: id, label: id, type: 'other', source: 's' });
    const merged = resolveOverlaps([
      [mk(0, 5, 'a'), mk(10, 14, 'b')],
      [mk(3, 12, 'c'), mk(20, 24, 'd'), mk(10, 14, 'e')],
    ]);
    expect(merged.map((x) => x.conceptId)).toEqual(['c', 'd']);
    expect(resolveOverlaps([[mk(10, 14, 'b')], [mk(10, 14, 'e')]]).map((x) => x.conceptId)).toEqual(['b']);
  });
});

describe('seed pack', () => {
  const m = createMatcher([seed]);
  const find = (text: string, id: string): Annotation => {
    const a = m.match(text).find((x) => x.conceptId === `seed-de:${id}`);
    if (!a) throw new Error(`${id} not found in "${text}": ${JSON.stringify(m.match(text).map((x) => x.conceptId))}`);
    return a;
  };

  it('loads without losing concepts to the guards', () => {
    expect(m.stats.concepts).toBeGreaterThan(600);
    expect(m.stats.skippedTerms).toBe(0);
  });

  it('finds drugs, procedures, lab values', () => {
    const text = 'Unter Metamizol und ASS 100 sowie Marcumar; CT und MRT geplant, CRP und Kreatinin erhöht, Befund regredient.';
    const ids = m.match(text).map((a) => a.conceptId.replace('seed-de:', ''));
    expect(ids).toEqual([
      'medication-metamizol',
      'medication-acetylsalicylsaeure',
      'medication-phenprocoumon',
      'procedure-computertomographie',
      'procedure-magnetresonanztomographie',
      'lab-crp',
      'lab-kreatinin',
      'modifier-regredient',
    ]);
    expect(m.match(text)[0]?.codes).toEqual([{ system: 'ATC', code: 'N02BB02' }]);
  });

  it('detects negation, scoped to the clause', () => {
    expect(find('Kein Hinweis auf Pneumonie.', 'disease-pneumonie').assertion).toBe('negated');
    expect(find('Kein Pleuraerguss. Im Oberlappen zeigt sich eine Pneumonie.', 'disease-pneumonie').assertion).toBe('present');
    const text = 'Kein Pleuraerguss links, Pneumonie rechts.';
    expect(find(text, 'finding-pleuraerguss')).toMatchObject({ assertion: 'negated', laterality: 'left' });
    expect(find(text, 'disease-pneumonie')).toMatchObject({ assertion: 'present', laterality: 'right' });
    expect(find('Keine Sepsis oder Pneumonie.', 'disease-pneumonie').assertion).toBe('negated');
    expect(find('Eine Pneumonie ohne Pleuraerguss.', 'disease-pneumonie').assertion).toBe('present');
    expect(find('Eine Pneumonie ohne Pleuraerguss.', 'finding-pleuraerguss').assertion).toBe('negated');
    expect(find('Kein Erguss, jedoch Pneumonie.', 'disease-pneumonie').assertion).toBe('present');
    expect(find('Kein Erguss bei bekannter Pneumonie.', 'disease-pneumonie').assertion).toBe('present');
    expect(find('Ein Pneumothorax ist nicht nachweisbar.', 'finding-pneumothorax').assertion).toBe('negated');
    expect(find('Eine Fraktur zeigt sich nicht.', 'finding-fraktur').assertion).toBe('negated');
    expect(find('Die nicht dislozierte Fraktur ist bekannt.', 'finding-fraktur').assertion).toBe('present');
    expect(find('Ausschluss von Frakturen.', 'finding-fraktur').assertion).toBe('negated');
    expect(find('Kein sicherer Hinweis auf eine Rechtsherzbelastung.', 'finding-rechtsherzbelastung').assertion).toBe('negated');
  });

  it('detects uncertainty', () => {
    expect(find('Verdacht auf Pneumonie.', 'disease-pneumonie').assertion).toBe('uncertain');
    expect(find('V.a. Pneumonie rechts.', 'disease-pneumonie').assertion).toBe('uncertain');
    expect(find('V. a. Pneumonie rechts.', 'disease-pneumonie').assertion).toBe('uncertain');
    expect(find('Ausschluss Pneumonie.', 'disease-pneumonie').assertion).toBe('uncertain');
    expect(find('DD Pneumonie, DD Atelektase.', 'finding-atelektase').assertion).toBe('uncertain');
    expect(find('Eine beginnende Pneumonie ist nicht auszuschließen.', 'disease-pneumonie').assertion).toBe('uncertain');
    expect(find('Fragliche Fraktur.', 'finding-fraktur').assertion).toBe('uncertain');
    expect(find('Pneumonie möglich.', 'disease-pneumonie').assertion).toBe('uncertain');
    expect(find('Pneumonie?', 'disease-pneumonie').assertion).toBe('uncertain');
    expect(find('Kein Verdacht auf Pneumonie.', 'disease-pneumonie').assertion).toBe('negated');
  });

  it('sets assertion only where it makes sense', () => {
    const result = m.match('Kein Metamizol, keine CT, Leber unauffällig.');
    expect(result.length).toBe(4);
    for (const a of result) expect(a.assertion).toBeUndefined();
  });

  it('detects laterality', () => {
    const text = 'Pleuraerguss links. Rechtsseitige Pneumonie. Kein Pneumothorax beidseits. Im linken Oberlappen Infiltrat.';
    expect(find(text, 'finding-pleuraerguss').laterality).toBe('left');
    expect(find(text, 'disease-pneumonie').laterality).toBe('right');
    expect(find(text, 'finding-pneumothorax').laterality).toBe('bilateral');
    expect(find(text, 'anatomy-oberlappen').laterality).toBe('left');
    expect(find('Pneumonie.', 'disease-pneumonie').laterality).toBeUndefined();
    expect(find('Metamizol links', 'medication-metamizol').laterality).toBeUndefined();
  });

  it('handles basic English context', () => {
    const en = createMatcher([pack([{ id: 'pn', label: 'pneumonia', type: 'disease' }, { id: 'fx', label: 'fracture', type: 'finding' }], { language: 'en' })]);
    const r = en.match('No evidence of pneumonia. Suspected fractures of the left ribs. Pneumonia cannot be excluded.');
    expect(r.map((a) => [a.text, a.assertion, a.laterality])).toEqual([
      ['pneumonia', 'negated', undefined],
      ['fractures', 'uncertain', 'left'],
      ['Pneumonia', 'uncertain', undefined],
    ]);
  });
});

describe('differential diagnosis lists', () => {
  const pack: TermPack = {
    id: 't',
    name: 't',
    version: '1',
    language: 'de',
    license: 'CC0',
    attribution: '',
    concepts: [
      { id: 'pneumonie', label: 'Pneumonie', type: 'disease' },
      { id: 'nsip', label: 'NSIP', type: 'disease' },
      { id: 'op', label: 'organisierende Pneumonie', type: 'disease' },
      { id: 'erguss', label: 'Pleuraerguss', type: 'finding' },
    ],
  };
  const byText = (text: string) => Object.fromEntries(createMatcher([pack], { language: 'de' }).match(text).map((a) => [a.text, a.assertion]));

  it('marks every item after "DD" as uncertain, up to the end of the sentence', () => {
    const hits = byText('DD Pneumonie, NSIP, organisierende Pneumonie. Pleuraerguss rechts.');
    expect(hits).toEqual({ Pneumonie: 'uncertain', NSIP: 'uncertain', 'organisierende Pneumonie': 'uncertain', Pleuraerguss: 'present' });
  });

  it('keeps ordinary triggers inside their clause', () => {
    const hits = byText('Kein Pleuraerguss, Pneumonie rechts basal.');
    expect(hits).toEqual({ Pleuraerguss: 'negated', Pneumonie: 'present' });
  });

  it('lets an item with its own trigger keep it', () => {
    const hits = byText('DD NSIP, kein Pleuraerguss.');
    expect(hits).toEqual({ NSIP: 'uncertain', Pleuraerguss: 'negated' });
  });
});
