import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { Citation } from '../../core/types.ts';
import type { Strings } from '../i18n.ts';
import type { Block, Inline } from '../markdown.ts';
import { safeUrl } from '../markdown.ts';
import { formatDate } from '../text-utils.ts';
import { icon } from './icons.ts';

export interface AnswerRenderContext {
  s: Strings;
  citations: ReadonlyMap<number, Citation>;
  /** The citation currently revealed, anchored below the block whose marker was clicked. */
  active: { block: number; n: number } | null;
  onCite(block: number, n: number): void;
}

// All text goes through Lit text bindings (→ text nodes); no HTML strings anywhere in this file.
function renderInline(nodes: Inline[], block: number, ctx: AnswerRenderContext | null): TemplateResult[] {
  return nodes.map((node) => {
    switch (node.t) {
      case 'text':
        return html`${node.text}`;
      case 'strong':
        return html`<strong>${renderInline(node.children, block, ctx)}</strong>`;
      case 'em':
        return html`<em>${renderInline(node.children, block, ctx)}</em>`;
      case 'code':
        return html`<code>${node.text}</code>`;
      case 'link':
        return html`<a href=${node.url} target="_blank" rel="noopener noreferrer">${node.text}</a>`;
      case 'cite': {
        const citation = ctx?.citations.get(node.n);
        if (!ctx || !citation) return html`<span class="cite missing">${node.n}</span>`;
        const expanded = ctx.active?.block === block && ctx.active.n === node.n;
        return html`<button
          type="button"
          class="cite"
          aria-expanded=${expanded ? 'true' : 'false'}
          aria-label=${ctx.s.citationN(node.n)}
          title=${citation.title}
          @click=${() => ctx.onCite(block, node.n)}
        >
          ${node.n}
        </button>`;
      }
    }
  });
}

export function renderCitation(citation: Citation, s: Strings): TemplateResult {
  const url = safeUrl(citation.url);
  const date = formatDate(citation.date);
  return html`<aside class="citation" data-cite=${citation.index}>
    <div class="c-title">${citation.title}</div>
    <div class="c-meta">${citation.source}${date ? html`, ${date}` : nothing}</div>
    ${citation.quote ? html`<blockquote>${citation.quote}</blockquote>` : nothing}
    ${url
      ? html`<a class="ext" href=${url} target="_blank" rel="noopener noreferrer"
          >${s.openSource}${icon('external')}<span class="sr-only"> (${s.openExternal})</span></a
        >`
      : nothing}
  </aside>`;
}

export function renderBlocks(blocks: Block[], ctx: AnswerRenderContext | null): TemplateResult[] {
  return blocks.map((block, index) => {
    let body: TemplateResult;
    if (block.t === 'p') body = html`<p>${renderInline(block.children, index, ctx)}</p>`;
    else if (block.t === 'h') {
      // Panel headings start at h3; the answer must not outrank the panel title.
      body =
        block.level <= 2
          ? html`<h3>${renderInline(block.children, index, ctx)}</h3>`
          : html`<h4>${renderInline(block.children, index, ctx)}</h4>`;
    } else {
      const items = block.items.map((item) => html`<li>${renderInline(item, index, ctx)}</li>`);
      body = block.t === 'ul' ? html`<ul>${items}</ul>` : html`<ol>${items}</ol>`;
    }
    const revealed = ctx?.active?.block === index ? ctx.citations.get(ctx.active.n) : undefined;
    return html`${body}${revealed && ctx ? renderCitation(revealed, ctx.s) : nothing}`;
  });
}
