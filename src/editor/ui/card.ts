import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { ConceptInfo } from '../../core/types.ts';
import { termClass } from '../concepts.ts';
import type { LookupEntry } from '../lookup-store.ts';
import { safeUrl } from '../markdown.ts';
import type { MedEditor } from '../med-editor.ts';
import { icon } from './icons.ts';

function external(label: string, url: string | undefined, openExternal: string): TemplateResult | string {
  const safe = safeUrl(url);
  if (!safe) return label;
  return html`<a class="ext" href=${safe} target="_blank" rel="noopener noreferrer"
    >${label}${icon('external')}<span class="sr-only"> (${openExternal})</span></a
  >`;
}

function renderInfo(host: MedEditor, info: ConceptInfo, annotationLabel: string): TemplateResult {
  const s = host._s;
  const synonyms = (info.synonyms ?? []).filter((x) => x && x !== annotationLabel).slice(0, 8);
  const links = (info.links ?? []).filter((l) => safeUrl(l.url));
  const sections = info.sections ?? [];
  return html`<section class="info" data-provider=${info.attribution.name}>
    ${info.definition ? html`<p class="definition">${info.definition}</p>` : nothing}
    ${synonyms.length ? html`<p class="syn">${s.synonyms}: ${synonyms.join(', ')}</p>` : nothing}
    ${sections.map(
      (section) => html`<details>
        <summary>${section.title}</summary>
        <p>${section.text}</p>
      </details>`,
    )}
    ${links.length ? html`<div class="links">${links.map((l) => external(l.label, l.url, s.openExternal))}</div>` : nothing}
    <p class="attribution">
      ${s.source}: ${external(info.attribution.name, info.attribution.url, s.openExternal)}${info.attribution.license
        ? html`, ${s.license} ${info.attribution.license}`
        : nothing}
    </p>
  </section>`;
}

function renderEntry(host: MedEditor, entry: LookupEntry, label: string): TemplateResult | typeof nothing {
  const s = host._s;
  if (entry.status === 'done' && entry.info) return renderInfo(host, entry.info, label);
  if (entry.status === 'loading') {
    return html`<div class="info pending" data-provider=${entry.provider.label}><span class="spinner"></span>${s.loadingFrom(entry.provider.label)}</div>`;
  }
  if (entry.status === 'error') {
    return html`<div class="info failed" data-provider=${entry.provider.label} title=${entry.error?.message ?? ''}>
      ${s.lookupFailed(entry.provider.label)}
      <button type="button" class="btn outline" @click=${() => host._retryLookup(entry.provider.id)}>${s.retry}</button>
    </div>`;
  }
  return nothing;
}

export function renderCard(host: MedEditor): TemplateResult | typeof nothing {
  const card = host._card;
  if (!card) return nothing;
  const s = host._s;
  const a = card.annotation;
  const assertion = a.assertion ?? 'present';
  const entries = host._lookups.entries(a);
  const hasLookups = host._registry.active('lookups').length > 0;
  const settled = entries.length > 0 && entries.every((e) => e.status !== 'loading');
  const nothingFound = settled && entries.every((e) => e.status === 'empty');
  const codes = a.codes ?? [];
  const tts = host._registry.activeOne('tts');
  const speakingHere = host._speech.ttsStatus !== 'idle' && host._speech.ttsOrigin === 'snippet';
  const canResearch = host._registry.list('research').length > 0;

  return html`<div
    class="card chrome"
    role="dialog"
    aria-label=${s.cardLabel(a.label)}
    tabindex="-1"
    @mouseenter=${() => host._cardHover(true)}
    @mouseleave=${() => host._cardHover(false)}
    @click=${() => host._cardClicked()}
    @keydown=${(e: KeyboardEvent) => host._cardKeydown(e)}
  >
    <header class="card-head">
      <div class="card-title">
        <h2>${a.label}</h2>
        <span class="card-type ${termClass({ type: a.type })}">${s.conceptType[a.type]}</span>
      </div>
      ${a.text && a.text.toLowerCase() !== a.label.toLowerCase() ? html`<p class="card-sub">${s.matchedAs(a.text)}</p>` : nothing}
      ${assertion !== 'present' || a.laterality
        ? html`<div class="assertion-line" data-assertion=${assertion}>
            ${assertion !== 'present'
              ? html`<strong class=${termClass(a)}>${s.assertion[assertion]}</strong><span>${s.assertionLong[assertion]}</span>`
              : nothing}
            ${a.laterality ? html`<strong>${s.laterality[a.laterality]}</strong>` : nothing}
          </div>`
        : nothing}
      ${codes.length
        ? html`<ul class="codes" aria-label=${s.codes}>
            ${codes.map((c) => html`<li class="code"><span class="sys">${c.system}</span><span class="val">${c.code}</span></li>`)}
          </ul>`
        : nothing}
    </header>
    <div class="card-body">
      ${entries.map((entry) => renderEntry(host, entry, a.label))}
      ${nothingFound ? html`<div class="info none">${s.noDetails}</div>` : nothing}
      ${!hasLookups ? html`<div class="info none">${s.noLookups}</div>` : nothing}
    </div>
    ${tts || canResearch
      ? html`<footer class="card-actions">
          ${tts
            ? html`<button type="button" class="btn outline" data-action="speak" @click=${() => host._cardSpeak()}>
                ${icon(speakingHere ? 'stop' : 'speaker')}${speakingHere ? s.stop : s.readAloud}
              </button>`
            : nothing}
          ${canResearch
            ? html`<button type="button" class="btn outline" data-action="research" @click=${() => host.openResearch(undefined, a)}>
                ${icon('research')}${s.researchThis}
              </button>`
            : nothing}
        </footer>`
      : nothing}
  </div>`;
}
