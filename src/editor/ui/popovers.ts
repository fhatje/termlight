import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { ProviderMeta } from '../../core/types.ts';
import { SLOTS, isMultiSlot } from '../../core/registry.ts';
import type { Slot } from '../../core/registry.ts';
import { CONCEPT_TYPES, termClass } from '../concepts.ts';
import type { MedEditor } from '../med-editor.ts';
import { RATES } from '../speech-controller.ts';
import { icon } from './icons.ts';

function head(host: MedEditor, title: string): TemplateResult {
  return html`<div class="pop-head">
    <h2>${title}</h2>
    <button type="button" class="btn icon-only" aria-label=${host._s.close} title=${host._s.close} @click=${() => host._closePopover(true)}>
      ${icon('close')}
    </button>
  </div>`;
}

function badge(host: MedEditor, slot: Slot, provider: ProviderMeta): TemplateResult {
  const s = host._s;
  return provider.locality === 'local'
    ? html`<span class="badge local" data-locality="local">${icon('shield')}${s.badgeLocal}</span>`
    : html`<span class="badge remote" data-locality="remote">${icon('cloud')}${s.badgeRemote[slot](provider.label)}</span>`;
}

function renderSlot(host: MedEditor, slot: Slot): TemplateResult {
  const s = host._s;
  const registry = host._registry;
  const providers: readonly ProviderMeta[] = registry.list(slot);
  const multi = isMultiSlot(slot);
  const anyActive = providers.some((p) => registry.isActive(slot, p.id));
  return html`<fieldset class="slot" data-slot=${slot}>
    <legend class="sr-only">${s.slot[slot]}</legend>
    <h3 aria-hidden="true">${s.slot[slot]}</h3>
    <p class="hint">${s.slotHint[slot]}</p>
    ${providers.length === 0 ? html`<p class="hint" style="margin-top:6px">${s.slotEmpty}</p>` : nothing}
    ${providers.map(
      (p) => html`<label class="provider">
        <input
          type=${multi ? 'checkbox' : 'radio'}
          name=${`med-${slot}`}
          value=${p.id}
          .checked=${registry.isActive(slot, p.id)}
          @change=${(e: Event) => registry.setActive(slot, p.id, multi ? (e.target as HTMLInputElement).checked : true)}
        />
        <span class="name">${p.label}</span>
        ${p.description ? html`<span class="desc">${p.description}</span>` : nothing}
        ${badge(host, slot, p)}
      </label>`,
    )}
    ${!multi && providers.length > 0
      ? html`<label class="provider">
          <input type="radio" name=${`med-${slot}`} value="" .checked=${!anyActive}
            @change=${() => {
              const current = registry.activeOne(slot as 'tts' | 'stt' | 'research');
              if (current) registry.setActive(slot, current.id, false);
            }} />
          <span class="name">${s.none}</span>
        </label>`
      : nothing}
  </fieldset>`;
}

export function renderSettings(host: MedEditor): TemplateResult {
  return html`<div class="popover settings chrome" role="dialog" aria-label=${host._s.settingsTitle} data-popover="settings">
    ${head(host, host._s.settingsTitle)} ${SLOTS.map((slot) => renderSlot(host, slot))}
  </div>`;
}

export function renderLegend(host: MedEditor): TemplateResult {
  const s = host._s;
  return html`<div class="popover legend chrome" role="dialog" aria-label=${s.legendTitle} data-popover="legend">
    ${head(host, s.legendTitle)}
    <p class="hint">${s.legendIntro}</p>
    <div class="legend-grid">
      ${CONCEPT_TYPES.map((type) => {
        const on = !host._hidden.has(type);
        const n = host._counts.get(type) ?? 0;
        return html`<button type="button" class="legend-item" data-type=${type} aria-pressed=${on ? 'true' : 'false'}
          aria-label=${s.showType(s.conceptType[type])} @click=${() => host._toggleType(type)}>
          <span class="check"></span>
          <span class="sample ${termClass({ type })}">${s.conceptType[type]}</span>
          ${n ? html`<span class="n">${n}</span>` : nothing}
        </button>`;
      })}
    </div>
    <div class="legend-section">
      <h3>${s.legendAssertions}</h3>
      <div class="legend-rows">
        ${(['present', 'uncertain', 'negated'] as const).map(
          (assertion) => html`<span class="sample ${termClass({ type: 'disease', assertion })}">${s.assertion[assertion]}</span>
            <span class="explain">${s.assertionLong[assertion]}</span>`,
        )}
        <span class="sample ${termClass({ type: 'anatomy' })}">${s.legendSample}<span class="lat-mark">${s.lateralityMark.left}</span></span>
        <span class="explain">${s.legendLaterality}: ${s.lateralityMark.left}, ${s.lateralityMark.right}, ${s.lateralityMark.bilateral}</span>
      </div>
    </div>
    <p class="hint" style="margin-top:12px"><kbd>${host._modKey}</kbd> <kbd>I</kbd> ${s.shortcutCard}</p>
  </div>`;
}

export function renderSpeechOptions(host: MedEditor): TemplateResult {
  const s = host._s;
  const speech = host._speech;
  return html`<div class="popover speech chrome" role="dialog" aria-label=${s.speechOptions} data-popover="speech">
    ${head(host, s.speechOptions)}
    <div class="field">
      <span id="rate-label">${s.rate}</span>
      <div class="segmented" role="group" aria-labelledby="rate-label">
        ${RATES.map(
          (rate) => html`<button type="button" aria-pressed=${speech.rate === rate ? 'true' : 'false'} @click=${() => host._setRate(rate)}>
            ${String(rate).replace('.', ',')}×
          </button>`,
        )}
      </div>
    </div>
    ${speech.voices.length
      ? html`<label class="field">
          <span>${s.voice}</span>
          <select @change=${(e: Event) => host._setVoice((e.target as HTMLSelectElement).value)}>
            <option value="" ?selected=${speech.voiceId === ''}>${s.voiceDefault}</option>
            ${speech.voices.map((v) => html`<option value=${v.id} ?selected=${v.id === speech.voiceId}>${v.label}</option>`)}
          </select>
        </label>`
      : nothing}
  </div>`;
}
