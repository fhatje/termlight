/**
 * Compiles tools/seed/seed.de.txt into public/packs/seed.de.json.
 * Usage: node tools/build-seed.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CodeRef, ConceptType } from '../src/core/types.ts';
import type { MatcherConcept, MatcherPack } from '../src/core/matcher/index.ts';

const TYPES = new Set<string>(['anatomy', 'disease', 'symptom', 'finding', 'medication', 'substance', 'procedure', 'lab', 'physiology', 'modifier', 'other']);

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseSeed(source: string): MatcherConcept[] {
  const concepts: MatcherConcept[] = [];
  const ids = new Set<string>();
  let type: ConceptType | null = null;
  source.split('\n').forEach((line, index) => {
    const where = `seed line ${index + 1}`;
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      const name = trimmed.slice(3).trim();
      if (!TYPES.has(name)) throw new Error(`${where}: unknown type "${name}"`);
      type = name as ConceptType;
      return;
    }
    if (!trimmed || trimmed.startsWith('#')) return;
    if (!type) throw new Error(`${where}: concept before the first "## type" section`);
    let fields = trimmed.split('|').map((f) => f.trim());
    // "Label | ATC:X" is allowed as a shorthand for a concept without extra terms.
    if (fields.length === 2 && /^[A-Za-z0-9-]+:\S+(,\s*[A-Za-z0-9-]+:\S+)*$/.test(fields[1] ?? '')) fields = [fields[0] ?? '', '', fields[1] ?? ''];
    if (fields.length === 3 && /^[A-Za-z0-9-]+:\S+(,\s*[A-Za-z0-9-]+:\S+)*$/.test(fields[1] ?? '') && !/^[A-Za-z0-9-]+:\S+/.test(fields[2] ?? '')) {
      fields = [fields[0] ?? '', '', fields[1] ?? '', fields[2] ?? ''];
    }
    const [label = '', termField = '', codeField = '', definition = ''] = fields;
    if (!label) throw new Error(`${where}: empty label`);
    const id = `${type}-${slug(label)}`;
    if (ids.has(id)) throw new Error(`${where}: duplicate concept "${label}"`);
    ids.add(id);

    const concept: MatcherConcept = { id, label, type };
    const terms: string[] = [];
    const exact: string[] = [];
    for (const raw of termField.split(';').map((t) => t.trim()).filter(Boolean)) {
      if (raw.startsWith('=')) exact.push(raw.slice(1).trim());
      else terms.push(raw);
    }
    if (terms.length) concept.terms = terms;
    if (exact.length) concept.exact = exact;
    const codes: CodeRef[] = [];
    for (const raw of codeField.split(',').map((c) => c.trim()).filter(Boolean)) {
      const colon = raw.indexOf(':');
      if (colon <= 0) throw new Error(`${where}: code "${raw}" is not SYSTEM:code`);
      codes.push({ system: raw.slice(0, colon), code: raw.slice(colon + 1) });
    }
    if (codes.length) concept.codes = codes;
    if (definition) concept.definition = definition;
    concepts.push(concept);
  });
  return concepts;
}

export function buildSeedPack(source: string): MatcherPack {
  return {
    id: 'seed-de',
    name: 'Basisvokabular (Deutsch)',
    version: '2026.10',
    language: 'de',
    license: 'CC0-1.0',
    attribution: 'Handkuratiertes Basisvokabular, gemeinfrei (CC0 1.0).',
    homepage: 'https://creativecommons.org/publicdomain/zero/1.0/',
    priority: 100,
    concepts: parseSeed(source),
  };
}

export const RADIOLOGY_LANGUAGES = ['de', 'en', 'fr'] as const;
export type RadiologyLanguage = (typeof RADIOLOGY_LANGUAGES)[number];

const RADIOLOGY_META: Record<RadiologyLanguage, { name: string; attribution: string }> = {
  de: {
    name: 'Radiologische Befundmuster (Deutsch)',
    attribution: 'Handkuratierte Liste häufiger radiologischer Befundmuster und Deskriptoren, gemeinfrei (CC0 1.0).',
  },
  en: {
    name: 'Radiological findings (English)',
    attribution: 'Hand-curated list of common radiological findings and descriptors, public domain (CC0 1.0).',
  },
  fr: {
    name: 'Sémiologie radiologique (français)',
    attribution: 'Liste établie à la main des signes et descripteurs radiologiques courants, domaine public (CC0 1.0).',
  },
};

interface TermSpec {
  text: string;
  exact: boolean;
  international: boolean;
}

function parseTerm(raw: string): TermSpec {
  let text = raw.trim();
  let exact = false;
  let international = false;
  for (;;) {
    if (text.startsWith('=')) exact = true;
    else if (text.startsWith('^')) international = true;
    else break;
    text = text.slice(1).trim();
  }
  return { text, exact, international };
}

interface MultilingualConcept {
  key: string;
  type: ConceptType;
  codes: CodeRef[];
  /** Per language: label first, then the other surface forms. */
  terms: Partial<Record<string, TermSpec[]>>;
  definitions: Partial<Record<string, string>>;
}

/** Parses the multilingual block format documented at the top of tools/seed/radiology.txt. */
export function parseMultilingual(source: string): MultilingualConcept[] {
  const concepts: MultilingualConcept[] = [];
  const keys = new Set<string>();
  let type: ConceptType | null = null;
  let current: MultilingualConcept | null = null;
  source.split('\n').forEach((line, index) => {
    const where = `radiology line ${index + 1}`;
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      const name = trimmed.slice(3).trim();
      if (!TYPES.has(name)) throw new Error(`${where}: unknown type "${name}"`);
      type = name as ConceptType;
      current = null;
      return;
    }
    if (!trimmed || trimmed.startsWith('#')) return;
    if (trimmed.startsWith('@')) {
      if (!type) throw new Error(`${where}: concept before the first "## type" section`);
      const [key = '', codeField = ''] = trimmed.slice(1).split('|').map((f) => f.trim());
      if (!/^[a-z0-9-]+$/.test(key)) throw new Error(`${where}: key "${key}" must be lower-case ASCII with hyphens`);
      if (keys.has(key)) throw new Error(`${where}: duplicate key "${key}"`);
      keys.add(key);
      const codes: CodeRef[] = [];
      for (const raw of codeField.split(',').map((c) => c.trim()).filter(Boolean)) {
        const colon = raw.indexOf(':');
        if (colon <= 0) throw new Error(`${where}: code "${raw}" is not SYSTEM:code`);
        codes.push({ system: raw.slice(0, colon), code: raw.slice(colon + 1) });
      }
      current = { key, type, codes, terms: {}, definitions: {} };
      concepts.push(current);
      return;
    }
    const match = /^([a-z]{2}):\s*(.*)$/.exec(trimmed);
    if (!match || !current) throw new Error(`${where}: expected "@key" or "xx: Label | terms"`);
    const [, language = '', rest = ''] = match;
    const [label = '', termField = '', definition = ''] = rest.split('|').map((f) => f.trim());
    if (!label) throw new Error(`${where}: empty label`);
    current.terms[language] = [parseTerm(label), ...termField.split(';').map((t) => t.trim()).filter(Boolean).map(parseTerm)];
    if (definition) current.definitions[language] = definition;
  });
  return concepts;
}

/** One pack per language from the multilingual source; concept ids are the same in all of them. */
export function buildRadiologyPack(source: string, language: RadiologyLanguage = 'de'): MatcherPack {
  const concepts: MatcherConcept[] = [];
  for (const entry of parseMultilingual(source)) {
    const own = entry.terms[language];
    if (!own || own.length === 0) continue;
    // Terms marked "^" in another language are in everyday use here as well.
    const borrowed = Object.entries(entry.terms)
      .filter(([other]) => other !== language)
      .flatMap(([, list]) => (list ?? []).filter((t) => t.international));
    const [label, ...rest] = own as [TermSpec, ...TermSpec[]];
    const seen = new Set([label.text.toLowerCase()]);
    const terms: string[] = [];
    const exact: string[] = label.exact ? [label.text] : [];
    for (const term of [...rest, ...borrowed]) {
      const key = term.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      (term.exact ? exact : terms).push(term.text);
    }
    const concept: MatcherConcept = { id: entry.key, label: label.text, type: entry.type };
    if (terms.length) concept.terms = terms;
    if (exact.length) concept.exact = exact;
    if (entry.codes.length) concept.codes = entry.codes;
    const definition = entry.definitions[language];
    if (definition) concept.definition = definition;
    concepts.push(concept);
  }
  return {
    // Same id in every language: `radiology:ground-glass-opacity` is one concept, whatever the report language.
    id: 'radiology',
    name: RADIOLOGY_META[language].name,
    version: '2026.10',
    language,
    license: 'CC0-1.0',
    attribution: RADIOLOGY_META[language].attribution,
    homepage: 'https://creativecommons.org/publicdomain/zero/1.0/',
    // Above the general vocabulary: "Milchglastrübung" should resolve to the imaging pattern.
    priority: 110,
    concepts,
  };
}

function writePack(pack: MatcherPack, outPath: string): void {
  // One concept per line keeps diffs of the committed file readable.
  const { concepts, ...meta } = pack;
  const head = JSON.stringify(meta, null, 1).replace(/\n}$/, '');
  writeFileSync(new URL(outPath, import.meta.url), `${head},\n "concepts": [\n${concepts.map((c) => '  ' + JSON.stringify(c)).join(',\n')}\n ]\n}\n`);
  const terms = concepts.reduce((n, c) => n + 1 + (c.terms?.length ?? 0) + (c.exact?.length ?? 0), 0);
  console.log(`${outPath.split('/').pop()}: ${concepts.length} concepts, ${terms} surface forms`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writePack(buildSeedPack(readFileSync(new URL('./seed/seed.de.txt', import.meta.url), 'utf8')), '../public/packs/seed.de.json');
  const radiology = readFileSync(new URL('./seed/radiology.txt', import.meta.url), 'utf8');
  for (const language of RADIOLOGY_LANGUAGES) writePack(buildRadiologyPack(radiology, language), `../public/packs/radiology.${language}.json`);
}
