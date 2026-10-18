import { css, unsafeCSS } from 'lit';
import { FONT_TEXT, FONT_UI, termRules } from '../theme.ts';

function toCss(rules: Record<string, Record<string, string | number>>): string {
  return Object.entries(rules)
    .map(([selector, body]) => {
      const declarations = Object.entries(body)
        .map(([prop, value]) => `${prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^webkit-/, '-webkit-')}: ${value};`)
        .join(' ');
      return `${selector} { ${declarations} }`;
    })
    .join('\n');
}

// The same rules that style the marks inside CodeMirror, for the samples in the chrome.
const sampleRules = unsafeCSS(
  toCss(termRules(':host(:not([data-scheme="dark"])) .chrome', 'light')) +
    '\n' +
    toCss(termRules(':host([data-scheme="dark"]) .chrome', 'dark')),
);

export const styles = css`
  :host {
    --_font-text: var(--med-font-text, ${unsafeCSS(FONT_TEXT)});
    --_font-ui: var(--med-font-ui, ${unsafeCSS(FONT_UI)});
    --_radius: var(--med-radius, 10px);

    --_surface: var(--med-surface, #ffffff);
    --_chrome: var(--med-chrome, #f3f5f8);
    --_raised: var(--med-raised, #ffffff);
    --_ink: var(--med-ink, #17202b);
    --_muted: var(--med-muted, #556070);
    --_faint: #8791a0;
    --_line: var(--med-line, #dde2e9);
    --_line-strong: #c3cad4;
    --_accent: var(--med-accent, #1b4f8c);
    --_accent-ink: #ffffff;
    --_accent-soft: color-mix(in srgb, var(--_accent) 11%, var(--_surface));
    --_selection: color-mix(in srgb, var(--_accent) 22%, var(--_surface));
    --_warn: #8a5200;
    --_warn-soft: #fdf3dc;
    --_warn-line: #e6c987;
    --_danger: #b4233c;
    --_danger-soft: #fdecef;
    --_rec: #c8102e;
    --_shadow: 0 1px 2px rgb(20 30 45 / 0.08), 0 12px 32px -8px rgb(20 30 45 / 0.22);

    display: block;
    /* The status bar and long words must never widen the embedding layout. */
    contain: inline-size;
    height: 28rem;
    min-height: 12rem;
    color: var(--_ink);
    font-family: var(--_font-ui);
    font-size: 13px;
    line-height: 1.45;
    color-scheme: light;
    -webkit-text-size-adjust: 100%;
  }
  :host([compact]) {
    height: auto;
    min-height: 0;
    --med-content-padding: 0.8rem 1.1rem 0.9rem;
    --med-measure: none;
  }
  :host([compact]) .frame {
    height: auto;
  }
  :host([compact]) .cm-host {
    height: auto;
    min-height: var(--med-min-height, 3.4rem);
  }
  /* The compact field behaves like an ordinary web text box: one border, a focus ring. */
  :host([compact]) .frame {
    border-radius: var(--med-radius, 8px);
  }
  :host([compact]) .frame:focus-within {
    border-color: var(--_accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--_accent) 22%, transparent);
  }
  .mic {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid var(--_line);
    border-radius: 50%;
    background: var(--_raised);
    color: var(--_muted);
    cursor: pointer;
  }
  .mic:hover {
    color: var(--_ink);
    border-color: var(--_line-strong);
  }
  .mic.recording {
    border-color: color-mix(in srgb, var(--_rec) 55%, transparent);
    background: color-mix(in srgb, var(--_rec) 12%, var(--_raised));
  }
  @media (prefers-reduced-motion: no-preference) {
    :host([compact]) .frame {
      transition: border-color 0.12s, box-shadow 0.12s;
    }
  }
  :host([data-scheme='dark']) {
    --_surface: var(--med-surface, #171c23);
    --_chrome: var(--med-chrome, #1e252e);
    --_raised: var(--med-raised, #232b35);
    --_ink: var(--med-ink, #dde3ea);
    --_muted: var(--med-muted, #9ba6b4);
    --_faint: #6f7b8a;
    --_line: var(--med-line, #2d3641);
    --_line-strong: #414c5a;
    --_accent: var(--med-accent, #8dbbee);
    --_accent-ink: #0f1822;
    --_accent-soft: color-mix(in srgb, var(--_accent) 16%, var(--_surface));
    --_selection: color-mix(in srgb, var(--_accent) 30%, var(--_surface));
    --_warn: #e9b860;
    --_warn-soft: #33290f;
    --_warn-line: #6b5420;
    --_danger: #f58ba0;
    --_danger-soft: #3a1c23;
    --_rec: #ff5a6e;
    --_shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 14px 36px -8px rgb(0 0 0 / 0.6);
    color-scheme: dark;
  }
  :host([hidden]) {
    display: none;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  ${sampleRules}

  .frame {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--_surface);
    border: 1px solid var(--_line);
    border-radius: var(--_radius);
  }
  .frame:focus-within {
    border-color: var(--_line-strong);
  }

  /* ---------- controls ---------- */
  button,
  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--_ink);
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
  }
  .btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--_ink) 8%, transparent);
  }
  .btn:active:not(:disabled) {
    background: color-mix(in srgb, var(--_ink) 13%, transparent);
  }
  .btn:disabled {
    color: var(--_faint);
    cursor: default;
  }
  .btn[aria-pressed='true'],
  .btn[aria-expanded='true'] {
    background: var(--_accent-soft);
    color: var(--_accent);
  }
  .btn.icon-only {
    width: 30px;
    padding: 0;
    justify-content: center;
  }
  .btn.outline {
    border-color: var(--_line-strong);
    background: var(--_raised);
  }
  .btn.primary {
    background: var(--_accent);
    color: var(--_accent-ink);
    font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--_accent) 88%, var(--_ink));
  }
  .btn.primary:disabled {
    background: color-mix(in srgb, var(--_ink) 12%, transparent);
    color: var(--_faint);
  }
  :is(button, input, select, textarea, a, [tabindex]):focus-visible {
    outline: 2px solid var(--_accent);
    outline-offset: 1px;
  }
  .icon {
    flex: none;
  }
  a {
    color: var(--_accent);
    text-underline-offset: 0.18em;
  }

  /* ---------- toolbar ---------- */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    background: var(--_chrome);
    border-bottom: 1px solid var(--_line);
    border-radius: calc(var(--_radius) - 1px) calc(var(--_radius) - 1px) 0 0;
  }
  .toolbar .spacer {
    flex: 1;
  }
  .toolbar .group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .toolbar .sep {
    width: 1px;
    height: 18px;
    margin: 0 6px;
    background: var(--_line-strong);
  }
  .btn.recording {
    background: color-mix(in srgb, var(--_rec) 12%, transparent);
    color: var(--_rec);
    font-weight: 600;
  }
  .rec-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--_rec);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  .narrow .toolbar .label,
  .narrow .status .label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .narrow .toolbar .btn {
    min-width: 34px;
    justify-content: center;
  }

  /* ---------- body ---------- */
  .body {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .doc {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .cm-host {
    height: 100%;
  }

  /* ---------- status bar ---------- */
  .status {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 30px;
    padding: 2px 8px 2px 4px;
    background: var(--_chrome);
    border-top: 1px solid var(--_line);
    border-radius: 0 0 calc(var(--_radius) - 1px) calc(var(--_radius) - 1px);
    font-size: 12px;
    color: var(--_muted);
  }
  .status .btn {
    height: 24px;
    padding: 0 7px;
    font-size: 12px;
    color: var(--_muted);
  }
  .counts {
    display: flex;
    align-items: center;
    gap: 0;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
  }
  .counts::-webkit-scrollbar {
    display: none;
  }
  .count {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    height: 24px;
    padding: 0 7px;
    border: 0;
    border-radius: 5px;
    background: none;
    cursor: pointer;
    white-space: nowrap;
    font-size: 12px;
    line-height: 24px;
    color: var(--_muted);
  }
  .count:hover {
    background: color-mix(in srgb, var(--_ink) 8%, transparent);
  }
  .count .n {
    font-variant-numeric: tabular-nums;
  }
  .count[aria-pressed='false'] .med-term {
    color: var(--_faint);
    text-decoration-color: transparent;
    background-image: none;
  }
  .count[aria-pressed='false'] {
    color: var(--_faint);
  }
  .status .meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    white-space: nowrap;
  }
  .status .cursor-term {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 22ch;
  }
  .privacy {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .privacy.remote {
    color: var(--_warn);
    font-weight: 600;
  }
  .latency {
    font-variant-numeric: tabular-nums;
    min-width: 5ch;
    text-align: right;
  }
  .narrow .status .cursor-term,
  .narrow .status .latency {
    display: none;
  }
  kbd {
    font: inherit;
    font-size: 11px;
    padding: 1px 4px;
    border: 1px solid var(--_line-strong);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--_raised);
    color: var(--_muted);
  }

  /* ---------- popovers ---------- */
  .popover {
    position: absolute;
    z-index: 30;
    width: min(380px, calc(100% - 16px));
    max-height: min(520px, calc(100% - 60px));
    overflow: auto;
    padding: 14px;
    background: var(--_raised);
    border: 1px solid var(--_line-strong);
    border-radius: 10px;
    box-shadow: var(--_shadow);
    overscroll-behavior: contain;
  }
  .popover.settings {
    top: 46px;
    right: 8px;
    width: min(420px, calc(100% - 16px));
  }
  .popover.speech {
    top: 46px;
    left: 8px;
    width: min(280px, calc(100% - 16px));
  }
  .popover.legend {
    bottom: 34px;
    left: 8px;
    width: min(400px, calc(100% - 16px));
  }
  .popover h2 {
    margin: 0 0 2px;
    font-size: 14px;
    font-weight: 650;
  }
  .popover h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 650;
  }
  .popover .hint {
    margin: 0;
    color: var(--_muted);
    font-size: 12px;
  }
  .pop-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -4px -6px 6px 0;
  }

  /* settings */
  .slot {
    min-width: 0;
    margin: 12px 0 0;
    padding: 12px 0 2px;
    border: 0;
    border-top: 1px solid var(--_line);
  }
  .slot:first-of-type {
    border-top: 0;
    margin-top: 0;
    padding-top: 4px;
  }
  .provider {
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 2px 8px;
    align-items: start;
    padding: 8px 8px;
    margin: 6px -8px 0;
    border-radius: 7px;
    cursor: pointer;
  }
  .provider:hover {
    background: color-mix(in srgb, var(--_ink) 5%, transparent);
  }
  .provider input {
    margin: 2px 0 0;
    width: 15px;
    height: 15px;
    accent-color: var(--_accent);
  }
  .provider .name {
    font-weight: 600;
  }
  .provider .desc {
    grid-column: 2;
    color: var(--_muted);
    font-size: 12px;
  }
  .badge {
    grid-column: 2;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    justify-self: start;
    margin-top: 3px;
    font-size: 12px;
    color: var(--_muted);
  }
  .badge.remote {
    color: var(--_warn);
  }
  .badge .icon {
    width: 13px;
    height: 13px;
  }

  /* legend */
  .legend-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 8px;
    margin: 10px -6px 0;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    cursor: pointer;
    text-align: left;
    font-size: 13px;
  }
  .legend-item:hover {
    background: color-mix(in srgb, var(--_ink) 6%, transparent);
  }
  .legend-item .check {
    width: 14px;
    height: 14px;
    flex: none;
    border: 1.5px solid var(--_line-strong);
    border-radius: 4px;
    display: grid;
    place-items: center;
  }
  .legend-item[aria-pressed='true'] .check {
    background: var(--_accent);
    border-color: var(--_accent);
  }
  .legend-item[aria-pressed='true'] .check::after {
    content: '';
    width: 7px;
    height: 4px;
    border: solid var(--_accent-ink);
    border-width: 0 0 1.5px 1.5px;
    transform: translateY(-1px) rotate(-45deg);
  }
  .legend-item .sample {
    font-family: var(--_font-text);
    font-size: 15px;
  }
  .legend-item[aria-pressed='false'] .sample {
    color: var(--_faint);
    text-decoration-color: transparent;
  }
  .legend-item .n {
    margin-left: auto;
    color: var(--_muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .legend-rows {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    align-items: baseline;
    margin-top: 8px;
  }
  .legend-rows .sample {
    justify-self: start;
    font-family: var(--_font-text);
    font-size: 15px;
    position: relative;
  }
  .legend-rows .explain {
    color: var(--_muted);
    font-size: 12px;
  }
  .legend-section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--_line);
  }
  .lat-mark {
    font-family: var(--_font-ui);
    font-size: 0.5em;
    font-weight: 650;
    vertical-align: 0.9em;
    margin-left: 1px;
  }

  /* speech options */
  .field {
    display: grid;
    gap: 4px;
    margin-top: 10px;
  }
  .field > span {
    font-size: 12px;
    color: var(--_muted);
  }
  select,
  .text-input {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--_line-strong);
    border-radius: 6px;
    background: var(--_surface);
    min-width: 0;
    width: 100%;
  }
  .segmented {
    display: flex;
    border: 1px solid var(--_line-strong);
    border-radius: 6px;
    overflow: hidden;
  }
  .segmented button {
    flex: 1;
    height: 30px;
    border: 0;
    border-left: 1px solid var(--_line);
    background: var(--_surface);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .segmented button:first-child {
    border-left: 0;
  }
  .segmented button[aria-pressed='true'] {
    background: var(--_accent-soft);
    color: var(--_accent);
    font-weight: 650;
  }
  .segmented button:focus-visible {
    outline-offset: -2px;
  }

  /* ---------- concept card ---------- */
  .card {
    position: absolute;
    z-index: 20;
    top: 0;
    left: 0;
    width: min(368px, calc(100% - 16px));
    max-height: var(--med-card-max-height, min(440px, 80vh));
    display: flex;
    flex-direction: column;
    background: var(--_raised);
    border: 1px solid var(--_line-strong);
    border-radius: 10px;
    box-shadow: var(--_shadow);
    visibility: hidden;
  }
  .card.placed {
    visibility: visible;
  }
  .card:focus {
    outline: none;
  }
  .card:focus-visible {
    outline: 2px solid var(--_accent);
    outline-offset: 1px;
  }
  .card-head {
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--_line);
  }
  .card-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .card-title h2 {
    margin: 0;
    font-family: var(--_font-text);
    font-size: 19px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .card-type {
    flex: none;
    font-size: 12px;
    font-weight: 600;
  }
  .card-sub {
    margin: 3px 0 0;
    color: var(--_muted);
    font-size: 12px;
  }
  .assertion-line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--_chrome);
    font-size: 12px;
  }
  .assertion-line strong {
    font-weight: 650;
  }
  .codes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  .code {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 1px 6px;
    border: 1px solid var(--_line);
    border-radius: 4px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .code .sys {
    color: var(--_muted);
  }
  .code .val {
    font-weight: 600;
  }
  .card-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .info {
    padding: 10px 14px 12px;
    border-bottom: 1px solid var(--_line);
  }
  .info:last-child {
    border-bottom: 0;
  }
  .info p {
    margin: 0;
  }
  .info .definition {
    font-size: 13.5px;
    line-height: 1.5;
  }
  .info .syn {
    margin-top: 6px;
    color: var(--_muted);
    font-size: 12px;
  }
  .info details {
    margin-top: 6px;
  }
  .info summary {
    cursor: pointer;
    font-weight: 600;
    border-radius: 4px;
  }
  .info details p {
    margin: 4px 0 2px 14px;
    color: var(--_ink);
  }
  .info .links {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    margin-top: 8px;
  }
  .ext {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .ext .icon {
    width: 12px;
    height: 12px;
  }
  .attribution {
    margin-top: 8px;
    color: var(--_muted);
    font-size: 11.5px;
  }
  .attribution a {
    color: inherit;
  }
  .info.pending,
  .info.failed,
  .info.none {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--_muted);
    font-size: 12px;
  }
  .info.failed {
    color: var(--_danger);
  }
  .info.failed .btn {
    height: 24px;
    margin-left: auto;
    color: var(--_ink);
  }
  .spinner {
    width: 12px;
    height: 12px;
    flex: none;
    border: 1.5px solid var(--_line-strong);
    border-top-color: var(--_accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .card-actions {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--_line);
    background: var(--_chrome);
    border-radius: 0 0 9px 9px;
  }

  /* ---------- research panel ---------- */
  .research {
    display: flex;
    flex-direction: column;
    flex: none;
    width: clamp(320px, 38%, 440px);
    min-height: 0;
    border-left: 1px solid var(--_line);
    background: var(--_surface);
  }
  .narrow .research {
    position: absolute;
    z-index: 15;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    height: min(78%, 560px);
    border-left: 0;
    border-top: 1px solid var(--_line-strong);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -10px 30px -10px rgb(10 20 30 / 0.3);
  }
  .research-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 8px 14px;
  }
  .research-head h2 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 650;
  }
  .ask {
    padding: 0 14px 12px;
    border-bottom: 1px solid var(--_line);
  }
  .context {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--_muted);
    min-width: 0;
  }
  .context .term {
    font-family: var(--_font-text);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .context .btn {
    height: 22px;
    width: 22px;
    flex: none;
  }
  .ask-row {
    display: flex;
    gap: 6px;
    align-items: flex-end;
  }
  .ask textarea {
    flex: 1;
    min-width: 0;
    min-height: 34px;
    max-height: 120px;
    padding: 7px 9px;
    border: 1px solid var(--_line-strong);
    border-radius: 7px;
    background: var(--_surface);
    resize: none;
    line-height: 1.4;
    font-size: 13.5px;
    field-sizing: content;
  }
  .ask textarea::placeholder {
    color: var(--_faint);
  }
  .ask .btn.primary,
  .ask .btn.outline {
    height: 34px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 9px;
  }
  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--_line-strong);
    border-radius: 13px;
    background: var(--_raised);
    cursor: pointer;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .chip:hover:not(:disabled) {
    border-color: var(--_accent);
    color: var(--_accent);
  }
  .chip:disabled {
    color: var(--_faint);
    cursor: default;
  }
  .provider-pick {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 9px;
    font-size: 12px;
    color: var(--_muted);
  }
  .provider-pick select {
    height: 26px;
    width: auto;
    flex: 1;
    font-size: 12px;
  }
  .provider-pick .one {
    color: var(--_ink);
  }
  .research-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .empty {
    margin: 0;
    color: var(--_muted);
  }
  .steps {
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }
  .step {
    display: grid;
    grid-template-columns: 16px 1fr;
    gap: 0 8px;
    padding: 3px 0;
    color: var(--_muted);
  }
  .step .dot {
    width: 8px;
    height: 8px;
    margin: 5px 4px 0;
    border-radius: 50%;
    background: var(--_line-strong);
  }
  .step.done .dot {
    background: var(--_accent);
  }
  .step.current {
    color: var(--_ink);
    font-weight: 600;
  }
  .step.current .dot {
    background: var(--_accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .step .details {
    grid-column: 2;
    font-weight: 400;
    font-size: 12px;
    color: var(--_muted);
  }
  .answer {
    font-size: 14px;
    line-height: 1.55;
  }
  .answer h3,
  .answer h4 {
    margin: 14px 0 4px;
    font-size: 14px;
    font-weight: 650;
  }
  .answer > :first-child {
    margin-top: 0;
  }
  .answer p {
    margin: 0 0 9px;
  }
  .answer ul,
  .answer ol {
    margin: 0 0 9px;
    padding-left: 20px;
  }
  .answer li {
    margin: 2px 0;
  }
  .answer code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.9em;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--_chrome);
  }
  .answer.streaming::after {
    content: '';
    display: inline-block;
    width: 7px;
    height: 14px;
    margin-left: 2px;
    vertical-align: -2px;
    background: var(--_accent);
    animation: pulse 1s steps(2) infinite;
  }
  .cite {
    display: inline-grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    margin: 0 1px;
    padding: 0 4px;
    border: 0;
    border-radius: 9px;
    background: var(--_accent-soft);
    color: var(--_accent);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    vertical-align: 0.15em;
    cursor: pointer;
  }
  .cite:hover,
  .cite[aria-expanded='true'] {
    background: var(--_accent);
    color: var(--_accent-ink);
  }
  .cite.missing {
    background: none;
    color: var(--_muted);
    cursor: default;
  }
  .citation {
    margin: 0 0 10px;
    padding: 9px 11px;
    border-left: 3px solid var(--_accent);
    border-radius: 0 7px 7px 0;
    background: var(--_chrome);
    font-size: 12.5px;
    line-height: 1.45;
  }
  .citation .c-title {
    font-weight: 650;
  }
  .citation .c-meta {
    color: var(--_muted);
  }
  .citation blockquote {
    margin: 6px 0;
    font-family: var(--_font-ui);
    font-size: 13.5px;
    line-height: 1.5;
  }
  .citation blockquote::before {
    content: '„';
  }
  .citation blockquote::after {
    content: '“';
  }
  .refs {
    margin: 16px 0 0;
    padding: 12px 0 0;
    border-top: 1px solid var(--_line);
  }
  .refs h3 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 650;
    color: var(--_muted);
  }
  .refs ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .refs li {
    display: grid;
    grid-template-columns: 24px 1fr;
    gap: 0 4px;
    padding: 5px 0;
    font-size: 12.5px;
  }
  .refs li.flash {
    animation: flash 1.2s ease-out;
  }
  @keyframes flash {
    from {
      background: var(--_accent-soft);
    }
  }
  .refs .num {
    color: var(--_accent);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .refs .c-meta {
    display: block;
    color: var(--_muted);
    font-size: 12px;
  }
  .searched {
    margin: 12px 0 0;
    color: var(--_muted);
    font-size: 12px;
  }
  .searched ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .searched li {
    padding: 1px 7px;
    border: 1px solid var(--_line);
    border-radius: 4px;
  }
  .searched li.hit {
    border-color: var(--_line-strong);
    color: var(--_ink);
  }
  .notice {
    display: grid;
    grid-template-columns: 16px 1fr;
    gap: 2px 8px;
    margin: 0 0 12px;
    padding: 9px 11px;
    border: 1px solid var(--_warn-line);
    border-radius: 7px;
    background: var(--_warn-soft);
    color: var(--_warn);
    font-size: 12.5px;
  }
  .notice .icon {
    margin-top: 1px;
  }
  .notice ul {
    margin: 0;
    padding-left: 16px;
  }
  .notice p {
    margin: 0;
  }
  .notice.quiet {
    margin: 14px 0 0;
    border-color: var(--_line);
    background: none;
    color: var(--_muted);
  }
  .notice.error {
    border-color: color-mix(in srgb, var(--_danger) 40%, transparent);
    background: var(--_danger-soft);
    color: var(--_danger);
  }
  .ungrounded-banner {
    grid-column: 1 / -1;
  }
  .answer.ungrounded {
    padding: 10px 12px;
    border: 1.5px dashed var(--_line-strong);
    border-radius: 7px;
    color: var(--_muted);
    font-style: italic;
  }
  .answer.ungrounded p:last-child {
    margin-bottom: 0;
  }
  .answer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 14px;
  }
  .history {
    margin-top: 18px;
  }
  .history h3 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 650;
    color: var(--_muted);
  }
  .history ul {
    margin: 0 -8px;
    padding: 0;
    list-style: none;
  }
  .history button {
    display: block;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history button:hover {
    background: color-mix(in srgb, var(--_ink) 6%, transparent);
  }
  .disclaimer {
    margin: 0;
    padding: 8px 14px 9px;
    border-top: 1px solid var(--_line);
    background: var(--_chrome);
    color: var(--_muted);
    font-size: 11.5px;
    line-height: 1.4;
  }
  .frame:not(.narrow) .research .disclaimer {
    border-radius: 0;
  }

  /* ---------- toast / live region ---------- */
  .toast {
    position: absolute;
    z-index: 40;
    left: 50%;
    bottom: 42px;
    transform: translateX(-50%);
    max-width: min(440px, calc(100% - 24px));
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--_ink);
    color: var(--_surface);
    box-shadow: var(--_shadow);
    font-size: 12.5px;
  }
  .toast.error {
    background: var(--_danger);
    color: #fff;
  }
  :host([data-scheme='dark']) .toast.error {
    color: #1a0b0f;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
    .rec-dot,
    .step.current .dot {
      animation: none;
    }
  }
`;
