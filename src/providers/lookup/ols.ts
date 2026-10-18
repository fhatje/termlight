import type { ConceptRef, ConceptType } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, qs } from '../shared/http.ts';
import { fold, tidy, unique } from '../shared/text.ts';
import { codeOf, languageOf, resolverOf, searchNames } from './common.ts';
import type { LookupOptions, RemoteConceptLookup } from './common.ts';

const SEARCH = 'https://www.ebi.ac.uk/ols4/api/search';

const ONTOLOGIES: Record<string, { name: string; system: string; license: string; types: ConceptType[] }> = {
  mondo: { name: 'Mondo Disease Ontology', system: 'MONDO', license: 'CC BY 4.0', types: ['disease'] },
  hp: {
    name: 'Human Phenotype Ontology',
    system: 'HPO',
    license: 'HPO licence (free use with attribution, https://hpo.jax.org/license)',
    types: ['symptom', 'finding', 'disease'],
  },
  uberon: { name: 'Uberon anatomy ontology', system: 'UBERON', license: 'CC BY 3.0', types: ['anatomy'] },
};

interface OlsDoc {
  iri?: string;
  label?: string;
  obo_id?: string;
  ontology_name?: string;
  description?: string[];
  synonym?: string[];
  is_defining_ontology?: boolean;
}
interface OlsResponse {
  response?: { docs?: OlsDoc[] };
}

function ontologiesFor(type: ConceptType): string[] {
  // Preferred ontology first: findings are phenotypes before they are diseases.
  const order = type === 'disease' ? ['mondo', 'hp'] : type === 'anatomy' ? ['uberon'] : ['hp', 'mondo'];
  return order.filter((o) => ONTOLOGIES[o]!.types.includes(type));
}

function supports(concept: ConceptRef): boolean {
  return ontologiesFor(concept.type).length > 0;
}

/**
 * Definitions from MONDO (diseases), HPO (symptoms/findings) and UBERON (anatomy) through the EBI
 * Ontology Lookup Service (OLS4). English only; German labels are bridged through Wikidata.
 * CORS: yes, no proxy needed.
 */
export function createOlsLookup(opts: LookupOptions = {}): RemoteConceptLookup {
  const http = createHttpClient({ provider: 'OLS', ...API_ACCESS.ols }, opts);
  const resolve = resolverOf(opts);

  async function search(q: string, ontologies: string[], field: string, signal?: AbortSignal): Promise<OlsDoc[]> {
    const url = `${SEARCH}?${qs({
      q,
      ontology: ontologies.join(','),
      exact: 'true',
      queryFields: field,
      rows: 8,
      fieldList: 'iri,label,obo_id,ontology_name,description,synonym,is_defining_ontology',
    })}`;
    const data = await http.json<OlsResponse>(url, { signal });
    // Terms imported into another ontology come back twice; only the defining copy has the definition.
    return (data?.response?.docs ?? []).filter((d) => d.is_defining_ontology && d.obo_id && d.label);
  }

  return {
    id: 'ols',
    label: 'Ontologien: MONDO, HPO, UBERON (EBI OLS)',
    locality: 'remote',
    needsProxy: false,
    description:
      'Definitionen aus MONDO (Krankheiten, CC BY 4.0), HPO (Symptome/Befunde, HPO-Lizenz) und UBERON (Anatomie, CC BY 3.0) über den Ontology Lookup Service des EMBL-EBI. Englisch; gesendet wird nur der Begriff.',
    supports,

    async lookup(concept, callOpts) {
      const ontologies = ontologiesFor(concept.type);
      if (ontologies.length === 0) return null;
      const signal = callOpts?.signal;
      const variants = await resolve(concept.label, {
        language: languageOf(callOpts, opts.language),
        codes: concept.codes,
        type: concept.type,
        signal,
      });
      const codes = [...(concept.codes ?? []), ...variants.codes];

      let docs: OlsDoc[] = [];
      for (const ontology of ontologies) {
        const code = codeOf(codes, ONTOLOGIES[ontology]!.system);
        if (code) docs = await search(code.replace('_', ':'), [ontology], 'obo_id', signal);
        if (docs.length) break;
      }
      if (docs.length === 0) {
        if (!variants.english) return null;
        for (const name of searchNames(concept, variants, 2)) {
          docs = await search(name, ontologies, 'label,synonym', signal);
          if (docs.length) {
            const wanted = fold(name);
            docs.sort(
              (a, b) =>
                Number(fold(b.label!) === wanted) - Number(fold(a.label!) === wanted) ||
                ontologies.indexOf(a.ontology_name!) - ontologies.indexOf(b.ontology_name!),
            );
            break;
          }
        }
      }
      const doc = docs.find((d) => d.description?.length) ?? docs[0];
      const ontology = doc && ONTOLOGIES[doc.ontology_name ?? ''];
      if (!doc || !ontology) return null;

      // UBERON lists taxon notes before the definition proper; the shortest text is the definition.
      const definition = [...(doc.description ?? [])].map(tidy).sort((a, b) => a.length - b.length)[0];
      const url = doc.iri ?? `https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(doc.obo_id!)}`;
      return {
        conceptId: concept.conceptId,
        title: doc.label!,
        type: concept.type,
        definition,
        synonyms: unique(doc.synonym ?? [], fold).filter((s) => fold(s) !== fold(doc.label!)).slice(0, 12),
        codes: [{ system: ontology.system, code: doc.obo_id! }],
        links: [{ label: `${ontology.system} ${doc.obo_id}`, url }],
        language: 'en',
        attribution: { name: `${ontology.name} via EMBL-EBI OLS`, url, license: ontology.license },
      };
    },
  };
}
