# Embedding and customising `<med-editor>`

Everything a host application needs: installation, the element's interface, fonts, colours, size,
language and the privacy defaults. The service slots (recognition, term cards, speech, research)
and their backends are described in the [handbook](handbook.md).

- [Install](#install)
- [Minimal setup](#minimal-setup)
- [Element reference](#element-reference)
- [Size and layout](#size-and-layout)
- [Fonts](#fonts)
- [Colours](#colours)
- [Light and dark](#light-and-dark)
- [All CSS custom properties](#all-css-custom-properties)
- [Language and interface texts](#language-and-interface-texts)
- [What is stored and sent](#what-is-stored-and-sent)
- [Content security policy](#content-security-policy)
- [Only the highlighting, in your own CodeMirror](#only-the-highlighting-in-your-own-codemirror)
- [What cannot be changed from outside](#what-cannot-be-changed-from-outside)

## Install

The package is not on npm yet. Install it from the repository or from a tarball:

```bash
npm install git+https://github.com/fhatje/termlight.git
# or: npm pack in a checkout, then npm install ./termlight-0.1.0.tgz
```

Both build the package on the way (`npm run build:lib`, which writes `lib/`). It consists of plain
ES modules with type declarations, one file per source module. CodeMirror and Lit are regular
dependencies and are shared if you already use them.

You need a bundler, for two reasons:

| The package contains | Your bundler must |
| --- | --- |
| `import '@fontsource-variable/jetbrains-mono/wght.css'` | resolve CSS imports from JavaScript |
| `new Worker(new URL('./matcher.worker.js', import.meta.url), { type: 'module' })` | recognise this pattern and emit the worker as its own file |

Vite does both without configuration; webpack 5 and Parcel 2 know the worker pattern as well and
need a CSS loader. TypeScript needs no special options.

The minimal setup below adds about 425 kB of JavaScript (138 kB gzipped) plus the font files to a
Vite build.

## Minimal setup

```html
<med-editor id="report"></med-editor>
```

```ts
import 'termlight';                       // registers <med-editor>
import type { Annotation } from 'termlight';
import { createDictionaryRecognizer, createPackLookup } from 'termlight/providers/recognizers';

const packs = ['/packs/radiology.en.json'];
const editor = document.querySelector('med-editor')!;
editor.config = {
  language: 'en',
  recognizers: [createDictionaryRecognizer({ packs, language: 'en' })],
  lookups: [createPackLookup({ packs })],
};
editor.addEventListener('annotations', (event) => {
  console.log((event as CustomEvent<Annotation[]>).detail);
});
```

**The dictionaries are files your server delivers.** The recognizer fetches them by URL when the
first text arrives. The package exports them as `termlight/packs/<name>`:
`radiology.de.json`, `radiology.en.json`, `radiology.fr.json` and `seed.de.json`. Two ways to get
a URL:

```ts
// Vite: let the bundler copy the file and hand you its URL
import radiology from 'termlight/packs/radiology.en.json?url';
const packs = [radiology];
```

or copy the files from `node_modules/termlight/public/packs/` into your static folder and
write the URL yourself, as above. Relative URLs are resolved against the page. Instead of a URL
you can pass a pack object directly (`packs: [myPack]`, type `TermPack`).

The pre-built term-card files for `createStaticLookup` are exported the same way, as
`termlight/lookup/wikidata.<de|en|fr>.json`.

Entry points:

| Import | Content |
| --- | --- |
| `termlight` | the element, all types, the registry, the CodeMirror building blocks |
| `termlight/core` | types, registry, the matcher and `registerLanguage` |
| `termlight/editor` | the element and the CodeMirror building blocks |
| `termlight/providers/recognizers` | dictionary and remote recognizer, pack lookup |
| `termlight/providers/lookup` | term-card services |
| `termlight/providers/speech` | read-aloud and dictation |
| `termlight/providers/llm`, `…/research`, `…/sources` | research panel |
| `termlight/packs/*`, `termlight/lookup/*` | dictionaries and term-card files (JSON) |

## Element reference

### Attributes and properties

| Property | Attribute | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `value` | `value` | `string` | `''` | The text. Setting it does not fire `change`. |
| `config` | – | `MedEditorConfig` | `undefined` | Language and services, see the handbook. Assigning a new object rebuilds everything; do not mutate the old one. |
| `readonly` | `readonly` | `boolean` | `false` | Text cannot be edited; highlighting and term cards stay. |
| `compact` | `compact` | `boolean` | `false` | A plain text field without toolbar and status bar that grows with its content. |
| `placeholder` | `placeholder` | `string` | text of the interface language | |
| `theme` | `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | `auto` follows `prefers-color-scheme`. |
| `prefetch` | `prefetch` | `boolean` | `false` | Fetches term cards in the background. Sends every recognised term to the active lookup services, not only the ones the reader opens. |
| `disclaimer` | `disclaimer` | `string` | text of the interface language | Shown under every research answer. |
| `storageKey` | `storage-key` | `string` | `'termlight.providers.v1'` | `localStorage` key for the reader's choice of services. `""` turns persistence off. |
| `registry` | – | `Registry` (read-only) | | Add, remove or switch services at runtime: `editor.registry.register('lookups', provider)`, `editor.registry.setActive('tts', id, true)`. |
| `editorView` | – | `EditorView \| undefined` (read-only) | | The CodeMirror view, available after the first render (`await editor.updateComplete`). |

The accessible name of the text area comes from the `aria-label` attribute of the element, read
once when the element first renders.

### Methods

| Method | |
| --- | --- |
| `focus()` | Puts the caret into the text. |
| `getAnnotations(): Annotation[]` | The terms currently recognised. |
| `insertText(text)` | Replaces the selection as one undo step. Does nothing while `readonly`. |
| `openResearch(question?, concept?)` | Opens the research panel. The question is filled in but not sent. |

### Events

All three are `CustomEvent`s that bubble and cross shadow boundaries.

| Event | `detail` | Fired |
| --- | --- | --- |
| `change` | `string` – the new text | on edits by the user, dictation and inserted answers; not when you set `value` |
| `annotations` | `Annotation[]` | after each recognition run whose result differs |
| `research` | `ResearchAnswer` | when a research run has finished |

TypeScript does not know the detail types of these events; cast as in the example above.

The element is not a form control: it has no `name` and does not take part in form submission.
Mirror `value` into a hidden input if you need that.

### Keyboard

| Key | |
| --- | --- |
| `Ctrl/Cmd+I`, `Alt+Enter` | Opens the card of the term at the caret |
| `Esc` | Closes the card or the open menu |

## Size and layout

The element is a block with a fixed height of `28rem` (minimum `12rem`); the text scrolls inside.
Set the size with ordinary CSS:

```css
med-editor { height: 70vh; }          /* or height: 100% inside a sized container */
```

With `compact` the height follows the content. `--med-min-height` sets the smallest height of the
text area (default `3.4rem` in compact mode).

| Property | Default | |
| --- | --- | --- |
| `--med-measure` | `none` | Maximum line length of the text, e.g. `42rem` |
| `--med-content-padding` | `1.5rem clamp(1rem, 4.5%, 3rem) 5rem` | Padding around the text (compact: `0.8rem 1.1rem 0.9rem`) |
| `--med-min-height` | `0` | Minimum height of the text area |
| `--med-radius` | `10px` (compact: `8px`) | Corner radius of the frame |
| `--med-card-max-height` | `min(440px, 80vh)` | Maximum height of the term card |

The outer frame and the text area are exposed as parts for everything else:

```css
med-editor::part(frame) { border: 0; box-shadow: 0 1px 3px rgb(0 0 0 / 0.2); }
med-editor::part(document) { background: #fffdf7; }
```

Below 680 px of own width the element switches to a narrow layout (the research panel covers the
text instead of sitting beside it).

## Fonts

The editor uses four font stacks. Each is one CSS custom property on the element:

| Property | Used for | Default |
| --- | --- | --- |
| `--med-font-text` | The text itself, and the terms of type anatomy, finding, disease, symptom and modifier; term names in card and legend | JetBrains Mono (bundled), then system monospace |
| `--med-font-sans` | Terms of type medication, substance, physiology, other | Avenir Next, Segoe UI, Helvetica Neue, system sans |
| `--med-font-serif` | Terms of type procedure and lab | Charter, Sitka Text, Cambria, Georgia |
| `--med-font-ui` | Toolbar, status bar, menus, term card, research panel | `system-ui` and the usual fallbacks |
| `--med-font-size` | Size of the text | `0.9375rem` |

```css
med-editor {
  --med-font-text: "IBM Plex Mono", ui-monospace, monospace;
  --med-font-sans: "Inter", sans-serif;
  --med-font-serif: "Source Serif 4", serif;
  --med-font-ui: "Inter", system-ui, sans-serif;
  --med-font-size: 1rem;
}
```

Things to know before changing the text font:

- **Load the font yourself, in the page.** The property only names a family. The `@font-face` rules
  must be in the document (a stylesheet of your page or an import in your entry file), not inside
  a component: browsers ignore `@font-face` in shadow DOM.
- **The highlighting needs weights and italics.** Term types differ by weight and slope, not only
  by colour. The text font should have the weights 400, 500 and 700 and a real italic. A font
  without them still works, but the browser fakes bold and italic, and the types become harder to
  tell apart. In that case change the voice of the affected types, see
  [Voice of a term type](#voice-of-a-term-type).
- **It does not have to be monospaced.** A proportional font works. The sans and serif voices are
  set 6 % and 10 % larger than the text to match the wide default monospace; with a proportional
  text font they will look slightly large.
- **JetBrains Mono is bundled regardless.** Importing the module adds its `@font-face` rules to the
  document and the font files to your build. The browser downloads them only if the family is
  actually used, so with your own `--med-font-text` they cost build size but no traffic.
- The line height of the text (1.8) and the sizes of the interface texts (11–15 px) are fixed.

## Colours

### Term types

One property per type sets its ink; the pattern is `--med-<type>`:

| Property | Type | Voice | Light | Dark |
| --- | --- | --- | --- | --- |
| `--med-anatomy` | anatomy | text, regular | `#15528C` | `#7DB9F0` |
| `--med-finding` | finding | text, bold | `#12623A` | `#6CCB93` |
| `--med-disease` | disease | text, bold italic | `#A3152F` | `#F58BA0` |
| `--med-symptom` | symptom | text, italic | `#8F3F00` | `#F0A261` |
| `--med-modifier` | modifier (hypodense, subpleural …) | text, italic | `#43517F` | `#A9B6E0` |
| `--med-medication` | medication | sans, semibold | `#8C1A7A` | `#E891DA` |
| `--med-substance` | substance | sans, regular | `#6A4E00` | `#D9BC55` |
| `--med-physiology` | physiology | sans, italic | `#07634F` | `#5FCDB2` |
| `--med-other` | other | sans, regular | `#4E5763` | `#A5AEB9` |
| `--med-procedure` | procedure | serif, italic | `#075B6C` | `#5CC8DA` |
| `--med-lab` | lab | serif, semibold | `#075B6C` | `#5CC8DA` |
| `--med-negated-ink` | any negated term | text, medium, upright | `#5A2EB0` | `#B9A0F7` |
| `--med-spoken` | background of the word being read aloud | | amber, 38 % | amber, 38 % |

Suspected terms ("suspicious for …") have no property of their own: they take the colour of their
type, lightened, in regular weight and italic.

### Voice of a term type

Family, weight and slope of each type can be overridden with three more properties per type:

| Property | Value | Example |
| --- | --- | --- |
| `--med-<type>-font` | a `font-family` | `--med-medication-font: var(--med-font-text)` |
| `--med-<type>-weight` | a `font-weight` | `--med-finding-weight: 600` |
| `--med-<type>-style` | `normal` or `italic` | `--med-disease-style: normal` |

```css
/* A text font that has no bold and no italic: tell the types apart by colour and family instead */
med-editor {
  --med-finding-weight: 500;
  --med-disease-weight: 500;
  --med-disease-style: normal;
  --med-symptom-style: normal;
  --med-modifier-style: normal;
}
```

The defaults are in the "Voice" column above. Negated terms are always upright, medium weight, in
the text font; suspected terms are always regular and italic. If two types end up with the same
voice, they differ by colour alone, which readers with a colour vision deficiency cannot rely on.

The defaults reach a contrast of at least 7:1 on the light and 4.5:1 on the dark default surface.
If you change colours or surfaces, check the contrast again.

### Surfaces and interface

| Property | Used for | Light | Dark |
| --- | --- | --- | --- |
| `--med-surface` | Background of the text | `#ffffff` | `#171c23` |
| `--med-chrome` | Toolbar and status bar | `#f3f5f8` | `#1e252e` |
| `--med-raised` | Menus, term card, buttons | `#ffffff` | `#232b35` |
| `--med-ink` | Text colour | `#17202b` | `#dde3ea` |
| `--med-muted` | Secondary text | `#556070` | `#9ba6b4` |
| `--med-line` | Borders | `#dde2e9` | `#2d3641` |
| `--med-accent` | Caret, selection, focus ring, primary buttons | `#1b4f8c` | `#8dbbee` |

The label on primary buttons is fixed (white in the light scheme, near-black in the dark one), so
keep `--med-accent` dark in the light scheme and light in the dark one.

## Light and dark

`theme="light"` and `theme="dark"` fix the scheme; `theme="auto"` (default) follows the operating
system. The element reflects the scheme in effect as the attribute `data-scheme="light|dark"`.

A custom property you set applies to **both** schemes. As soon as you override a colour and
support dark mode, give both values:

```css
med-editor                       { --med-surface: #fbfaf7; --med-finding: #0f6b3c; }
med-editor[data-scheme='dark']   { --med-surface: #14181d; --med-finding: #7ad6a0; }
```

If your page has its own colour tokens that already switch, pass them through instead:

```css
med-editor {
  --med-surface: var(--page);
  --med-ink: var(--ink);
  --med-line: var(--line);
}
```

and keep the element's scheme in step with your page: `editor.theme = pageIsDark ? 'dark' : 'light'`.

## All CSS custom properties

Fonts: `--med-font-text`, `--med-font-sans`, `--med-font-serif`, `--med-font-ui`, `--med-font-size`<br>
Term colours: `--med-anatomy`, `--med-finding`, `--med-disease`, `--med-symptom`, `--med-modifier`,
`--med-medication`, `--med-substance`, `--med-physiology`, `--med-other`, `--med-procedure`,
`--med-lab`, `--med-negated-ink`, `--med-spoken`<br>
Term voices: `--med-<type>-font`, `--med-<type>-weight`, `--med-<type>-style` for each of the eleven types<br>
Interface colours: `--med-surface`, `--med-chrome`, `--med-raised`, `--med-ink`, `--med-muted`,
`--med-line`, `--med-accent`<br>
Layout: `--med-radius`, `--med-measure`, `--med-content-padding`, `--med-min-height`,
`--med-card-max-height`<br>
Parts: `::part(frame)`, `::part(document)`

Properties starting with `--_` are internal and may change.

## Language and interface texts

`config.language` (`'de'`, `'en'`, `'fr'`; region subtags are ignored) sets the interface texts,
the dictation rules and the language of research answers. **Without it, and for any other
language, the interface is German.** Pass the same language to the recognizer; see the handbook
for what else depends on it.

To change single texts or add an interface language, edit the exported table before you assign
`config`:

```ts
import { i18n } from 'termlight';

i18n.en = { ...i18n.en, placeholder: 'Type or dictate the report …', legend: 'Key' };
i18n.it = { ...i18n.en, readAloud: 'Leggi', dictate: 'Detta' /* … */ };
```

`Strings` is the type of one language; `src/editor/i18n-en.ts` in the repository is the template. The table is
shared by all editors on the page. The question suggestions of the research panel are not part of
it and fall back to German for a language other than `de`, `en`, `fr`.

## What is stored and sent

| What | Where | Turn off |
| --- | --- | --- |
| The reader's choice of services in the settings menu | `localStorage`, key `termlight.providers.v1`, shared by all editors of the origin | `storage-key=""`, or give each editor its own key |
| Answers of the live lookup services (`createWikidataLookup` etc.) | browser Cache Storage, 7 days | `persistTtlMs: 0` on the service; `clearResponseCache()` empties it |
| The text | nowhere; the element keeps it in memory only | |

The text leaves the device only through a service marked `remote` that you configured: a remote
recognizer sends the whole text (and is therefore off until the reader switches it on), lookups
send one term, research sends the question and the term. With `createDictionaryRecognizer`,
`createPackLookup` and `createStaticLookup` nothing is sent anywhere but to your own server.

## Content security policy

The element needs:

```
style-src 'self' 'unsafe-inline';   /* CodeMirror and the component inject their styles at runtime */
worker-src 'self';                  /* the dictionary matcher runs in a Web Worker */
font-src 'self' data:;              /* the bundled font; small subsets may be inlined by the bundler */
connect-src 'self';                 /* plus the hosts of every remote service you configure */
```

Where workers are not allowed, pass `useWorker: false` to `createDictionaryRecognizer`; matching
then runs on the main thread.

## Only the highlighting, in your own CodeMirror

```ts
import { medHighlight, medHighlightTheme, getAnnotations } from 'termlight/editor';

new EditorView({
  parent,
  extensions: [
    medHighlight({ recognizers: [recognizer], language: 'en', onAnnotations: (list) => { /* … */ } }),
    medHighlightTheme,
  ],
});
```

`medHighlightTheme` reads the same `--med-<type>` (with `-font`, `-weight`, `-style`), `--med-font-sans`, `--med-font-serif`,
`--med-negated-ink` and `--med-spoken` properties; the text font is whatever your editor uses.
Light or dark follows CodeMirror's own `EditorView.darkTheme` facet. Note that the import still
registers `<med-editor>` and bundles JetBrains Mono.

## What cannot be changed from outside

Stated plainly, so nobody has to search for a switch that is not there:

- The size of the sans and serif voices relative to the text (106 % and 110 %), and the look of
  negated and suspected terms beyond `--med-negated-ink`.
- The set of term types. A recognizer of your own must map onto the eleven `ConceptType`s.
- Line height of the text and the font sizes of toolbar, menus and card.
- The colours for warnings, errors and the recording indicator.
- Which toolbar buttons exist. A button appears when a service for it is configured: leave out
  `tts`, `stt` or `research` and the control is gone; `compact` removes toolbar and status bar
  altogether.
- Starting read-aloud or dictation from your own code, and hiding term types programmatically.
  Both are reachable only through the editor's own controls.
