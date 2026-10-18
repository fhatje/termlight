/**
 * Public contract of the module. Every service the editor talks to sits behind one of the
 * interfaces below, so each slot (recognition, concept details, speech, LLM, research) can be
 * filled, swapped or left empty independently.
 *
 * No DOM or Node types in this file: it has to be importable from the browser, a worker and Node.
 */

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

/** `local` = text never leaves the device. `remote` = text is sent to a network service. */
export type Locality = 'local' | 'remote';

export interface ProviderMeta {
  /** Stable, unique within its slot, e.g. `dictionary`, `wikidata`, `webspeech`. */
  readonly id: string;
  /** Human readable name shown in the settings UI. */
  readonly label: string;
  readonly locality: Locality;
  /** One line shown in the settings UI: what it is, where data goes, license. */
  readonly description?: string;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** BCP-47 language of the document / UI, e.g. `de`. */
  language?: string;
}

// ---------------------------------------------------------------------------------------------
// Annotations (what gets highlighted)
// ---------------------------------------------------------------------------------------------

export type ConceptType =
  | 'anatomy'
  | 'disease'
  | 'symptom'
  | 'finding'
  | 'medication'
  | 'substance'
  | 'procedure'
  | 'lab'
  | 'physiology'
  | 'modifier'
  | 'other';

export type Assertion = 'present' | 'negated' | 'uncertain';
export type Laterality = 'left' | 'right' | 'bilateral';

/** Reference into a code system, e.g. `{ system: 'ICD-10-GM', code: 'J18.9' }`. */
export interface CodeRef {
  /** `ICD-10-GM` | `ICD-10` | `ATC` | `RxNorm` | `MeSH` | `Wikidata` | `UBERON` | `MONDO` | ... */
  system: string;
  code: string;
}

export interface Annotation {
  /** UTF-16 offsets into the analysed text, `to` exclusive. */
  from: number;
  to: number;
  /** The matched surface text, `text.slice(from, to)`. */
  text: string;
  /** Globally unique concept id, `${source}:${localId}`, e.g. `wikidata:Q384809`. */
  conceptId: string;
  /** Canonical term of the concept. */
  label: string;
  type: ConceptType;
  /** Id of the recognizer that produced the annotation. */
  source: string;
  codes?: CodeRef[];
  assertion?: Assertion;
  laterality?: Laterality;
  /** 0..1 */
  confidence?: number;
}

/** Decides what is highlighted. Called debounced on every document change. */
export interface Recognizer extends ProviderMeta {
  recognize(text: string, opts?: CallOptions): Promise<Annotation[]>;
  dispose?(): void;
}

// ---------------------------------------------------------------------------------------------
// Terminology packs (static dictionaries a local recognizer matches against)
// ---------------------------------------------------------------------------------------------

export interface PackConcept {
  /** Local id within the pack; the global concept id is `${pack.id}:${id}`. */
  id: string;
  label: string;
  type: ConceptType;
  /** Additional surface forms (synonyms, abbreviations). The label is always matched. */
  terms?: string[];
  codes?: CodeRef[];
  definition?: string;
}

export interface TermPack {
  id: string;
  name: string;
  version: string;
  language: string;
  license: string;
  attribution: string;
  homepage?: string;
  concepts: PackConcept[];
}

// ---------------------------------------------------------------------------------------------
// Concept details (what the hover card shows)
// ---------------------------------------------------------------------------------------------

export interface SourceAttribution {
  name: string;
  url?: string;
  license?: string;
}

export interface ConceptInfo {
  conceptId: string;
  title: string;
  type: ConceptType;
  definition?: string;
  synonyms?: string[];
  codes?: CodeRef[];
  /** Further structured text, e.g. `{ title: 'Kontraindikationen', text: '...' }`. */
  sections?: { title: string; text: string }[];
  links?: { label: string; url: string }[];
  language?: string;
  attribution: SourceAttribution;
}

/** What a lookup needs to know about a concept; an `Annotation` satisfies it. */
export type ConceptRef = Pick<Annotation, 'conceptId' | 'label' | 'type' | 'codes'>;

export interface ConceptLookup extends ProviderMeta {
  /** Cheap, synchronous pre-filter. Omitted = supports everything. */
  supports?(concept: ConceptRef): boolean;
  /** Resolves to `null` when the provider knows nothing about the concept. */
  lookup(concept: ConceptRef, opts?: CallOptions): Promise<ConceptInfo | null>;
}

// ---------------------------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------------------------

export interface Voice {
  id: string;
  label: string;
  language?: string;
}

export interface SpeakOptions extends CallOptions {
  voice?: string;
  /** 1 = normal speed. */
  rate?: number;
  /** Fired while speaking, offsets relative to the spoken text. Not every provider supports it. */
  onBoundary?(charIndex: number, charLength: number): void;
}

export interface SpeechHandle {
  /** Resolves when playback finished or was cancelled, rejects on provider errors. */
  readonly done: Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
}

/** Text → speech (read aloud). */
export interface TtsProvider extends ProviderMeta {
  voices?(opts?: CallOptions): Promise<Voice[]>;
  speak(text: string, opts?: SpeakOptions): SpeechHandle;
}

export interface DictationOptions extends CallOptions {
  /** Preliminary transcript of the running utterance; replaces the previous interim text. */
  onInterim?(text: string): void;
  /** A finished piece of transcript, to be inserted at the cursor. */
  onFinal(text: string): void;
  onError?(error: Error): void;
}

export interface DictationSession {
  /** Stops recording; resolves once all pending `onFinal` callbacks were delivered. */
  stop(): Promise<void>;
}

/** Speech → text (dictation). */
export interface SttProvider extends ProviderMeta {
  start(opts: DictationOptions): Promise<DictationSession>;
}

// ---------------------------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------------------------

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** Streaming callback with text deltas. */
  onToken?(delta: string): void;
}

export interface LlmProvider extends ProviderMeta {
  complete(request: LlmRequest): Promise<{ text: string }>;
}

// ---------------------------------------------------------------------------------------------
// Research (LLM answers bound to sources)
// ---------------------------------------------------------------------------------------------

export interface ResearchQuery {
  /** The question as typed, e.g. `Kontraindikationen für Metamizol`. */
  question: string;
  /** Key entities of the question (e.g. the annotation the user clicked on). */
  concept?: ConceptRef;
  language?: string;
}

export type ResearchSourceKind = 'drug-label' | 'literature' | 'guideline' | 'encyclopedia' | 'web';

export interface SourceDocument {
  /** Unique within the source. */
  id: string;
  title: string;
  url: string;
  /** Id of the `ResearchSource` it came from. */
  source: string;
  publisher?: string;
  language?: string;
  /** ISO date of publication / last revision if known. */
  date?: string;
  passages: { heading?: string; text: string }[];
}

/** A place the research pipeline is allowed to read from. */
export interface ResearchSource extends ProviderMeta {
  readonly kind: ResearchSourceKind;
  /** Languages of the content, e.g. `['en']`. */
  readonly languages: string[];
  search(query: ResearchQuery, opts?: CallOptions & { limit?: number }): Promise<SourceDocument[]>;
}

export interface Citation {
  /** 1-based; referenced in the answer text as `[1]`, `[2]`, ... */
  index: number;
  title: string;
  url: string;
  /** Source id or publisher name. */
  source: string;
  /** Verbatim passage that backs the claim, if the provider can supply it. */
  quote?: string;
  date?: string;
}

export interface ResearchAnswer {
  question: string;
  /** Markdown with `[n]` citation markers. */
  answer: string;
  citations: Citation[];
  /** `false` when nothing usable was found; `answer` then says so instead of guessing. */
  grounded: boolean;
  /** Ids/labels of the sources that were consulted, including those without hits. */
  sourcesSearched: string[];
  /** Id of the `ResearchProvider`. */
  provider: string;
  warnings?: string[];
}

export interface ResearchProgress {
  stage: 'resolving' | 'searching' | 'reading' | 'answering';
  /** Short status line for the UI, e.g. `openFDA: 2 Dokumente`. */
  detail?: string;
  /** Streamed answer text (stage `answering`). */
  delta?: string;
}

export interface ResearchOptions extends CallOptions {
  onProgress?(progress: ResearchProgress): void;
}

export interface ResearchProvider extends ProviderMeta {
  research(query: ResearchQuery, opts?: ResearchOptions): Promise<ResearchAnswer>;
}

// ---------------------------------------------------------------------------------------------
// Editor configuration
// ---------------------------------------------------------------------------------------------

/**
 * Everything is a list: all registered providers are offered in the settings UI and the user
 * picks which ones are active. Recognizers and lookups can be active in parallel (results are
 * merged); for TTS, STT and research exactly one is active at a time.
 */
export interface MedEditorConfig {
  language?: string;
  recognizers?: Recognizer[];
  lookups?: ConceptLookup[];
  tts?: TtsProvider[];
  stt?: SttProvider[];
  research?: ResearchProvider[];
}
