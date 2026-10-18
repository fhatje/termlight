import type { SourceDocument } from '../../core/types.ts';
import { createOpenFdaApi } from '../shared/openfda.ts';
import type { OpenFdaOptions } from '../shared/openfda.ts';
import { fold, unique } from '../shared/text.ts';
import { analyzerOf, drugCandidates, literatureNames, requireBridge } from './common.ts';
import type { RemoteResearchSource, SourceOptions } from './common.ts';
import { limitOf, rankPassages } from './query.ts';

export interface OpenFdaLabelSourceOptions extends SourceOptions, OpenFdaOptions {}

/**
 * US prescribing information (FDA Structured Product Labeling) through openFDA, one document per
 * label with its sections as passages. English. Covers only drugs marketed in the US: there is no
 * label for e.g. metamizole or phenprocoumon – the search then resolves to `[]`.
 * CORS: yes, no proxy needed. Licence: CC0.
 */
export function createOpenFdaLabelSource(opts: OpenFdaLabelSourceOptions = {}): RemoteResearchSource {
  const api = createOpenFdaApi(opts);
  const analyze = analyzerOf(opts);

  return {
    id: 'openfda-label',
    label: 'openFDA – US-Fachinformationen',
    kind: 'drug-label',
    languages: ['en'],
    locality: 'remote',
    needsProxy: false,
    description:
      'Offizielle US-Arzneimittel-Labels (FDA Structured Product Labeling) über openFDA, abschnittsweise. Englisch; nur in den USA vermarktete Arzneimittel (z. B. kein Metamizol, kein Phenprocoumon). Gesendet wird nur der Wirkstoffname. Lizenz CC0.',

    async search(query, callOpts) {
      const analysis = await analyze(query, callOpts);
      requireBridge(analysis, 'openFDA', ['en']);
      const drugs = drugCandidates(analysis);
      const limit = limitOf(callOpts, 2);
      const perDrug = Math.max(1, Math.ceil(limit / Math.max(1, drugs.length)));

      const documents: SourceDocument[] = [];
      for (const drug of drugs) {
        const names = unique([drug.english, ...literatureNames(drug, 3), drug.raw], fold);
        const labels = await api.findLabels(names, perDrug, callOpts?.signal);
        for (const label of labels) {
          documents.push({
            id: label.setId,
            title: `${label.title} – US prescribing information`,
            url: label.url,
            source: 'openfda-label',
            publisher: [label.manufacturer, 'FDA label via openFDA / DailyMed'].filter(Boolean).join(' – '),
            language: 'en',
            date: label.date,
            passages: rankPassages(
              label.sections.map((s) => ({ heading: s.heading, text: s.text })),
              analysis,
              { subject: drug },
            ),
          });
        }
      }
      return unique(documents, (d) => d.id).slice(0, limit);
    },
  };
}
