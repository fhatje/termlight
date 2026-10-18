import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TermPack } from '../src/core/types.ts';
import { createDictionaryRecognizer } from '../src/providers/recognizers/index.ts';
import { RADIOLOGY_LANGUAGES, buildRadiologyPack, buildSeedPack, parseMultilingual } from './build-seed.ts';

// vitest runs from the repo root; import.meta.url is not a file URL under happy-dom.
const read = (name: string) => readFileSync(`tools/seed/${name}`, 'utf8');
const source = read('radiology.txt');
const seed = buildSeedPack(read('seed.de.txt'));

function recognizer(language: 'de' | 'en' | 'fr', extra: TermPack[] = []) {
  const packs = [...(language === 'de' ? [seed] : []), buildRadiologyPack(source, language), ...extra];
  return createDictionaryRecognizer({ packs, language, useWorker: false });
}

/** surface text → "conceptId|assertion" */
async function found(r: ReturnType<typeof recognizer>, text: string): Promise<Record<string, string>> {
  const annotations = await r.recognize(text);
  return Object.fromEntries(annotations.map((a) => [a.text, `${a.conceptId}|${a.assertion ?? '-'}`]));
}

describe('radiology pack source', () => {
  it('has every concept in every language', () => {
    for (const concept of parseMultilingual(source)) {
      for (const language of RADIOLOGY_LANGUAGES) expect(concept.terms[language]?.length, `${concept.key} (${language})`).toBeGreaterThan(0);
    }
  });

  it('uses the same concept ids in all languages', () => {
    const ids = RADIOLOGY_LANGUAGES.map((language) => buildRadiologyPack(source, language).concepts.map((c) => c.id));
    expect(ids[1]).toEqual(ids[0]);
    expect(ids[2]).toEqual(ids[0]);
  });
});

describe('German', () => {
  const de = recognizer('de');

  it('recognises common imaging patterns in their inflected forms', async () => {
    const hits = await found(de, 'Subpleurale Milchglastrübungen beidseits. Solider Nodulus im rechten Oberlappen. Frische Diffusionsrestriktion links. Hypodense Leberläsion.');
    expect(hits['Milchglastrübungen']).toBe('radiology:ground-glass-opacity|present');
    expect(hits['Solider Nodulus']).toBe('radiology:solid-nodule|present');
    expect(hits['Diffusionsrestriktion']).toBe('radiology:restricted-diffusion|present');
    expect(hits['Hypodense']).toBe('radiology:hypodense|-');
    expect(hits['Leberläsion']).toBe('radiology:liver-lesion|present');
  });

  it('knows the English terms that are in everyday use in German reports', async () => {
    const hits = await found(de, 'Crazy Paving beidseits, kein Honeycombing. Deutliches Enhancement. Bone bruise am Femur. Multiple Microbleeds. Fat stranding perikolisch.');
    expect(hits['Crazy Paving']).toBe('radiology:crazy-paving|present');
    expect(hits['Honeycombing']).toBe('radiology:honeycombing|negated');
    expect(hits['Enhancement']).toBe('radiology:enhancement|present');
    expect(hits['Bone bruise']).toBe('radiology:bone-marrow-edema|present');
    expect(hits['Microbleeds']).toBe('radiology:microbleed|present');
    expect(hits['Fat stranding']).toBe('radiology:fat-stranding|present');
  });

  it('matches a full English pack as second language, but not its short words', async () => {
    const mixed = recognizer('de', [buildRadiologyPack(source, 'en')]);
    const hits = await found(mixed, 'Kleine pleural effusion links, restricted diffusion. Ein Mass von 3 cm, kein Tear, kein Cyst.');
    expect(hits['pleural effusion']).toBe('radiology:pleural-effusion|present');
    expect(hits['restricted diffusion']).toBe('radiology:restricted-diffusion|present');
    expect(hits['Mass']).toBeUndefined();
    expect(hits['Tear']).toBeUndefined();
    expect(hits['Cyst']).toBeUndefined();
  });
});

describe('English', () => {
  const en = recognizer('en');

  it('recognises patterns, plurals, negation and uncertainty', async () => {
    const hits = await found(
      en,
      'Bilateral ground-glass opacities with crazy paving. Solid nodules in the right upper lobe. No honeycombing. No hemorrhage or midline shift. Metastases cannot be excluded.',
    );
    expect(hits['ground-glass opacities']).toBe('radiology:ground-glass-opacity|present');
    expect(hits['crazy paving']).toBe('radiology:crazy-paving|present');
    expect(hits['Solid nodules']).toBe('radiology:solid-nodule|present');
    expect(hits['upper lobe']).toBe('radiology:upper-lobe|-');
    expect(hits['honeycombing']).toBe('radiology:honeycombing|negated');
    expect(hits['midline shift']).toBe('radiology:midline-shift|negated');
    expect(hits['Metastases']).toBe('radiology:metastasis|uncertain');
  });

  it('does not apply German negation words', async () => {
    const hits = await found(en, 'Kein pleural effusion.');
    expect(hits['pleural effusion']).toBe('radiology:pleural-effusion|present');
  });
});

describe('French', () => {
  const fr = recognizer('fr');

  it('recognises patterns with plural, feminine and elided forms', async () => {
    const hits = await found(
      fr,
      "Plages de verre dépoli bilatérales sous-pleurales. Nodule solide du lobe supérieur droit. Lésions hépatiques hypodenses. Restriction de la diffusion à gauche. Présence d'adénopathies médiastinales.",
    );
    expect(hits['Plages de verre dépoli']).toBe('radiology:ground-glass-opacity|present');
    expect(hits['sous-pleurales']).toBe('radiology:subpleural|-');
    expect(hits['Nodule solide']).toBe('radiology:solid-nodule|present');
    expect(hits['Lésions hépatiques']).toBe('radiology:liver-lesion|present');
    expect(hits['hypodenses']).toBe('radiology:hypodense|-');
    expect(hits['adénopathies']).toBe('radiology:lymphadenopathy|present');
  });

  it('applies French negation and uncertainty, also without accents', async () => {
    const hits = await found(
      fr,
      "Pas de rayon de miel, absence de bronchectasies de traction. Pas d'hémorragie ni de déviation de la ligne médiane. Suspicion de métastases. Epanchement pericardique absent.",
    );
    expect(hits['rayon de miel']).toBe('radiology:honeycombing|negated');
    expect(hits['bronchectasies de traction']).toBe('radiology:traction-bronchiectasis|negated');
    expect(hits['hémorragie']).toBe('radiology:hemorrhage|negated');
    expect(hits['déviation de la ligne médiane']).toBe('radiology:midline-shift|negated');
    expect(hits['métastases']).toBe('radiology:metastasis|uncertain');
    expect(hits['Epanchement pericardique']).toBe('radiology:pericardial-effusion|negated');
  });

  it('reads laterality', async () => {
    const annotations = await fr.recognize('Épanchement pleural gauche.');
    expect(annotations[0]?.laterality).toBe('left');
  });
});
