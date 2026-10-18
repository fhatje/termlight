import type { SourceDocument } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, qs } from '../shared/http.ts';
import { fold, htmlToText, unique } from '../shared/text.ts';
import { analyzerOf, drugCandidates } from './common.ts';
import type { RemoteResearchSource, SourceOptions } from './common.ts';
import { limitOf, rankPassages } from './query.ts';
import type { AnalyzedTerm, Section } from './query.ts';

const SEARCH_API = 'https://www.swissmedicinfo.ch/api';
const TEXT_URL = 'https://swissmedicinfo-pro.ch/showText.aspx';

const MONTHS = ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];

interface IngredientList {
  entries?: { text: string }[];
}
interface MedicationList {
  entries?: { praeparatname: string; wirkstoff: string; zulassungsinhaber?: string; packungsnummer: number }[];
}

interface Product {
  /** Swissmedic authorisation number (first five digits of the pack number). */
  authNr: number;
  brand: string;
  holder?: string;
  mono: boolean;
}

export interface Fachinformation {
  title: string;
  sections: Section[];
  /** ISO year-month from "Stand der Information". */
  date?: string;
}

/** Parses the HTML of `showText.aspx?textType=FI`. `null` = the page carries no Fachinformation. */
export function parseFachinformation(html: string): Fachinformation | null {
  const start = html.indexOf('<article');
  const end = html.indexOf('</article>', start);
  if (start === -1 || end === -1) return null;
  const article = html.slice(start, end).replace(/<style\b[\s\S]*?<\/style>/gi, '');

  // Every chapter heading of the authority template is a paragraph with id="sectionN".
  const heads = [...article.matchAll(/<p\b[^>]*\sid="section\d+"[^>]*>([\s\S]*?)<\/p>/g)];
  if (heads.length === 0) return null;

  const sections: Section[] = [];
  const bodyStart = article.search(/<body\b/i);
  const title = htmlToText(/<title>([\s\S]*?)<\/title>/i.exec(article)?.[1] ?? '');
  const preface = htmlToText(article.slice(bodyStart === -1 ? 0 : bodyStart, heads[0]!.index));
  // Text before the first chapter is either just the product name or the boxed warning.
  if (/warnhinweis|warnung/.test(fold(preface))) sections.push({ heading: 'Wichtiger Warnhinweis', text: preface });
  heads.forEach((head, i) => {
    const from = head.index + head[0].length;
    const to = heads[i + 1]?.index ?? article.length;
    const text = htmlToText(article.slice(from, to)).replace(/^·\s?/gm, '- ');
    const heading = htmlToText(head[1]!);
    // Some texts repeat the product name as first "chapter"; it only holds the company name.
    if (heading && text && fold(heading) !== fold(title)) sections.push({ heading, text });
  });

  const stand = fold(sections.find((s) => fold(s.heading ?? '').startsWith('stand der information'))?.text ?? '');
  const match = /([a-z]+)\s+(\d{4})/.exec(stand);
  const month = match ? MONTHS.indexOf(match[1]!) + 1 : 0;
  const date = match ? (month ? `${match[2]}-${String(month).padStart(2, '0')}` : match[2]) : undefined;
  return { title: title || 'Fachinformation', sections, date };
}

export interface SwissmedicInfoSourceOptions extends SourceOptions {
  /** Chapters that are never clinically relevant for a question are dropped. Default `true`. */
  skipAdministrativeSections?: boolean;
}

const ADMINISTRATIVE = /^(zulassungsnummer|packungen|zulassungsinhaberin|stand der information)/;

/**
 * Swiss "Fachinformation" (SmPC) in German from AIPS, the official publication platform of
 * Swissmedic-approved product information run by the Refdata foundation. One document per
 * product, chapters ("Kontraindikationen", "Dosierung/Anwendung", "Interaktionen" …) as passages.
 *
 * Access: product search through the JSON endpoints behind www.swissmedicinfo.ch (undocumented,
 * no key), full text from `swissmedicinfo-pro.ch/showText.aspx?textType=FI&lang=DE&authNr=…`
 * (HTML). Neither host sends CORS headers → in browsers this source NEEDS a proxy of your own.
 * Terms of use (refdata.ch/de/nutzungsbestimmungen-aips-sai, §5) allow querying, export, reuse
 * and editing, also for public or commercial purposes; rights remain with Refdata / the
 * marketing authorisation holders. Swiss texts: product names, approved indications and
 * strengths can differ from Germany/Austria.
 */
export function createSwissmedicInfoSource(opts: SwissmedicInfoSourceOptions = {}): RemoteResearchSource {
  const http = createHttpClient({ provider: 'swissmedicinfo', ...API_ACCESS.swissmedicinfo }, opts);
  const analyze = analyzerOf(opts);
  const skipAdmin = opts.skipAdministrativeSections ?? true;

  /** AIPS lists salts as separate substances ("Metamizol-Natrium-Monohydrat"); collect all forms. */
  async function ingredientNames(term: AnalyzedTerm, signal?: AbortSignal): Promise<string[]> {
    const german = [term.raw, term.variants.labels?.['de'], term.variants.articles?.['de']].filter((n): n is string => !!n);
    // "Metamizol-Natrium" → also try "Metamizol"; the list endpoint matches substrings.
    const queries = unique([...german, ...german.map((n) => n.split(/[-\s]/)[0]!)], fold).filter((q) => q.length >= 4);
    for (const q of queries) {
      const data = await http.json<IngredientList>(`${SEARCH_API}/ActiveIngredient?${qs({ entriesToLoad: 25, Wirkstoff: q })}`, { signal });
      const wanted = fold(q);
      const names = (data?.entries ?? []).map((e) => e.text).filter((name) => fold(name).startsWith(wanted));
      if (names.length) return names.slice(0, 4);
    }
    return [];
  }

  async function products(ingredients: string[], signal?: AbortSignal): Promise<Product[]> {
    const lists = await Promise.all(
      ingredients.map((name) =>
        http.json<MedicationList>(`${SEARCH_API}/Medication?${qs({ entriesToLoad: 200, Wirkstoff: name })}`, { signal }),
      ),
    );
    const byAuth = new Map<number, Product>();
    for (const entry of lists.flatMap((l) => l?.entries ?? [])) {
      const authNr = Math.floor(entry.packungsnummer / 1000);
      if (!byAuth.has(authNr)) {
        byAuth.set(authNr, {
          authNr,
          brand: entry.praeparatname.split(/\s+/)[0] ?? entry.praeparatname,
          holder: entry.zulassungsinhaber,
          mono: !entry.wirkstoff.includes(','),
        });
      }
    }
    // Single-substance products first, then the oldest authorisations: those are usually the
    // originator products with the most complete text. One text per brand is enough.
    const sorted = [...byAuth.values()].sort((a, b) => Number(b.mono) - Number(a.mono) || a.authNr - b.authNr);
    return unique(sorted, (p) => fold(p.brand));
  }

  async function fachinformation(authNr: number, signal?: AbortSignal): Promise<{ fi: Fachinformation; url: string } | null> {
    const url = `${TEXT_URL}?${qs({ textType: 'FI', lang: 'DE', authNr })}`;
    const html = await http.text(url, { signal, timeoutMs: 20_000 });
    const fi = html ? parseFachinformation(html) : null;
    return fi ? { fi, url } : null;
  }

  return {
    id: 'swissmedicinfo',
    label: 'Fachinformation Schweiz (AIPS / swissmedicinfo)',
    kind: 'drug-label',
    languages: ['de'],
    locality: 'remote',
    needsProxy: true,
    description:
      'Behördlich genehmigte Schweizer Fachinformationen (Swissmedic, publiziert im AIPS der Stiftung Refdata) auf Deutsch, kapitelweise. Gesendet wird nur der Wirkstoffname. Weiterverwendung laut Refdata-Nutzungsbestimmungen erlaubt; Schweizer Zulassung kann von DE/AT abweichen. Im Browser nur über einen eigenen Proxy (kein CORS).',

    async search(query, callOpts) {
      const signal = callOpts?.signal;
      const analysis = await analyze(query, callOpts);
      const drugs = drugCandidates(analysis);
      const limit = limitOf(callOpts, 2, 4);
      const perDrug = Math.max(1, Math.ceil(limit / Math.max(1, drugs.length)));

      const documents: SourceDocument[] = [];
      for (const drug of drugs) {
        const ingredients = await ingredientNames(drug, signal);
        if (ingredients.length === 0) continue;
        const candidates = await products(ingredients, signal);
        let found = 0;
        // Not every authorisation has a Fachinformation (some only a patient leaflet): try a few.
        for (const product of candidates.slice(0, perDrug + 3)) {
          if (found >= perDrug) break;
          const result = await fachinformation(product.authNr, signal);
          if (!result) continue;
          found++;
          const sections = skipAdmin
            ? result.fi.sections.filter((s) => !ADMINISTRATIVE.test(fold(s.heading ?? '')))
            : result.fi.sections;
          documents.push({
            id: String(product.authNr),
            title: `${result.fi.title} – Fachinformation (CH)`,
            url: result.url,
            source: 'swissmedicinfo',
            publisher: [product.holder, 'AIPS / Refdata, genehmigt durch Swissmedic'].filter(Boolean).join(' – '),
            language: 'de',
            date: result.fi.date,
            passages: rankPassages(sections, analysis, { subject: drug }),
          });
        }
      }
      return documents.slice(0, limit);
    },
  };
}
