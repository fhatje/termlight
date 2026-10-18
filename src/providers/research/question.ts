import type { LlmProvider } from '../../core/types.ts';

export interface Aspect {
  id: string;
  de: string;
  en: string;
  /** Detects the aspect in a question (German or English). */
  pattern: RegExp;
  /** Lower-case stems used to find passages about the aspect, in both languages. */
  terms: string[];
}

// Order matters: the first matching pattern wins ("Kontraindikation" must not end up as "Indikation").
export const ASPECTS: Aspect[] = [
  { id: 'contraindication', de: 'Kontraindikationen', en: 'contraindications', pattern: /kontraindi|gegenanzeig|contraindic|contre-?indic|nicht\s+(?:an|ver)wend|nicht\s+(?:ge|ein)nehmen/i, terms: ['kontraindi', 'gegenanzeig', 'contraindic', 'contre-indic', 'nicht angewendet', 'must not', 'should not be used'] },
  { id: 'interaction', de: 'Wechselwirkungen', en: 'drug interactions', pattern: /wechselwirk|interakt|interaction/i, terms: ['wechselwirk', 'interakt', 'interaction'] },
  { id: 'pregnancy', de: 'Schwangerschaft und Stillzeit', en: 'pregnancy and lactation', pattern: /schwanger|stillzeit|stillen|gravid|pregnan|lactat|breast-?feed|grossesse|allaitement/i, terms: ['grossesse', 'allaitement', 'schwanger', 'stillzeit', 'stillen', 'pregnan', 'lactat', 'breastfeed', 'fertil'] },
  { id: 'dosage', de: 'Dosierung', en: 'dosage and administration', pattern: /dosier|dosis|dosage|\bdos(?:e|ing)\b|posolog/i, terms: ['dosier', 'dosis', 'dosage', 'dosing', 'posolog', 'administration', 'tagesdosis'] },
  { id: 'adverse', de: 'Nebenwirkungen', en: 'adverse reactions', pattern: /nebenwirk|unerwünscht|\buaw\b|adverse|side[ -]effect|effets?\s+(?:indésirable|secondaire)/i, terms: ['effets indésirables', 'nebenwirk', 'unerwünscht', 'adverse', 'side effect', 'undesirable'] },
  { id: 'overdose', de: 'Überdosierung', en: 'overdose', pattern: /überdosi|intoxik|vergiftung|overdos|poisoning/i, terms: ['überdosi', 'intoxik', 'vergiftung', 'overdos'] },
  { id: 'warning', de: 'Warnhinweise', en: 'warnings and precautions', pattern: /warnhinweis|vorsichtsma|warning|precaution/i, terms: ['warnhinweis', 'vorsichtsma', 'warning', 'precaution'] },
  { id: 'renal', de: 'Anwendung bei Niereninsuffizienz', en: 'renal impairment', pattern: /niereninsuff|nierenfunktion|\brenal|dialyse|dialysis/i, terms: ['niereninsuff', 'nierenfunktion', 'renal', 'dialys'] },
  { id: 'hepatic', de: 'Anwendung bei Leberinsuffizienz', en: 'hepatic impairment', pattern: /leberinsuff|leberfunktion|hepati/i, terms: ['leberinsuff', 'leberfunktion', 'hepatic'] },
  { id: 'mechanism', de: 'Wirkmechanismus', en: 'mechanism of action', pattern: /wirkmechanismus|wirkungsweise|wirkweise|mechanism|pharmakodynam/i, terms: ['wirkmechanismus', 'wirkungsweise', 'mechanism of action', 'pharmakodynam', 'pharmacodynam'] },
  { id: 'pharmacokinetics', de: 'Pharmakokinetik', en: 'pharmacokinetics', pattern: /pharma[ck]okinet|halbwertszeit|half-life|bioverfügbar|bioavailab/i, terms: ['pharmakokinet', 'pharmacokinet', 'halbwertszeit', 'half-life', 'bioverfügbar', 'bioavailab'] },
  { id: 'indication', de: 'Anwendungsgebiete', en: 'indications', pattern: /indikation|anwendungsgebiet|indication|wofür|wogegen/i, terms: ['anwendungsgebiet', 'indikation', 'indication', 'indiziert', 'indicated'] },
  { id: 'diagnosis', de: 'Diagnostik', en: 'diagnosis', pattern: /diagnos/i, terms: ['diagnos'] },
  { id: 'therapy', de: 'Therapie', en: 'treatment', pattern: /therapie|thérapie|behandlung|treatment|traitement|therapy/i, terms: ['traitement', 'therapie', 'behandlung', 'treatment', 'therapy'] },
  { id: 'symptoms', de: 'Symptome', en: 'signs and symptoms', pattern: /symptom|klinisches bild|anzeichen/i, terms: ['symptom', 'klinisches bild', 'anzeichen', 'clinical presentation'] },
];

const STOPWORDS = new Set(
  `der die das den dem des ein eine einer eines einem einen und oder mit ohne für fuer von vom zu zum zur bei beim im in an am auf aus über unter nach vor gegen
   was wie wann wo warum welche welcher welches welchen wer sind ist war gibt es man kann können darf dürfen soll sollte muss wird werden hat haben nicht
   the a an of for in on with without and or to is are what which how when does do can should be
   le la les un une du de des et ou avec sans pour chez dans sur en au aux par quel quelle quels quelles est sont que qui lors pendant
   bitte nenne nennen liste erkläre erklären beschreibe sag sage mir uns ich patient patienten patientin anwendung einsatz gabe einnahme`.split(/\s+/),
);

export interface QuestionAnalysis {
  /** Key entities, most important first. May be empty when nothing could be determined. */
  entities: string[];
  aspect?: Aspect;
  /** How the analysis was obtained (for progress/debugging). */
  via: 'concept' | 'heuristic' | 'llm' | 'fallback';
}

export function detectAspect(question: string): Aspect | undefined {
  return ASPECTS.find((a) => a.pattern.test(question));
}

export function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}\-./]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? [];
}

/**
 * Entities = what is left of the question after removing the aspect word and function words;
 * consecutive remaining words form one entity ("akute Pankreatitis"). Returns `null` when the
 * question is not of the simple "<aspect> <entity>" shape and a model should have a look.
 */
export function heuristicEntities(question: string, aspect?: Aspect): string[] | null {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const token of tokenize(question)) {
    const isNoise = STOPWORDS.has(token.toLowerCase()) || (aspect?.pattern.test(token) ?? false);
    if (isNoise) {
      if (current.length) groups.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length) groups.push(current);
  // Anything longer is a real sentence; picking nouns out of it by stop-word removal is guesswork.
  if (tokenize(question).length > 7) return null;
  if (!groups.length || groups.length > 2 || groups.some((g) => g.length > 3)) return null;
  return groups.map((g) => g.join(' '));
}

const EXTRACTION_SYSTEM = `Du zerlegst eine medizinische Frage für eine Literatursuche. Antworte nur mit einem JSON-Objekt in dieser Form:
{"begriffe": ["<Schlüsselbegriff in Grundform>", ...], "aspekt": "<worum es geht, 1–3 Wörter>"}
"begriffe" enthält höchstens drei Einträge: Wirkstoffe, Erkrankungen, Verfahren oder Befunde, nach denen gesucht werden soll – keine Fragewörter. Beantworte die Frage nicht.`;

export async function analyzeQuestion(
  question: string,
  conceptLabel: string | undefined,
  llm: LlmProvider,
  signal?: AbortSignal,
): Promise<QuestionAnalysis> {
  const aspect = detectAspect(question);
  if (conceptLabel?.trim()) return { entities: [conceptLabel.trim()], aspect, via: 'concept' };

  const simple = heuristicEntities(question, aspect);
  if (simple) return { entities: simple, aspect, via: 'heuristic' };

  try {
    const { text } = await llm.complete({
      system: EXTRACTION_SYSTEM,
      messages: [{ role: 'user', content: `Frage: ${question}` }],
      maxTokens: 400,
      signal,
    });
    const json = text.match(/\{[\s\S]*\}/);
    if (json) {
      const parsed = JSON.parse(json[0]) as { begriffe?: unknown; aspekt?: unknown };
      const entities = Array.isArray(parsed.begriffe)
        ? parsed.begriffe.filter((e): e is string => typeof e === 'string' && !!e.trim()).map((e) => e.trim())
        : [];
      if (entities.length) {
        const fromModel = typeof parsed.aspekt === 'string' ? detectAspect(parsed.aspekt) : undefined;
        return { entities: entities.slice(0, 3), aspect: aspect ?? fromModel, via: 'llm' };
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // The extraction is an optimisation; the search still works with the raw question.
  }
  return { entities: [], aspect, via: 'fallback' };
}
