import type { Assertion, ConceptType, Laterality, ResearchProgress } from '../core/types.ts';
import type { Slot } from '../core/registry.ts';
import { en } from './i18n-en.ts';
import { fr } from './i18n-fr.ts';

const de = {
  editorLabel: 'Befundtext',
  placeholder: 'Befund schreiben oder diktieren …',
  toolbarLabel: 'Werkzeuge',

  conceptType: {
    anatomy: 'Anatomie',
    disease: 'Erkrankung',
    symptom: 'Symptom',
    finding: 'Befund',
    medication: 'Medikament',
    substance: 'Substanz',
    procedure: 'Prozedur',
    lab: 'Labor',
    physiology: 'Physiologie',
    modifier: 'Attribut',
    other: 'Sonstiges',
  } satisfies Record<ConceptType, string>,
  assertion: {
    present: 'vorhanden',
    negated: 'verneint',
    uncertain: 'unsicher',
  } satisfies Record<Assertion, string>,
  assertionLong: {
    present: 'Im Text als vorhanden beschrieben',
    negated: 'Im Text verneint oder ausgeschlossen',
    uncertain: 'Im Text als Verdacht oder unsicher beschrieben',
  } satisfies Record<Assertion, string>,
  laterality: {
    left: 'links',
    right: 'rechts',
    bilateral: 'beidseits',
  } satisfies Record<Laterality, string>,
  /** Tiny superscript marker next to a term. */
  lateralityMark: {
    left: 'li',
    right: 're',
    bilateral: 'bds',
  } satisfies Record<Laterality, string>,

  // Toolbar
  readAloud: 'Vorlesen',
  readAloudHint: 'Liest die Auswahl vor, sonst den Text ab der Schreibmarke',
  pause: 'Pause',
  resume: 'Fortsetzen',
  stop: 'Stopp',
  speechOptions: 'Stimme und Tempo',
  voice: 'Stimme',
  voiceDefault: 'Standardstimme',
  rate: 'Tempo',
  dictate: 'Diktieren',
  dictateStop: 'Diktat beenden',
  dictating: 'Aufnahme läuft',
  research: 'Recherche',
  legend: 'Legende',
  settings: 'Einstellungen',
  close: 'Schließen',

  // Speech feedback
  nothingToRead: 'Kein Text zum Vorlesen.',
  ttsFailed: (reason: string) => `Vorlesen fehlgeschlagen: ${reason}`,
  sttFailed: (reason: string) => `Diktat fehlgeschlagen: ${reason}`,
  micDenied: 'Kein Zugriff auf das Mikrofon. Bitte in den Browser-Einstellungen für diese Seite erlauben.',
  micMissing: 'Kein Mikrofon gefunden.',
  dictationStarted: 'Diktat gestartet',
  dictationStopped: 'Diktat beendet',

  // Legend
  legendTitle: 'Hervorhebungen',
  legendIntro: 'Anklicken blendet eine Kategorie aus oder ein.',
  legendAssertions: 'Aussage im Text',
  legendLaterality: 'Seitenangabe',
  legendLateralityText: 'Steht in der Begriffsinfo',
  legendSample: 'Begriff',
  showType: (type: string) => `${type} hervorheben`,
  shortcutCard: 'öffnet die Begriffsinfo an der Schreibmarke',

  // Status bar
  statusLabel: 'Status',
  noTerms: 'Keine Begriffe erkannt',
  noRecognizer: 'Erkennung aus',
  termsCount: (n: number) => (n === 1 ? '1 Begriff' : `${n} Begriffe`),
  latency: (ms: number) => `${ms < 10 ? ms.toFixed(1).replace('.', ',') : Math.round(ms)} ms`,
  latencyTitle: 'Dauer der letzten Erkennung',
  recognizing: 'Erkennung läuft',
  localOnly: 'lokal',
  localOnlyTitle: 'Die Erkennung läuft auf diesem Gerät. Der Text wird nicht übertragen.',
  remoteActive: 'extern aktiv',
  remoteActiveTitle: (names: string) => `Der gesamte Text wird zur Erkennung an ${names} gesendet.`,
  recognizerFailed: (name: string) => `${name}: Erkennung fehlgeschlagen`,
  termAtCursor: (label: string, type: string) => `${label} (${type})`,

  // Concept card
  cardLabel: (term: string) => `Begriffsinfo: ${term}`,
  codes: 'Codes',
  synonyms: 'Synonyme',
  source: 'Quelle',
  license: 'Lizenz',
  loadingFrom: (name: string) => `${name} wird abgefragt …`,
  lookupFailed: (name: string) => `${name} ist nicht erreichbar.`,
  retry: 'Erneut versuchen',
  noDetails: 'Keine weiteren Angaben in den aktiven Quellen.',
  noLookups: 'Keine Nachschlagequelle aktiv.',
  researchThis: 'Recherchieren',
  openExternal: 'öffnet in neuem Tab',
  matchedAs: (text: string) => `im Text: „${text}“`,

  // Research
  researchTitle: 'Recherche',
  researchEmpty: 'Frage stellen oder einen markierten Begriff recherchieren. Die Antwort nennt ihre Quellen.',
  researchNoProvider: 'Kein Recherche-Dienst eingerichtet.',
  question: 'Frage',
  questionPlaceholder: 'z. B. Kontraindikationen von Metamizol',
  ask: 'Fragen',
  cancel: 'Abbrechen',
  cancelled: 'Abgebrochen.',
  context: 'Bezug',
  removeContext: 'Bezug entfernen',
  selectionContext: 'Auswahl',
  provider: 'Dienst',
  stage: {
    resolving: 'Begriff klären',
    searching: 'Quellen durchsuchen',
    reading: 'Quellen lesen',
    answering: 'Antwort formulieren',
  } satisfies Record<ResearchProgress['stage'], string>,
  researchFailed: (reason: string) => `Recherche fehlgeschlagen: ${reason}`,
  ungroundedTitle: 'Keine belastbare Quelle gefunden',
  ungroundedText: 'Diese Antwort ist nicht durch Quellen belegt und lässt sich nicht einfügen.',
  citations: 'Belege',
  citationN: (n: number) => `Beleg ${n} anzeigen`,
  openSource: 'Quelle öffnen',
  sourcesSearched: 'Durchsuchte Quellen',
  warnings: 'Hinweise',
  insert: 'Einfügen',
  inserted: 'Antwort eingefügt',
  copy: 'Kopieren',
  copied: 'Kopiert',
  copyFailed: 'Kopieren nicht möglich',
  history: 'Verlauf',
  newQuestion: 'Neue Frage',
  sourcesHeading: 'Quellen',
  disclaimer:
    'Entscheidungsunterstützung – ersetzt nicht die Fachinformation und nicht die klinische Beurteilung.',

  // Settings
  settingsTitle: 'Dienste',
  slot: {
    recognizers: 'Begriffserkennung',
    lookups: 'Begriffsinfo',
    research: 'Recherche',
    tts: 'Vorlesen',
    stt: 'Diktieren',
  } satisfies Record<Slot, string>,
  slotHint: {
    recognizers: 'Bestimmt, was hervorgehoben wird. Liest den gesamten Text.',
    lookups: 'Liefert Erläuterungen zu einem Begriff.',
    research: 'Beantwortet Fragen mit Quellenangaben.',
    tts: 'Liest Text vor.',
    stt: 'Wandelt Sprache in Text um.',
  } satisfies Record<Slot, string>,
  slotEmpty: 'Kein Dienst eingerichtet.',
  none: 'Aus',
  badgeLocal: 'lokal – Text verlässt das Gerät nicht',
  badgeRemote: {
    recognizers: (name: string) => `extern – sendet den gesamten Text an ${name}`,
    lookups: (name: string) => `extern – sendet den Begriff an ${name}`,
    research: (name: string) => `extern – sendet Frage und Begriff an ${name}`,
    tts: (name: string) => `extern – sendet den vorzulesenden Text an ${name}`,
    stt: (name: string) => `extern – sendet die Tonaufnahme an ${name}`,
  } satisfies Record<Slot, (name: string) => string>,
};

export type Strings = typeof de;

/** Add further languages here; unknown languages fall back to German. */
export const i18n: Record<string, Strings> = { de, en, fr };

export function strings(language?: string): Strings {
  const key = (language ?? 'de').toLowerCase().split('-')[0] ?? 'de';
  return i18n[key] ?? de;
}

/** Question templates behind the quick chips of the research panel. */
export interface QuickChip {
  label: string;
  question(term: string): string;
}

/** `[chip label, question with {t} for the term]` */
type ChipSpec = [label: string, question: string];

interface ChipPhrases {
  drug: ChipSpec[];
  disease: ChipSpec[];
  differential: ChipSpec[];
  procedure: ChipSpec[];
  lab: ChipSpec[];
  anatomy: ChipSpec[];
  definition: ChipSpec[];
}

const CHIP_PHRASES: Record<string, ChipPhrases> = {
  de: {
    drug: [
      ['Kontraindikationen', 'Kontraindikationen von {t}'],
      ['Dosierung', 'Dosierung von {t}'],
      ['Wechselwirkungen', 'Wechselwirkungen von {t}'],
      ['Nebenwirkungen', 'Nebenwirkungen von {t}'],
      ['Schwangerschaft/Stillzeit', '{t} in Schwangerschaft und Stillzeit'],
    ],
    disease: [
      ['Diagnostik', 'Diagnostik bei {t}'],
      ['Therapie', 'Therapie bei {t}'],
      ['Differentialdiagnosen', 'Differentialdiagnosen bei {t}'],
      ['Bildgebung', 'Bildgebende Zeichen bei {t}'],
      ['Leitlinie', 'Aktuelle Leitlinienempfehlungen zu {t}'],
    ],
    differential: [
      ['Differentialdiagnosen', 'Differentialdiagnosen bei {t}'],
      ['Abklärung', 'Weitere Abklärung bei {t}'],
      ['Ursachen', 'Häufige Ursachen für {t}'],
    ],
    procedure: [
      ['Indikationen', 'Indikationen für {t}'],
      ['Kontraindikationen', 'Kontraindikationen für {t}'],
      ['Komplikationen', 'Komplikationen bei {t}'],
    ],
    lab: [
      ['Referenzbereich', 'Referenzbereich für {t}'],
      ['Erhöht bei', 'Ursachen für erhöhte Werte von {t}'],
      ['Erniedrigt bei', 'Ursachen für erniedrigte Werte von {t}'],
    ],
    anatomy: [
      ['Anatomie', 'Anatomie: {t}'],
      ['Normvarianten', 'Normvarianten: {t}'],
      ['Häufige Pathologien', 'Häufige Pathologien: {t}'],
    ],
    definition: [['Definition', 'Was ist {t}?']],
  },
  en: {
    drug: [
      ['Contraindications', 'Contraindications of {t}'],
      ['Dosage', 'Dosage of {t}'],
      ['Interactions', 'Drug interactions of {t}'],
      ['Adverse effects', 'Adverse effects of {t}'],
      ['Pregnancy/lactation', '{t} in pregnancy and lactation'],
    ],
    disease: [
      ['Work-up', 'Diagnostic work-up of {t}'],
      ['Treatment', 'Treatment of {t}'],
      ['Differential diagnosis', 'Differential diagnosis of {t}'],
      ['Imaging', 'Imaging findings in {t}'],
      ['Guideline', 'Current guideline recommendations on {t}'],
    ],
    differential: [
      ['Differential diagnosis', 'Differential diagnosis of {t}'],
      ['Work-up', 'Further work-up of {t}'],
      ['Causes', 'Common causes of {t}'],
    ],
    procedure: [
      ['Indications', 'Indications for {t}'],
      ['Contraindications', 'Contraindications to {t}'],
      ['Complications', 'Complications of {t}'],
    ],
    lab: [
      ['Reference range', 'Reference range of {t}'],
      ['Raised in', 'Causes of raised {t}'],
      ['Lowered in', 'Causes of low {t}'],
    ],
    anatomy: [
      ['Anatomy', 'Anatomy: {t}'],
      ['Normal variants', 'Normal variants: {t}'],
      ['Common pathology', 'Common pathology: {t}'],
    ],
    definition: [['Definition', 'What is {t}?']],
  },
  fr: {
    drug: [
      ['Contre-indications', 'Contre-indications : {t}'],
      ['Posologie', 'Posologie : {t}'],
      ['Interactions', 'Interactions médicamenteuses : {t}'],
      ['Effets indésirables', 'Effets indésirables : {t}'],
      ['Grossesse/allaitement', '{t} pendant la grossesse et l’allaitement'],
    ],
    disease: [
      ['Diagnostic', 'Démarche diagnostique : {t}'],
      ['Traitement', 'Traitement : {t}'],
      ['Diagnostics différentiels', 'Diagnostics différentiels : {t}'],
      ['Imagerie', 'Signes en imagerie : {t}'],
      ['Recommandations', 'Recommandations actuelles : {t}'],
    ],
    differential: [
      ['Diagnostics différentiels', 'Diagnostics différentiels : {t}'],
      ['Bilan', 'Bilan complémentaire : {t}'],
      ['Causes', 'Causes fréquentes : {t}'],
    ],
    procedure: [
      ['Indications', 'Indications : {t}'],
      ['Contre-indications', 'Contre-indications : {t}'],
      ['Complications', 'Complications : {t}'],
    ],
    lab: [
      ['Valeurs de référence', 'Valeurs de référence : {t}'],
      ['Augmenté dans', 'Causes d’une augmentation : {t}'],
      ['Diminué dans', 'Causes d’une diminution : {t}'],
    ],
    anatomy: [
      ['Anatomie', 'Anatomie : {t}'],
      ['Variantes de la normale', 'Variantes de la normale : {t}'],
      ['Pathologies fréquentes', 'Pathologies fréquentes : {t}'],
    ],
    definition: [['Définition', 'Qu’est-ce que {t} ?']],
  },
};

const chips = (specs: ChipSpec[]): QuickChip[] =>
  specs.map(([label, question]) => ({ label, question: (term: string) => question.replace('{t}', term) }));

export function quickChips(type: ConceptType, language?: string): QuickChip[] {
  const key = (language ?? 'de').toLowerCase().split('-')[0] ?? 'de';
  const phrases = CHIP_PHRASES[key] ?? (CHIP_PHRASES.de as ChipPhrases);
  switch (type) {
    case 'medication':
    case 'substance':
      return chips(phrases.drug);
    case 'disease':
      return chips(phrases.disease);
    case 'symptom':
    case 'finding':
      return chips(phrases.differential);
    case 'procedure':
      return chips(phrases.procedure);
    case 'lab':
      return chips(phrases.lab);
    case 'anatomy':
      return chips(phrases.anatomy);
    default:
      return chips(phrases.definition);
  }
}
