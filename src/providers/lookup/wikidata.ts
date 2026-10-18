import type { ConceptInfo } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient } from '../shared/http.ts';
import { languageOf } from './common.ts';
import type { LookupOptions, RemoteConceptLookup } from './common.ts';
import { sharedWikidataApi, wikidataIdOf } from './wikidata-api.ts';
import type { WikidataEntity } from './wikidata-api.ts';

interface PageSummary {
  type?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

/**
 * Label, description, aliases and codes from Wikidata (CC0) plus the intro of the Wikipedia
 * article in the document language (CC BY-SA 4.0). Resolves by `Wikidata` code or
 * `wikidata:Q…` concept id, otherwise by a label search restricted to items that carry medical
 * identifiers. CORS: yes, no proxy needed.
 */
/** The few words this lookup adds itself, in the language of the card. */
const TEXT: Record<string, { shortDescription: string; license: string }> = {
  de: { shortDescription: 'Kurzbeschreibung (Wikidata)', license: 'Text: CC BY-SA 4.0 (Wikipedia-Autoren); Daten: CC0 (Wikidata)' },
  en: { shortDescription: 'Short description (Wikidata)', license: 'Text: CC BY-SA 4.0 (Wikipedia authors); data: CC0 (Wikidata)' },
  fr: { shortDescription: 'Description courte (Wikidata)', license: 'Texte : CC BY-SA 4.0 (auteurs de Wikipédia) ; données : CC0 (Wikidata)' },
};

export function createWikidataLookup(opts: LookupOptions = {}): RemoteConceptLookup {
  const wikidata = sharedWikidataApi(opts);
  const wikipedia = createHttpClient({ provider: 'Wikipedia', ...API_ACCESS.wikipedia }, opts);

  async function summary(entity: WikidataEntity, language: string, signal?: AbortSignal): Promise<{ text: string; url: string } | null> {
    const article = entity.articles[language];
    if (!article) return null;
    const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article.title.replace(/ /g, '_'))}`;
    try {
      const data = await wikipedia.json<PageSummary>(url, { signal, nullOn: [404] });
      if (!data?.extract || data.type === 'disambiguation') return null;
      return { text: data.extract, url: data.content_urls?.desktop?.page ?? article.url };
    } catch (error) {
      if (signal?.aborted) throw error;
      // The Wikidata part is still a complete answer; the extract is an optional extra.
      return null;
    }
  }

  return {
    id: 'wikidata',
    label: 'Wikidata + Wikipedia',
    locality: 'remote',
    needsProxy: false,
    description:
      'Bezeichnung, Synonyme und Codes (ICD-10, ATC, MeSH, UBERON …) aus Wikidata (CC0) sowie Einleitung des Wikipedia-Artikels (CC BY-SA 4.0). Gesendet wird nur der Begriff. Keine geprüfte medizinische Primärquelle.',

    async lookup(concept, callOpts) {
      const language = languageOf(callOpts, opts.language);
      const signal = callOpts?.signal;
      const text = TEXT[language] ?? (TEXT.en as (typeof TEXT)[string]);
      const id = wikidataIdOf(concept);
      const entity = id
        ? ((await wikidata.entities([id], [language], signal))[0] ?? null)
        : await wikidata.find(concept.label, { language, type: concept.type, signal });
      if (!entity) return null;

      const intro = await summary(entity, language, signal);
      const title = entity.labels[language] ?? entity.labels['en'] ?? concept.label;
      const description = entity.descriptions[language] ?? entity.descriptions['en'];
      const links: NonNullable<ConceptInfo['links']> = [];
      const article = entity.articles[language];
      if (article) links.push({ label: `Wikipedia (${language})`, url: intro?.url ?? article.url });
      links.push({ label: 'Wikidata', url: `https://www.wikidata.org/wiki/${entity.id}` });

      const info: ConceptInfo = {
        conceptId: concept.conceptId,
        title,
        type: concept.type,
        definition: intro?.text ?? description,
        synonyms: [...(entity.aliases[language] ?? [])].slice(0, 12),
        codes: [...entity.codes, { system: 'Wikidata', code: entity.id }],
        links,
        language,
        attribution: intro
          ? {
              name: `Wikipedia (${language}), Wikidata`,
              url: intro.url,
              license: text.license,
            }
          : { name: 'Wikidata', url: `https://www.wikidata.org/wiki/${entity.id}`, license: 'CC0 1.0' },
      };
      if (intro && description) info.sections = [{ title: text.shortDescription, text: description }];
      return info;
    },
  };
}
