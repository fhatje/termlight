/**
 * Builds the term-card files the demo serves from its own origin: for every concept of the
 * curated dictionaries, what Wikidata and Wikipedia say about it.
 *
 *   node tools/build-lookup-cache.ts              German, English and French
 *   node tools/build-lookup-cache.ts --lang fr
 *
 * Output: public/lookup/wikidata.<lang>.json (concept id → card content). The services are asked
 * once here instead of by every visitor's browser:
 *
 *   1. Wikidata Query Service, one query per 60 terms: items named exactly like the term that
 *      carry a medical identifier (the search API and per-entity fetches are throttled to a crawl)
 *   2. Wikidata Query Service, one query per ~150 items, for labels, aliases, codes and the
 *      Wikipedia article
 *   3. Wikipedia, one request per 20 articles, for their introductions
 *
 * About one request per second; every response is cached in tools/.cache, so the run can be
 * interrupted and restarted and a second run is offline.
 *
 * The Wikipedia extracts are CC BY-SA 4.0; every entry carries its attribution and source link,
 * which the card displays.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CodeRef, ConceptInfo, PackConcept, TermPack } from '../src/core/types.ts';
import { cachedGet, sparql } from './lib/http.ts';

const PACKS: Record<string, string[]> = {
  de: ['seed.de.json', 'radiology.de.json'],
  en: ['radiology.en.json'],
  fr: ['radiology.fr.json'],
};
const MAX_DEFINITION = 900;
const BATCH = 150;

/** Identifiers that mark an item as medical; the first ones are also shown on the card. */
const CODE_PROPERTIES: [system: string, property: string][] = [
  ['ICD-10', 'P494'],
  ['ICD-11', 'P7807'],
  ['ATC', 'P267'],
  ['MeSH', 'P486'],
  ['UBERON', 'P1554'],
  ['TA98', 'P1323'],
  ['FMA', 'P1402'],
  ['RxNorm', 'P3345'],
  ['MONDO', 'P5270'],
  ['DOID', 'P699'],
  ['HPO', 'P3841'],
  ['UMLS', 'P2892'],
  ['NCIt', 'P1748'],
  ['SNOMED CT', 'P5806'],
  ['DrugBank', 'P715'],
];
const SHOWN_SYSTEMS = new Set(['ICD-10', 'ICD-11', 'ATC', 'MeSH', 'UBERON', 'RxNorm', 'MONDO', 'UMLS']);

const TEXT: Record<string, { shortDescription: string; license: string }> = {
  de: { shortDescription: 'Kurzbeschreibung (Wikidata)', license: 'Text: CC BY-SA 4.0 (Wikipedia-Autoren); Daten: CC0 (Wikidata)' },
  en: { shortDescription: 'Short description (Wikidata)', license: 'Text: CC BY-SA 4.0 (Wikipedia authors); data: CC0 (Wikidata)' },
  fr: { shortDescription: 'Description courte (Wikidata)', license: 'Texte : CC BY-SA 4.0 (auteurs de Wikipédia) ; données : CC0 (Wikidata)' },
};

const args = process.argv.slice(2);
const languages = args.includes('--lang') ? [args[args.indexOf('--lang') + 1] as string] : Object.keys(PACKS);
const log = (message: string): void => console.log(message);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `cachedGet` with a pause after anything that actually went over the network. */
async function politeGet(url: string): Promise<string> {
  const started = Date.now();
  const body = await cachedGet(url, { log });
  if (Date.now() - started > 40) await sleep(1000);
  return body;
}

function shorten(text: string | undefined): string | undefined {
  if (!text || text.length <= MAX_DEFINITION) return text;
  const cut = text.slice(0, MAX_DEFINITION);
  const end = cut.lastIndexOf('. ');
  return end > MAX_DEFINITION * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()} …`;
}

interface Item {
  label?: string;
  description?: string;
  aliases: string[];
  codes: CodeRef[];
  article?: string;
}

/** Spellings under which an item may carry the term: Wikidata writes English and French labels in lower case. */
function spellings(label: string): string[] {
  const lower = label.toLowerCase();
  return [...new Set([label, lower, lower.charAt(0).toUpperCase() + lower.slice(1)])];
}

/** Things that share a name with a medical term and even carry a medical identifier: genera, places, genes. */
const NOT_A_CONCEPT = ['Q16521', 'Q6256', 'Q3624078', 'Q35657', 'Q112099', 'Q7187', 'Q8054', 'Q5', 'Q515', 'Q4167410'];

interface Match {
  id: string;
  /** The term is the item's label (true) or only one of its aliases (false). */
  label: boolean;
}

/**
 * Items named exactly like a term (label or alias in `language`) that carry a medical
 * identifier. Done through the query service in batches: the search API allows only a trickle.
 */
async function findCandidates(terms: string[], language: string): Promise<Map<string, Match[]>> {
  const found = new Map<string, Match[]>();
  const medical = CODE_PROPERTIES.map(([, property]) => `wdt:${property}`).join(' ');
  const junk = NOT_A_CONCEPT.map((id) => `wd:${id}`).join(' ');
  const PER_QUERY = 60;
  for (let offset = 0; offset < terms.length; offset += PER_QUERY) {
    const batch = terms.slice(offset, offset + PER_QUERY);
    const values = batch
      .flatMap(spellings)
      .map((term) => `"${term.replace(/["\\]/g, '\\$&')}"@${language}`)
      .join(' ');
    const rows = await sparql(
      `SELECT DISTINCT ?l ?item ?kind WHERE { VALUES ?l { ${values} } ` +
        `{ ?item rdfs:label ?l . BIND("label" AS ?kind) } UNION { ?item skos:altLabel ?l . BIND("alias" AS ?kind) } ` +
        `FILTER EXISTS { VALUES ?p { ${medical} } ?item ?p ?code } ` +
        `FILTER NOT EXISTS { VALUES ?junk { ${junk} } ?item wdt:P31 ?junk } }`,
      { log },
    );
    for (const row of rows) {
      const id = (row.item ?? '').slice((row.item ?? '').lastIndexOf('/') + 1);
      const key = (row.l ?? '').toLowerCase();
      if (!/^Q\d+$/.test(id)) continue;
      const list = found.get(key) ?? [];
      const known = list.find((match) => match.id === id);
      if (known) known.label ||= row.kind === 'label';
      else list.push({ id, label: row.kind === 'label' });
      found.set(key, list);
    }
    log(`  terms ${Math.min(offset + PER_QUERY, terms.length)}/${terms.length}`);
  }
  return found;
}

/** Abbreviations and very short words mean too many things to be matched by an alias. */
const isSpecific = (term: string): boolean => term.length >= 6 && term !== term.toUpperCase();

async function fetchItems(ids: string[], language: string): Promise<Map<string, Item>> {
  const items = new Map<string, Item>();
  const codeBlocks = CODE_PROPERTIES.map(([system, property]) => `UNION { ?item wdt:${property} ?v . BIND("${system}" AS ?k) }`).join(' ');
  for (let offset = 0; offset < ids.length; offset += BATCH) {
    const values = ids.slice(offset, offset + BATCH).map((id) => 'wd:' + id).join(' ');
    const rows = await sparql(
      `SELECT ?item ?k ?v WHERE { VALUES ?item { ${values} } ` +
        `{ ?item rdfs:label ?v . FILTER(LANG(?v) = "${language}") BIND("label" AS ?k) } ` +
        `UNION { ?item skos:altLabel ?v . FILTER(LANG(?v) = "${language}") BIND("alt" AS ?k) } ` +
        `UNION { ?item schema:description ?v . FILTER(LANG(?v) = "${language}") BIND("desc" AS ?k) } ` +
        `UNION { ?v schema:about ?item ; schema:isPartOf <https://${language}.wikipedia.org/> . BIND("article" AS ?k) } ` +
        `${codeBlocks} }`,
      { log },
    );
    for (const row of rows) {
      const id = (row.item ?? '').slice((row.item ?? '').lastIndexOf('/') + 1);
      const item = items.get(id) ?? { aliases: [], codes: [] };
      items.set(id, item);
      const value = row.v ?? '';
      if (row.k === 'label') item.label = value;
      else if (row.k === 'desc') item.description = value;
      else if (row.k === 'alt') item.aliases.push(value);
      else if (row.k === 'article') item.article = value;
      else if (row.k && !item.codes.some((c) => c.system === row.k && c.code === value)) item.codes.push({ system: row.k, code: value });
    }
    log(`  details ${Math.min(offset + BATCH, ids.length)}/${ids.length}`);
  }
  return items;
}

const titleOf = (articleUrl: string): string => decodeURIComponent(articleUrl.slice(articleUrl.lastIndexOf('/') + 1)).replace(/_/g, ' ');

/** Intro texts of many articles at once: 20 titles per request instead of one request each. */
async function fetchIntros(articleUrls: string[], language: string): Promise<Map<string, string>> {
  const intros = new Map<string, string>();
  const titles = [...new Set(articleUrls.map(titleOf))];
  const PER_REQUEST = 20;
  for (let offset = 0; offset < titles.length; offset += PER_REQUEST) {
    const batch = titles.slice(offset, offset + PER_REQUEST);
    const url =
      `https://${language}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exlimit=${PER_REQUEST}` +
      `&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`;
    try {
      const data = JSON.parse(await politeGet(url)) as {
        query?: {
          normalized?: { from: string; to: string }[];
          redirects?: { from: string; to: string }[];
          pages?: { title: string; extract?: string; missing?: boolean }[];
        };
      };
      // The answer is keyed by the final title; walk back to the title that was asked for.
      const origin = new Map<string, string[]>();
      for (const title of batch) origin.set(title, [title]);
      for (const step of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) {
        const asked = origin.get(step.from);
        if (!asked) continue;
        origin.delete(step.from);
        origin.set(step.to, [...(origin.get(step.to) ?? []), ...asked]);
      }
      for (const page of data.query?.pages ?? []) {
        const extract = page.extract?.replace(/\s+/g, ' ').trim();
        if (!extract) continue;
        for (const asked of origin.get(page.title) ?? []) intros.set(asked, extract);
      }
    } catch (error) {
      log(`  ! intros: ${error instanceof Error ? error.message : String(error)}`);
    }
    log(`  intros ${Math.min(offset + PER_REQUEST, titles.length)}/${titles.length}`);
    await sleep(1500);
  }
  return intros;
}

mkdirSync('public/lookup', { recursive: true });
const skip = new Set(
  readFileSync(new URL('./data/lookup-skip.txt', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
);

for (const language of languages) {
  const text = TEXT[language] ?? (TEXT.en as (typeof TEXT)[string]);
  const concepts: { conceptId: string; concept: PackConcept }[] = [];
  for (const file of PACKS[language] ?? []) {
    const pack = JSON.parse(readFileSync(`public/packs/${file}`, 'utf8')) as TermPack;
    for (const concept of pack.concepts) concepts.push({ conceptId: `${pack.id}:${concept.id}`, concept });
  }
  log(`${language}: ${concepts.length} concepts`);

  // 1. candidates: by the label of the concept, otherwise by its longer synonyms
  const surfaces = (concept: PackConcept): string[] => [concept.label, ...(concept.terms ?? []).filter(isSpecific)].slice(0, 6);
  const byTerm = await findCandidates([...new Set(concepts.flatMap(({ concept }) => surfaces(concept)))], language);
  const candidates = new Map<string, string[]>();
  for (const { conceptId, concept } of concepts) {
    if (skip.has(`${language} ${conceptId}`) || skip.has(`* ${conceptId}`)) continue;
    const ids: string[] = [];
    for (const [index, term] of surfaces(concept).entries()) {
      for (const match of byTerm.get(term.toLowerCase()) ?? []) {
        // An item that is merely also known under this name counts only for a specific name;
        // a synonym of the concept has to be the item's own label.
        const acceptable = match.label || (index === 0 && isSpecific(term));
        if (acceptable && !ids.includes(match.id)) ids.push(match.id);
      }
      if (ids.length > 0) break;
    }
    candidates.set(conceptId, ids);
  }

  // 2. details for all candidates at once
  const items = await fetchItems([...new Set([...candidates.values()].flat())], language);

  // 3. the introductions of the Wikipedia articles of all items
  const intros = await fetchIntros([...items.values()].flatMap((item) => (item.article ? [item.article] : [])), language);

  // 4. the best candidate per concept
  const out: Record<string, ConceptInfo> = {};
  let withArticle = 0;
  for (const { conceptId, concept } of concepts) {
    // Several items can share a name. The one with a Wikipedia article in this language and the
    // most identifiers is the established concept; the rest are variants and duplicates.
    const rank = (candidate: string): number => {
      const item = items.get(candidate);
      return (item?.label?.toLowerCase() === concept.label.toLowerCase() ? 200 : 0) + (item?.article ? 100 : 0) + (item?.codes.length ?? 0);
    };
    const id = [...(candidates.get(conceptId) ?? [])].sort((a, b) => rank(b) - rank(a))[0];
    const item = id ? items.get(id) : undefined;
    if (!id || !item) continue;
    const introText = item.article ? intros.get(titleOf(item.article)) : undefined;
    const intro = item.article && introText ? { text: introText, url: item.article } : null;
    if (intro) withArticle++;
    const wikidataUrl = `https://www.wikidata.org/wiki/${id}`;
    const info: ConceptInfo = {
      conceptId,
      title: item.label ?? concept.label,
      type: concept.type,
      definition: shorten(intro?.text ?? item.description),
      synonyms: [...new Set(item.aliases)].slice(0, 12),
      codes: [...item.codes.filter((code) => SHOWN_SYSTEMS.has(code.system)).slice(0, 8), { system: 'Wikidata', code: id }],
      links: [...(intro ? [{ label: `Wikipedia (${language})`, url: intro.url }] : []), { label: 'Wikidata', url: wikidataUrl }],
      language,
      attribution: intro
        ? { name: `Wikipedia (${language}), Wikidata`, url: intro.url, license: text.license }
        : { name: 'Wikidata', url: wikidataUrl, license: 'CC0 1.0' },
    };
    if (intro && item.description) info.sections = [{ title: text.shortDescription, text: item.description }];
    out[conceptId] = info;
  }
  const path = `public/lookup/wikidata.${language}.json`;
  writeFileSync(path, JSON.stringify(out));
  log(`${language}: ${Object.keys(out).length} of ${concepts.length} concepts have a card, ${withArticle} with a Wikipedia extract → ${path}`);
}
