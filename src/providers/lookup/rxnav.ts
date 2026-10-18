import type { CodeRef, ConceptInfo } from '../../core/types.ts';
import { API_ACCESS } from '../shared/access.ts';
import { createHttpClient, qs } from '../shared/http.ts';
import { unique } from '../shared/text.ts';
import { codeOf, isDrugType, languageOf, resolverOf, searchNames } from './common.ts';
import type { LookupOptions, RemoteConceptLookup } from './common.ts';

const REST = 'https://rxnav.nlm.nih.gov/REST';

interface IdGroup {
  idGroup?: { rxnormId?: string[] };
}
interface AllRelated {
  allRelatedGroup?: { conceptGroup?: { tty: string; conceptProperties?: { rxcui: string; name: string }[] }[] };
}
interface ClassList {
  rxclassDrugInfoList?: {
    rxclassDrugInfo?: {
      minConcept?: { rxcui?: string };
      rxclassMinConceptItem?: { classId?: string; className?: string; classType?: string };
      rela?: string;
    }[];
  };
}

/**
 * RxNorm via RxNav (U.S. National Library of Medicine): ingredient, salt forms, US brand names,
 * ATC classes and MED-RT "may treat" / "contraindicated with" relations. English only; German
 * labels are bridged through Wikidata. CORS: yes, no proxy needed. Limit: 20 requests/s per IP.
 */
export function createRxNavLookup(opts: LookupOptions = {}): RemoteConceptLookup {
  const http = createHttpClient({ provider: 'RxNav', ...API_ACCESS.rxnav }, opts);
  const resolve = resolverOf(opts);

  async function rxcuiByName(names: string[], signal?: AbortSignal): Promise<string | undefined> {
    for (const name of names) {
      // search=2: exact match first, then RxNav's normalized string match.
      const data = await http.json<IdGroup>(`${REST}/rxcui.json?${qs({ name, search: 2 })}`, { signal });
      const id = data?.idGroup?.rxnormId?.[0];
      if (id) return id;
    }
    return undefined;
  }

  async function classes(rxcui: string, relaSource: string, relas: string | undefined, signal?: AbortSignal) {
    const data = await http.json<ClassList>(`${REST}/rxclass/class/byRxcui.json?${qs({ rxcui, relaSource, relas })}`, { signal });
    return (data?.rxclassDrugInfoList?.rxclassDrugInfo ?? []).filter((c) => c.minConcept?.rxcui === rxcui);
  }

  return {
    id: 'rxnav',
    label: 'RxNorm (RxNav, NLM)',
    locality: 'remote',
    needsProxy: false,
    description:
      'Wirkstoff, Salzformen, US-Handelsnamen und Wirkstoffklassen (ATC, MED-RT) aus RxNorm der U.S. National Library of Medicine. Englisch; gesendet wird nur der Wirkstoffname. Gemeinfrei (NLM), kein Ersatz für die Fachinformation.',
    supports: isDrugType,

    async lookup(concept, callOpts) {
      if (!isDrugType(concept)) return null;
      const signal = callOpts?.signal;
      let rxcui = codeOf(concept.codes, 'RxNorm');
      if (!rxcui) {
        const variants = await resolve(concept.label, {
          language: languageOf(callOpts, opts.language),
          codes: concept.codes,
          type: concept.type,
          signal,
        });
        rxcui = codeOf(variants.codes, 'RxNorm') ?? (await rxcuiByName(searchNames(concept, variants), signal));
      }
      if (!rxcui) return null;

      const related = await http.json<AllRelated>(`${REST}/rxcui/${encodeURIComponent(rxcui)}/allrelated.json`, { signal });
      const groups = related?.allRelatedGroup?.conceptGroup ?? [];
      const group = (tty: string) => groups.find((g) => g.tty === tty)?.conceptProperties ?? [];
      const ingredients = group('IN');
      if (groups.every((g) => !g.conceptProperties?.length)) return null;
      // A salt (PIN) or product carries no classes itself; they hang on the ingredient.
      const ingredient = ingredients.length === 1 ? ingredients[0]! : undefined;
      const mainId = ingredient?.rxcui ?? rxcui;

      const [atc, medrt] = await Promise.all([
        classes(mainId, 'ATC', undefined, signal),
        classes(mainId, 'MEDRT', 'may_treat CI_with', signal),
      ]);
      const atcClasses = unique(atc.map((c) => c.rxclassMinConceptItem).filter((c) => !!c?.classId), (c) => c!.classId!);
      const named = (rela: string) =>
        unique(medrt.filter((c) => c.rela?.toLowerCase() === rela).map((c) => c.rxclassMinConceptItem?.className ?? '').filter(Boolean));

      const sections: NonNullable<ConceptInfo['sections']> = [];
      const add = (title: string, items: string[], max = 20) => {
        if (items.length) sections.push({ title, text: items.slice(0, max).join(', ') + (items.length > max ? ' …' : '') });
      };
      add('Drug classes (ATC)', atcClasses.map((c) => `${c!.className} (${c!.classId})`));
      add('May treat (MED-RT)', named('may_treat'));
      add('Contraindicated with (MED-RT)', named('ci_with'));
      add('Salt forms', group('PIN').map((c) => c.name));
      add('Dose forms', group('DF').map((c) => c.name));

      const codes: CodeRef[] = [{ system: 'RxNorm', code: mainId }];
      if (mainId !== rxcui) codes.push({ system: 'RxNorm', code: rxcui });
      for (const c of atcClasses) codes.push({ system: 'ATC', code: c!.classId! });

      const url = `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(mainId)}`;
      return {
        conceptId: concept.conceptId,
        title: ingredient?.name ?? (ingredients.map((i) => i.name).join(' / ') || concept.label),
        type: concept.type,
        synonyms: unique(group('BN').map((c) => c.name)).slice(0, 15),
        codes,
        sections,
        links: [{ label: 'RxNav', url }],
        language: 'en',
        attribution: {
          name: 'RxNorm / RxNav, U.S. National Library of Medicine',
          url,
          license: 'Public domain (NLM). NLM is not responsible for this product and does not endorse it.',
        },
      };
    },
  };
}
