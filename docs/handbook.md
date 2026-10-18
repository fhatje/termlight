# Handbook

Everything beyond the quick start in the [README](../README.md): service slots, languages,
backends and development. How to embed the element and change its fonts, colours and size is in
[Embedding and customising](embedding.md).

## Interface of `<med-editor>`

| | |
| --- | --- |
| Properties | `value`, `config`, `readonly`, `compact`, `prefetch`, `placeholder`, `theme` (`light`, `dark`, `auto`), `disclaimer`, `storage-key`; read-only: `registry`, `editorView` |
| Events | `change` (text), `annotations` (recognised terms), `research` (research answer) |
| Methods | `focus()`, `getAnnotations()`, `insertText(text)`, `openResearch(question?, concept?)` |
| Keyboard | `Ctrl/Cmd+I` or `Alt+Enter` opens the card of the term at the caret, `Esc` closes it |

`compact` turns the editor into a plain text field without toolbar and status bar that grows with
its content. If you already have a CodeMirror 6 editor of your own, you can use the highlighting
alone: `medHighlight({ recognizers })` and `medHighlightTheme` from `termlight/editor`.

Types, defaults and details: [Element reference](embedding.md#element-reference).

## Structure: five slots

`config` is a list of services per slot. All services listed appear in the editor's settings
(gear icon), where the user chooses. Each service is marked as **local** (text does not leave the
device) or **remote**.

| Slot | Task | Selection |
| --- | --- | --- |
| `recognizers` | What is highlighted | several at once |
| `lookups` | Content of the term card | several at once |
| `tts` | Read-aloud | one |
| `stt` | Dictation | one |
| `research` | Research bound to sources | one |

Remote recognizers are switched off on first start, because they would send the whole text. Term
cards and research send only the term or the question, never the document.

## Languages

German, English and French are supported. The language of the document is set once and takes
effect in four places:

```ts
const language = 'fr';
editor.config = {
  language,                                                   // interface, research, dictation
  recognizers: [createDictionaryRecognizer({ packs: ['/packs/radiology.fr.json'], language })],
  lookups: [createWikidataLookup({ language })],
};
```

| Building block | What depends on the language |
| --- | --- |
| Dictionaries | one pack per language, e.g. `radiology.fr.json` |
| Language rules in the matcher | inflection (plural, gender), stop words, negation ("kein", "no evidence of", "pas de"), uncertainty ("V.a.", "suspicious for", "suspicion de"), laterality |
| Interface | all texts of the editor and the quick questions of the research panel |
| Dictation | spoken punctuation |

**The same concepts in all languages.** "Milchglastrübung", "ground-glass opacity" and "verre
dépoli" share the id `radiology:ground-glass-opacity`. Evaluations in the embedding application
therefore do not depend on the language of the report.

**English terms in German reports.** There are two ways:

1. Common anglicisms belong to the German pack. In the source file an English term is marked as
   international with `^` (`en: ^Crazy paving`) and then ends up in the German and French packs
   too. This is how "Crazy Paving", "Honeycombing", "Tree-in-bud", "Bone bruise", "Enhancement" or
   "Microbleeds" are recognised in a German report, including German inflection and German
   negation ("kein Honeycombing").
2. For more, load the English pack in addition:
   `packs: ['/packs/seed.de.json', '/packs/radiology.de.json', '/packs/radiology.en.json']`.
   Then "pleural effusion" or "restricted diffusion" are recognised as well. Packs of another
   language are matched under a guard: single words of fewer than five letters are ignored, so
   that "Mass", "Tear" or "Cyst" do not collide with German words.

**Adding a language.** Three steps, without changing the matcher:

```ts
import { registerLanguage } from 'termlight/core';

registerLanguage({
  code: 'it',
  name: 'Italiano',
  stopwords: ['il', 'la', 'di', 'che', /* … */],
  context: { /* triggers for negation, uncertainty, laterality – template: FRENCH_CONTEXT_RULES */ },
  suffixes: [['i', 'o'], ['e', 'a'], /* ending in the text → dictionary form */],
});
```

Add a line `it: …` per concept in `tools/seed/radiology.txt`, and the interface texts following
`src/editor/i18n-fr.ts` (see [Language and interface texts](embedding.md#language-and-interface-texts)).
A language registered at runtime is known on the main thread only; the recognizer needs
`useWorker: false` for it.

## Backends

### Term recognition (`termlight/providers/recognizers`)

| Service | What it does | Data |
| --- | --- | --- |
| `createDictionaryRecognizer({ packs })` | Dictionary matching in a Web Worker; recognises inflected forms, negation ("no …"), uncertainty ("suspicious for", "DD") and laterality | local |
| `createRemoteRecognizer({ endpoint })` | Connects an NER server of your own: `POST { text, language }` → `{ annotations }` | remote |

Dictionaries ("packs") are JSON files:

| Pack | Content | Licence |
| --- | --- | --- |
| `seed.de.json` | Base vocabulary: anatomy, diagnoses, common drugs, modalities, lab (718 concepts) | CC0 |
| `radiology.de.json`, `radiology.en.json`, `radiology.fr.json` | Frequent radiological patterns and descriptors (ground-glass opacity, nodule, restricted diffusion, hypodense …) plus core anatomy and modalities, 196 concepts per language | CC0 |

Both ship with the package (`termlight/packs/*`). A pack can also be passed as an object
(`TermPack`), so dictionaries of your own need no build step.

Adding terms of your own: enter them in `tools/seed/radiology.txt` (multilingual, the format is
described at the top of the file) or `tools/seed/seed.de.txt`, then run `npm run build:seed`.

### Term cards (`termlight/providers/lookup`)

| Service | Source | Language | In the browser |
| --- | --- | --- | --- |
| `createPackLookup({ packs })` | Definitions and codes from the packs | that of the pack | local |
| `createStaticLookup({ source })` | A file built ahead of time on your own server (content from Wikidata and Wikipedia) | de/en/fr | local, no third-party request |
| `createWikidataLookup()` | Wikidata and Wikipedia: description, synonyms, ICD/ATC/MeSH codes | `language` option, default de | direct |
| `createRxNavLookup()` | RxNorm (NLM): ingredient, salt forms, brand names | en | direct |
| `createOpenFdaLookup()` | US prescribing information: indications, contraindications | en | direct |
| `createMeshLookup()` | MeSH descriptors | en | direct |
| `createOlsLookup()` | Ontologies MONDO, HPO, UBERON | en | direct |

No key needed. `defaultLookups()` returns the recommended selection of live services.

Instead of the live services you can use `createStaticLookup`: `npm run build:lookup`
asks Wikidata and Wikipedia once for every concept of the curated dictionaries and writes
`public/lookup/wikidata.<language>.json`. These files then sit on your own server. A visitor's
browser therefore contacts no third party, nothing is stored on their device, and the open
services are not asked again for every visitor. The run is slow (one request every 1.5 seconds,
and it waits when throttled) and can be interrupted and resumed at any time. The Wikipedia
extracts are under CC BY-SA 4.0; every card shows source and licence.

### Research (`termlight/providers/research`)

Research needs a language model. The project brings neither a paid service nor a server; the
research panel appears only when you configure a research provider, for example with Ollama on
your own machine.

**`createGroundedResearch({ llm, sources, resolve })`** searches the given sources, hands the
language model only the passages found and demands a citation `[n]` after every statement.
Verbatim quotes are checked against the source text. If nothing is found, the answer is "not
found" – the model never answers from its own knowledge. Works with any language model, local
ones included.

Sources (`termlight/providers/sources`):

| Source | Content | Language | In the browser |
| --- | --- | --- | --- |
| `createSwissmedicInfoSource()` | Swiss prescribing information (AIPS) | de | through your own proxy only |
| `createOpenFdaLabelSource()` | US prescribing information | en | direct |
| `createEuropePmcSource()` | Literature, reviews preferred | en | direct |
| `createPubMedSource()` | PubMed abstracts | en | direct |
| `createWikipediaSource({ language })` | Wikipedia, not a primary source | de/en | direct |
| `createMedlinePlusSource()` | Patient information of the NLM | en | through your own proxy only |
| `createHttpSource({ endpoint, … })` | A source of your own or a licensed one: `POST { question, concept, language, limit }` → `{ documents }` | any | any |

`defaultSources()` returns Swiss prescribing information, openFDA, Europe PMC and Wikipedia; with
`all: true` PubMed and MedlinePlus in addition. German prescribing information is not freely
available through an interface; metamizole, for example, is not approved in the US and therefore
comes from the Swiss prescribing information. English sources are searched automatically with
the translated ingredient name (`resolveTermVariants`, via Wikidata).

Two sources send no CORS headers and cannot be reached directly from the browser. If you need
them, run a proxy of your own and pass it with `proxy: proxyVia('/my-proxy')`. Such a proxy must
let through exactly these hosts (`PROXY_ALLOWED_HOSTS`) and nothing else, or it becomes an open
door.

Language models (`termlight/providers/llm`):

| Service | For |
| --- | --- |
| `createOpenAiCompatibleLlm({ baseUrl, model, locality })` | OpenAI, Mistral and local models: Ollama (`http://localhost:11434/v1`), LM Studio, vLLM |

Example with a local model, where only the search terms leave the house:

```ts
const llm = createOpenAiCompatibleLlm({
  baseUrl: 'http://localhost:11434/v1', model: 'qwen3.8:27b-mlx', locality: 'local',
});
editor.config = {
  ...editor.config,
  research: [createGroundedResearch({
    llm, sources: defaultSources().filter((s) => !s.needsProxy), resolve: resolveTermVariants,
  })],
};
```

### Speech (`termlight/providers/speech`)

| Service | Direction | Note |
| --- | --- | --- |
| `createWebSpeechTts()` | Read-aloud | Voices of the browser or operating system, no key |
| `createOpenAiCompatibleTts({ baseUrl })` | Read-aloud | OpenAI or a local server with `/audio/speech` (Kokoro-FastAPI, openedai-speech, LocalAI) |
| `createWebSpeechStt()` | Dictation | Chrome sends the recording to Google – unsuitable for patient data |
| `createOpenAiCompatibleStt({ baseUrl })` | Dictation | OpenAI Whisper or a local Whisper server with `/audio/transcriptions` |

Spoken punctuation is converted during dictation, in German ("Punkt", "neue Zeile"), English
("period", "new line") and French ("point", "à la ligne").

## Security

The element needs no backend, no database, no login and no keys. With the dictionaries and the
term-card files on your own server, a page can run under a strict content security policy
(`default-src 'self'`; the element injects its styles at runtime, so `style-src` needs
`'unsafe-inline'`, and the matcher needs `worker-src 'self'`).

- **Foreign text is never inserted as HTML.** Answers of the services end up in the page as plain
  text; links are accepted with `http`/`https` only.
- **No referrer** on clicks on source links.
- What the element stores in the browser by default and how to switch it off:
  [What is stored and sent](embedding.md#what-is-stored-and-sent).

## Using the open interfaces considerately

Applies to the live services (`createWikidataLookup` etc.) when you use them instead of the
files built ahead of time:

- At most one request per second per host (`minIntervalMs`); further ones wait in line.
- Answers stay in the browser for 7 days (Cache Storage, `persistTtlMs`). Terms in reports
  repeat, so requests become rarer over time.
- If a service throttles nevertheless (HTTP 429), the request is repeated up to twice after a
  pause.
- `clearResponseCache()` empties the store.
- With the `prefetch` attribute the editor fetches the term cards in the background: one term
  without a cache entry every two seconds, as long as nobody is typing. After that the cards open
  without waiting and no further requests are made. Note: this sends all recognised terms to the
  services, not only the ones clicked. Off by default.

Both values can be set per service, e.g. `createWikidataLookup({ minIntervalMs: 2000 })`.

## Appearance

The text is set in JetBrains Mono (SIL OFL, part of the module, nothing is fetched from elsewhere).
The highlighting works with typeface, weight, slope and colour only – no backgrounds and no
underlines. Anatomy, findings, diagnoses, symptoms and modifiers stay in the text font and differ
by weight and slope; drugs and substances switch to a sans, procedures and lab values to a serif.
Negated terms are violet, suspected ones lighter and italic.

Everything is adjustable through CSS custom properties on the element:

```css
med-editor {
  --med-font-text: "IBM Plex Mono", monospace;   /* the text */
  --med-font-size: 1rem;
  --med-finding: #0f6b3c;                        /* colour per type: --med-anatomy, --med-disease, … */
  --med-finding-weight: 600;                     /* and its weight, slope, family */
}
```

The full list with defaults, the font requirements and dark mode:
[Fonts](embedding.md#fonts), [Colours](embedding.md#colours).

## Development

```bash
npm run typecheck
npm test                    # unit tests (vitest)
npm run build:lib           # the package: lib/ with JavaScript and type declarations
npm run build:seed          # dictionaries from tools/seed/*.txt
npm run build:lookup        # term-card files from Wikidata and Wikipedia
```

```
src/core        interfaces (types.ts), registry, matcher
src/editor      <med-editor>, CodeMirror extensions, interface
src/providers   recognizers · lookup · sources · llm · research · speech
tools           dictionary and term-card build, package build
public/packs    dictionaries
public/lookup   term-card files
lib             build output of the package (not committed)
```

Connecting a service of your own means implementing the matching interface from
`src/core/types.ts` (`Recognizer`, `ConceptLookup`, `TtsProvider`, `SttProvider`, `LlmProvider`,
`ResearchSource`, `ResearchProvider`) and putting the object into `config`.
