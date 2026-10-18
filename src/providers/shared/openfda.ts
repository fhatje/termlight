/**
 * openFDA drug label API (https://open.fda.gov/apis/drug/label/), shared by the hover lookup and
 * the research source. US Structured Product Labeling as JSON; CORS: yes; data CC0.
 * Without a key openFDA allows 240 requests/min and 1000/day per IP.
 */
import { API_ACCESS } from './access.ts';
import { createHttpClient, qs } from './http.ts';
import type { RemoteOptions } from './http.ts';
import { fold, tidy } from './text.ts';

export interface OpenFdaOptions extends RemoteOptions {
  /** Optional openFDA API key (raises the daily quota). */
  apiKey?: string;
}

/** Label fields worth showing, in reading order, with their display heading. */
export const LABEL_SECTIONS: [field: string, heading: string][] = [
  ['boxed_warning', 'Boxed warning'],
  ['indications_and_usage', 'Indications and usage'],
  ['dosage_and_administration', 'Dosage and administration'],
  ['contraindications', 'Contraindications'],
  ['do_not_use', 'Do not use'],
  ['warnings_and_cautions', 'Warnings and precautions'],
  ['warnings', 'Warnings'],
  ['precautions', 'Precautions'],
  ['general_precautions', 'General precautions'],
  ['ask_doctor', 'Ask a doctor before use'],
  ['ask_doctor_or_pharmacist', 'Ask a doctor or pharmacist before use'],
  ['stop_use', 'Stop use and ask a doctor'],
  ['drug_interactions', 'Drug interactions'],
  ['adverse_reactions', 'Adverse reactions'],
  ['use_in_specific_populations', 'Use in specific populations'],
  ['pregnancy', 'Pregnancy'],
  ['pregnancy_or_breast_feeding', 'Pregnancy or breast-feeding'],
  ['nursing_mothers', 'Nursing mothers'],
  ['pediatric_use', 'Pediatric use'],
  ['geriatric_use', 'Geriatric use'],
  ['overdosage', 'Overdosage'],
  ['mechanism_of_action', 'Mechanism of action'],
  ['pharmacokinetics', 'Pharmacokinetics'],
  ['clinical_pharmacology', 'Clinical pharmacology'],
];

export interface DrugLabel {
  setId: string;
  title: string;
  genericName?: string;
  brandName?: string;
  manufacturer?: string;
  productType?: string;
  rxcui: string[];
  /** ISO date of the label version. */
  date?: string;
  /** Human readable page of this label on DailyMed. */
  url: string;
  sections: { field: string; heading: string; text: string }[];
}

interface RawLabel {
  set_id?: string;
  effective_time?: string;
  openfda?: {
    generic_name?: string[];
    brand_name?: string[];
    manufacturer_name?: string[];
    product_type?: string[];
    substance_name?: string[];
    rxcui?: string[];
  };
  [field: string]: unknown;
}
interface LabelResponse {
  results?: RawLabel[];
  error?: { code?: string; message?: string };
}

function toLabel(raw: RawLabel): DrugLabel | null {
  if (!raw.set_id) return null;
  const sections: DrugLabel['sections'] = [];
  for (const [field, heading] of LABEL_SECTIONS) {
    const value = raw[field];
    const text = tidy((Array.isArray(value) ? value : []).filter((v): v is string => typeof v === 'string').join('\n'));
    if (text) sections.push({ field, heading, text });
  }
  if (sections.length === 0) return null;
  const generic = raw.openfda?.generic_name?.[0];
  const brand = raw.openfda?.brand_name?.[0];
  const t = raw.effective_time;
  return {
    setId: raw.set_id,
    title: [brand, generic && fold(generic) !== fold(brand ?? '') ? `(${generic.toLowerCase()})` : '']
      .filter(Boolean)
      .join(' ') || 'Drug label',
    genericName: generic,
    brandName: brand,
    manufacturer: raw.openfda?.manufacturer_name?.[0],
    productType: raw.openfda?.product_type?.[0],
    rxcui: raw.openfda?.rxcui ?? [],
    date: t && /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : undefined,
    url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${raw.set_id}`,
    sections,
  };
}

/** Full prescribing information of a single-ingredient product ranks above OTC and combination labels. */
function quality(raw: RawLabel, name: string): number {
  const wanted = fold(name);
  const generic = fold(raw.openfda?.generic_name?.[0] ?? '');
  let score = 0;
  if (generic === wanted) score += 6;
  else if (generic.startsWith(`${wanted} `)) score += 4;
  if ((raw.openfda?.substance_name?.length ?? 2) === 1) score += 4;
  if (raw.openfda?.product_type?.[0] === 'HUMAN PRESCRIPTION DRUG') score += 3;
  for (const field of ['contraindications', 'drug_interactions', 'dosage_and_administration', 'adverse_reactions', 'use_in_specific_populations']) {
    if (raw[field]) score += 1;
  }
  return score;
}

export interface OpenFdaApi {
  /** Best labels for a substance given its English names. Empty array = no US label. */
  findLabels(names: string[], limit: number, signal?: AbortSignal): Promise<DrugLabel[]>;
}

export function createOpenFdaApi(opts: OpenFdaOptions = {}): OpenFdaApi {
  const http = createHttpClient({ provider: 'openFDA', ...API_ACCESS.openfda }, opts);

  async function query(search: string, limit: number, signal?: AbortSignal): Promise<RawLabel[]> {
    // `search` is assembled by hand: openFDA needs literal `+AND+`, `:` and quotes in the expression.
    const url = `https://api.fda.gov/drug/label.json?search=${search}&sort=effective_time:desc&${qs({ limit, api_key: opts.apiKey })}`;
    // openFDA answers "no match" with HTTP 404.
    const data = await http.json<LabelResponse>(url, { signal, nullOn: [404] });
    return data?.results ?? [];
  }

  async function findLabels(names: string[], limit: number, signal?: AbortSignal): Promise<DrugLabel[]> {
    if (names.length === 0) return [];
    // One request for all names of the substance (INN and synonyms such as "dipyrone").
    const substance = `(${names
      .flatMap((name) => {
        const quoted = `%22${encodeURIComponent(name.replace(/"/g, ''))}%22`;
        return [`openfda.generic_name:${quoted}`, `openfda.substance_name:${quoted}`];
      })
      .join('+OR+')})`;
    let raws = await query(`${substance}+AND+_exists_:contraindications`, 8, signal);
    // OTC labels have "Do not use" instead of a contraindications section.
    if (raws.length === 0) raws = await query(substance, 5, signal);

    const seen = new Set<string>();
    return raws
      .map((raw, index) => ({ raw, index, score: Math.max(...names.map((name) => quality(raw, name))) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ raw }) => toLabel(raw))
      .filter((label): label is DrugLabel => {
        // Many repackagers publish the identical text; one label per manufacturer is enough.
        const key = label ? fold(label.manufacturer ?? label.setId) : '';
        if (!label || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  return { findLabels };
}
