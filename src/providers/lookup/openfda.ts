import { createOpenFdaApi } from '../shared/openfda.ts';
import type { OpenFdaOptions } from '../shared/openfda.ts';
import { truncate } from '../shared/text.ts';
import { isDrugType, languageOf, resolverOf, searchNames } from './common.ts';
import type { LookupOptions, RemoteConceptLookup } from './common.ts';

/** Sections shown on the hover card; the research source returns all of them in full length. */
const CARD_FIELDS = [
  'boxed_warning',
  'indications_and_usage',
  'contraindications',
  'do_not_use',
  'dosage_and_administration',
  'warnings_and_cautions',
  'warnings',
  'drug_interactions',
  'adverse_reactions',
];

export interface OpenFdaLookupOptions extends LookupOptions, OpenFdaOptions {
  /** Characters per section on the card, default 900. */
  maxSectionChars?: number;
}

/**
 * US drug label (FDA Structured Product Labeling) via openFDA: indications, contraindications,
 * boxed warning, dosage … in English. Drugs without US approval (e.g. metamizole) resolve to `null`.
 * CORS: yes, no proxy needed.
 */
export function createOpenFdaLookup(opts: OpenFdaLookupOptions = {}): RemoteConceptLookup {
  const api = createOpenFdaApi(opts);
  const resolve = resolverOf(opts);
  const max = opts.maxSectionChars ?? 900;

  return {
    id: 'openfda',
    label: 'openFDA Arzneimittel-Label (USA)',
    locality: 'remote',
    needsProxy: false,
    description:
      'Abschnitte der US-Fachinformation (FDA-Label: Indikationen, Kontraindikationen, Boxed Warning, Dosierung …) über openFDA. Englisch, nur in den USA zugelassene Arzneimittel; gesendet wird nur der Wirkstoffname. Lizenz CC0; laut openFDA nicht für klinische Entscheidungen validiert.',
    supports: isDrugType,

    async lookup(concept, callOpts) {
      if (!isDrugType(concept)) return null;
      const signal = callOpts?.signal;
      const variants = await resolve(concept.label, {
        language: languageOf(callOpts, opts.language),
        codes: concept.codes,
        type: concept.type,
        signal,
      });
      const [label] = await api.findLabels(searchNames(concept, variants, 3), 1, signal);
      if (!label) return null;

      const sections = CARD_FIELDS.flatMap((field) => {
        const section = label.sections.find((s) => s.field === field);
        return section ? [{ title: section.heading, text: truncate(section.text, max) }] : [];
      });
      return {
        conceptId: concept.conceptId,
        title: label.title,
        type: concept.type,
        synonyms: label.brandName ? [label.brandName] : undefined,
        codes: label.rxcui.slice(0, 3).map((code) => ({ system: 'RxNorm', code })),
        sections,
        links: [{ label: 'DailyMed (vollständiges Label)', url: label.url }],
        language: 'en',
        attribution: {
          name: `openFDA drug label${label.manufacturer ? ` – ${label.manufacturer}` : ''}${label.date ? `, ${label.date}` : ''}`,
          url: label.url,
          license: 'CC0 1.0 (openFDA). Do not rely on openFDA to make decisions regarding medical care.',
        },
      };
    },
  };
}
