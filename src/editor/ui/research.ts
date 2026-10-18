import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { Citation, ResearchAnswer, ResearchProgress } from '../../core/types.ts';
import { termClass } from '../concepts.ts';
import { quickChips } from '../i18n.ts';
import type { Block } from '../markdown.ts';
import { parseMarkdown, safeUrl } from '../markdown.ts';
import type { MedEditor } from '../med-editor.ts';
import { formatDate } from '../text-utils.ts';
import { icon } from './icons.ts';
import { renderBlocks } from './render-markdown.ts';

const STAGES: ResearchProgress['stage'][] = ['resolving', 'searching', 'reading', 'answering'];

// Rendering happens far more often than the text changes (every streamed delta re-renders).
let parsedFor = '';
let parsed: Block[] = [];
function blocksOf(markdown: string): Block[] {
  if (markdown !== parsedFor) {
    parsedFor = markdown;
    parsed = parseMarkdown(markdown);
  }
  return parsed;
}

function renderSteps(host: MedEditor): TemplateResult {
  const s = host._s;
  const log = host._research.stages;
  const current = log[log.length - 1]?.stage;
  const currentIndex = current ? STAGES.indexOf(current) : -1;
  return html`<ol class="steps" aria-label=${s.researchTitle}>
    ${STAGES.map((stage, index) => {
      const entry = log.find((l) => l.stage === stage);
      const state = index === currentIndex ? 'current' : index < currentIndex ? 'done' : '';
      return html`<li class="step ${state}" aria-current=${state === 'current' ? 'step' : nothing}>
        <span class="dot"></span><span>${s.stage[stage]}</span>
        ${entry?.details.length ? html`<span class="details">${entry.details.slice(-3).map((d) => html`<span>${d}</span><br />`)}</span>` : nothing}
      </li>`;
    })}
  </ol>`;
}

function renderReferences(host: MedEditor, answer: ResearchAnswer): TemplateResult | typeof nothing {
  const s = host._s;
  if (answer.citations.length === 0) return nothing;
  const sorted = [...answer.citations].sort((a, b) => a.index - b.index);
  return html`<section class="refs" aria-label=${s.citations}>
    <h3>${s.citations}</h3>
    <ol>
      ${sorted.map((c: Citation) => {
        const url = safeUrl(c.url);
        const date = formatDate(c.date);
        return html`<li data-ref=${c.index}>
          <span class="num">${c.index}</span>
          <span>
            ${url
              ? html`<a href=${url} target="_blank" rel="noopener noreferrer">${c.title}<span class="sr-only"> (${s.openExternal})</span></a>`
              : c.title}
            <span class="c-meta">${c.source}${date ? html`, ${date}` : nothing}</span>
          </span>
        </li>`;
      })}
    </ol>
  </section>`;
}

function renderAnswer(host: MedEditor, answer: ResearchAnswer): TemplateResult {
  const s = host._s;
  const citations = new Map(answer.citations.map((c) => [c.index, c]));
  const cited = new Set(answer.citations.map((c) => c.source.toLowerCase()));
  const warnings = answer.warnings ?? [];
  return html`
    ${answer.grounded
      ? nothing
      : html`<div class="notice" role="note">
          ${icon('alert')}
          <div><strong>${s.ungroundedTitle}</strong>
            <p>${s.ungroundedText}</p></div>
        </div>`}
    <div class="answer ${answer.grounded ? '' : 'ungrounded'}" data-grounded=${String(answer.grounded)}>
      ${renderBlocks(blocksOf(answer.answer), {
        s,
        citations,
        active: host._activeCite,
        onCite: (block, n) => host._toggleCite(block, n),
      })}
    </div>
    <div class="answer-actions">
      ${answer.grounded && !host.readonly
        ? html`<button type="button" class="btn outline" data-action="insert" @click=${() => host._insertAnswer()}>
            ${icon('insert')}${s.insert}
          </button>`
        : nothing}
      <button type="button" class="btn outline" data-action="copy" @click=${() => host._copyAnswer()}>
        ${icon('copy')}${host._copied ? s.copied : s.copy}
      </button>
    </div>
    ${warnings.length
      ? html`<div class="notice quiet" role="note" aria-label=${s.warnings}>
          ${icon('alert')}
          ${warnings.length === 1 ? html`<p>${warnings[0]}</p>` : html`<ul>${warnings.map((w) => html`<li>${w}</li>`)}</ul>`}
        </div>`
      : nothing}
    ${renderReferences(host, answer)}
    ${answer.sourcesSearched.length
      ? html`<div class="searched">
          ${s.sourcesSearched}
          <ul>
            ${answer.sourcesSearched.map((name) => html`<li class=${cited.has(name.toLowerCase()) ? 'hit' : ''}>${name}</li>`)}
          </ul>
        </div>`
      : nothing}
  `;
}

function renderHistory(host: MedEditor): TemplateResult | typeof nothing {
  const research = host._research;
  const items = research.history.filter((h) => h.answer !== research.answer);
  if (items.length === 0) return nothing;
  return html`<section class="history">
    <h3>${host._s.history}</h3>
    <ul>
      ${items.map((item) => html`<li><button type="button" title=${item.question} @click=${() => host._showHistory(item)}>${item.question}</button></li>`)}
    </ul>
  </section>`;
}

export function renderResearch(host: MedEditor): TemplateResult | typeof nothing {
  if (!host._researchOpen) return nothing;
  const s = host._s;
  const research = host._research;
  const providers = host._registry.list('research');
  const active = host._registry.activeOne('research');
  const concept = research.concept;
  const canAsk = !!active && host._draft.trim().length > 0;

  const submit = (event: Event) => {
    event.preventDefault();
    if (research.running) research.cancel();
    else host._ask(host._draft);
  };

  let content: TemplateResult | typeof nothing;
  if (providers.length === 0) content = html`<p class="empty">${s.researchNoProvider}</p>`;
  else if (research.status === 'running') {
    content = html`${renderSteps(host)}
      ${research.streamed
        ? html`<div class="answer streaming" aria-hidden="true">${renderBlocks(blocksOf(research.streamed), null)}</div>`
        : nothing}`;
  } else if (research.status === 'error') {
    content = html`<div class="notice error" role="alert">${icon('alert')}
      <p>${s.researchFailed(research.error)}</p></div>
      ${renderHistory(host)}`;
  } else if (research.status === 'done' && research.answer) {
    content = html`${renderAnswer(host, research.answer)}${renderHistory(host)}`;
  } else {
    content = html`<p class="empty">${research.cancelled ? s.cancelled : s.researchEmpty}</p>
      ${renderHistory(host)}`;
  }

  return html`<aside class="research chrome" aria-label=${s.researchTitle} @keydown=${(e: KeyboardEvent) => host._panelKeydown(e)}>
    <div class="research-head">
      <h2>${s.researchTitle}</h2>
      <button type="button" class="btn icon-only" aria-label=${s.close} title=${s.close} @click=${() => host._setResearchOpen(false)}>
        ${icon('close')}
      </button>
    </div>
    <form class="ask" @submit=${submit}>
      ${concept
        ? html`<div class="context">
            <span>${s.context}</span>
            <span class="term ${termClass(concept)}" title=${concept.label}>${concept.label}</span>
            <button type="button" class="btn icon-only" aria-label=${s.removeContext} title=${s.removeContext}
              @click=${() => research.setConcept(null)}>${icon('close')}</button>
          </div>`
        : nothing}
      <div class="ask-row">
        <textarea
          id="question"
          rows="1"
          aria-label=${s.question}
          placeholder=${s.questionPlaceholder}
          .value=${host._draft}
          ?disabled=${providers.length === 0}
          @input=${(e: InputEvent) => host._setDraft((e.target as HTMLTextAreaElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
          }}
        ></textarea>
        ${research.running
          ? html`<button type="submit" class="btn outline" data-action="cancel">${icon('stop')}${s.cancel}</button>`
          : html`<button type="submit" class="btn primary" data-action="ask" ?disabled=${!canAsk}>${s.ask}</button>`}
      </div>
      ${concept
        ? html`<div class="chips">
            ${quickChips(concept.type, host._language).map(
              (chip) => html`<button type="button" class="chip" ?disabled=${!active || research.running}
                @click=${() => host._ask(chip.question(concept.label))}>${chip.label}</button>`,
            )}
          </div>`
        : nothing}
      ${providers.length > 1
        ? html`<label class="provider-pick">
            <span>${s.provider}</span>
            <select @change=${(e: Event) => host._registry.setActive('research', (e.target as HTMLSelectElement).value, true)}>
              ${providers.map((p) => html`<option value=${p.id} ?selected=${p.id === active?.id}>${p.label}</option>`)}
            </select>
          </label>`
        : nothing}
    </form>
    <div class="research-scroll" aria-live="polite" aria-busy=${research.running ? 'true' : 'false'}>${content}</div>
    <p class="disclaimer">${host.disclaimer || s.disclaimer}</p>
  </aside>`;
}
