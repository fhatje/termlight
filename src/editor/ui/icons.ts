import { svg, html } from 'lit';
import type { TemplateResult } from 'lit';

const paths = {
  play: svg`<path d="M6.5 4.2v11.6L16 10z" fill="currentColor" stroke="none"/>`,
  pause: svg`<path d="M6 4.5h3v11H6zM11 4.5h3v11h-3z" fill="currentColor" stroke="none"/>`,
  stop: svg`<rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none"/>`,
  speaker: svg`<path d="M3.5 8v4h2.8l3.7 3V5L6.3 8z"/><path d="M13 7.5a3.6 3.6 0 0 1 0 5M15.2 5.3a6.6 6.6 0 0 1 0 9.4"/>`,
  mic: svg`<rect x="7.5" y="2.8" width="5" height="9" rx="2.5"/><path d="M4.8 9.6a5.2 5.2 0 0 0 10.4 0M10 14.8v2.6M7.2 17.4h5.6"/>`,
  research: svg`<path d="M10 5.2C8.4 4 6.2 3.6 3.5 3.8v10.6c2.7-.2 4.9.2 6.5 1.4 1.6-1.2 3.8-1.6 6.5-1.4V3.8c-2.7-.2-4.9.2-6.5 1.4zM10 5.2v10.6"/>`,
  gear: svg`<circle cx="10" cy="10" r="2.4"/><path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4"/>`,
  close: svg`<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>`,
  chevron: svg`<path d="M5.5 8l4.5 4.5L14.5 8"/>`,
  external: svg`<path d="M8 4.5H4.5v11h11V12M11.5 4.5h4v4M15.5 4.5L9 11"/>`,
  copy: svg`<rect x="7" y="7" width="9" height="9.5" rx="1.5"/><path d="M4 12.5v-8A1.5 1.5 0 0 1 5.5 3h6.5"/>`,
  insert: svg`<path d="M15.5 4v6.5a2 2 0 0 1-2 2h-9M8 9l-3.5 3.5L8 16"/>`,
  key: svg`<path d="M3.5 5.5h13M3.5 10h8M3.5 14.5h10.5"/><circle cx="15.2" cy="10" r="1.3" fill="currentColor" stroke="none"/>`,
  send: svg`<path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5"/>`,
  alert: svg`<path d="M10 3.2l7.3 12.8H2.7zM10 8.2v3.6M10 14.1v.2"/>`,
  shield: svg`<path d="M10 2.8l5.8 2v4.6c0 3.4-2.3 6.2-5.8 7.8-3.5-1.6-5.8-4.4-5.8-7.8V4.8z"/>`,
  cloud: svg`<path d="M6 15.5a3.6 3.6 0 0 1-.5-7.2 4.8 4.8 0 0 1 9.3 1.1 3.1 3.1 0 0 1-.4 6.1z"/>`,
  history: svg`<path d="M3.8 10a6.2 6.2 0 1 0 1.9-4.5M3.5 3.5v2.8h2.8M10 6.5V10l2.3 1.5"/>`,
  back: svg`<path d="M11.5 5l-5 5 5 5"/>`,
};

export type IconName = keyof typeof paths;

export function icon(name: IconName): TemplateResult {
  return html`<svg class="icon" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
