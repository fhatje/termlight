import { render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { Citation } from '../core/types.ts';
import { strings } from './i18n.ts';
import { markdownToPlainText, parseInline, parseMarkdown, safeUrl } from './markdown.ts';
import { renderBlocks } from './ui/render-markdown.ts';

describe('parseMarkdown', () => {
  it('parses paragraphs, lists and headings', () => {
    const blocks = parseMarkdown('# Titel\n\nErster Absatz\nzweite Zeile.\n\n- eins\n- zwei\n  fortgesetzt\n\n1. a\n2) b\n');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol']);
    expect(blocks[1]).toEqual({ t: 'p', children: [{ t: 'text', text: 'Erster Absatz zweite Zeile.' }] });
    expect(blocks[2]).toMatchObject({ items: [[{ t: 'text', text: 'eins' }], [{ t: 'text', text: 'zwei fortgesetzt' }]] });
    expect(blocks[3]).toMatchObject({ t: 'ol', items: [[{ text: 'a' }], [{ text: 'b' }]] });
  });

  it('parses bold, italic, code and citations', () => {
    expect(parseInline('**Fett** und *kursiv* und `4 g` [1][2, 3].')).toEqual([
      { t: 'strong', children: [{ t: 'text', text: 'Fett' }] },
      { t: 'text', text: ' und ' },
      { t: 'em', children: [{ t: 'text', text: 'kursiv' }] },
      { t: 'text', text: ' und ' },
      { t: 'code', text: '4 g' },
      { t: 'text', text: ' ' },
      { t: 'cite', n: 1 },
      { t: 'cite', n: 2 },
      { t: 'cite', n: 3 },
      { t: 'text', text: '.' },
    ]);
  });

  it('leaves unbalanced markers, snake_case and arithmetic alone', () => {
    expect(parseInline('5 * 3 = 15, a_b_c, **offen')).toEqual([{ t: 'text', text: '5 * 3 = 15, a_b_c, **offen' }]);
  });

  it('only keeps http(s) links', () => {
    expect(parseInline('[ok](https://example.org/a) [bad](javascript:alert(1))')).toEqual([
      { t: 'link', text: 'ok', url: 'https://example.org/a' },
      { t: 'text', text: ' ' },
      { t: 'text', text: 'bad' },
      { t: 'text', text: ')' },
    ]);
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html,x')).toBeUndefined();
    expect(safeUrl(' https://example.org ')).toBe('https://example.org/');
    expect(safeUrl('nonsense')).toBeUndefined();
  });

  it('renders plain text for insertion', () => {
    expect(markdownToPlainText('**A** [1]\n\n- x\n- y\n\n1. eins')).toBe('A [1]\n\n– x\n– y\n\n1. eins');
  });
});

describe('renderBlocks', () => {
  const citations = new Map<number, Citation>([[1, { index: 1, title: 'Titel', url: 'https://example.org/x', source: 'openFDA', quote: 'Zitat <b>', date: '2024-03-18' }]]);
  const s = strings('de');

  function renderTo(markdown: string, active: { block: number; n: number } | null = null, onCite = () => {}) {
    const host = document.createElement('div');
    render(renderBlocks(parseMarkdown(markdown), { s, citations, active, onCite }), host);
    return host;
  }

  it('never turns model output into markup', () => {
    const host = renderTo('Hallo <img src=x onerror="alert(1)"> **fett <script>alert(2)</script>**\n\n- <a href="javascript:x">l</a>');
    expect(host.querySelector('img, script, a')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(host.querySelector('strong')?.textContent).toBe('fett <script>alert(2)</script>');
  });

  it('renders known citation markers as buttons and unknown ones as text', () => {
    let clicked: [number, number] | null = null;
    const host = renderTo('Aussage [1] und [7].', null, ((block: number, n: number) => (clicked = [block, n])) as never);
    const button = host.querySelector<HTMLButtonElement>('button.cite')!;
    expect(button.textContent?.trim()).toBe('1');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelectorAll('button.cite')).toHaveLength(1);
    expect(host.querySelector('span.cite.missing')?.textContent).toBe('7');
    button.click();
    expect(clicked).toEqual([0, 1]);
  });

  it('reveals the citation below the block with a safe external link', () => {
    const host = renderTo('Erster [1].\n\nZweiter [1].', { block: 1, n: 1 });
    const cites = host.querySelectorAll('.citation');
    expect(cites).toHaveLength(1);
    expect(cites[0]!.previousElementSibling?.textContent).toContain('Zweiter');
    expect(cites[0]!.querySelector('blockquote')?.textContent).toBe('Zitat <b>');
    expect(cites[0]!.textContent).toContain('18.03.2024');
    const link = cites[0]!.querySelector('a')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(host.querySelectorAll('button.cite')[1]!.getAttribute('aria-expanded')).toBe('true');
  });
});
