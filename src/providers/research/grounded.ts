import type {
  Citation,
  CodeRef,
  LlmProvider,
  ResearchAnswer,
  ResearchOptions,
  ResearchProvider,
  ResearchQuery,
  ResearchSource,
  SourceDocument,
} from '../../core/types.ts';
import { createAnswerStreamFilter, findVerbatim, parseModelOutput, validateAnswer } from './citations.ts';
import { rankPassages } from './passages.ts';
import { groundedSystemPrompt, groundedUserPrompt } from './prompt.ts';
import { analyzeQuestion } from './question.ts';

export interface ResolvedTerm {
  term: string;
  language: string;
  english?: string;
  aliases: string[];
  codes: CodeRef[];
  wikidataId?: string;
}

export type TermResolver = (
  term: string,
  o?: { language?: string; codes?: CodeRef[]; signal?: AbortSignal },
) => Promise<ResolvedTerm>;

export interface GroundedResearchOptions {
  llm: LlmProvider;
  sources: ResearchSource[];
  /**
   * Maps a (German) term to its English name and aliases. Used to recognise the entity in
   * foreign-language passages (ranking) and to tell the model that e.g. dipyrone is Metamizol.
   */
  resolve?: TermResolver;
  id?: string;
  label?: string;
  /** Number of passages handed to the model. Default 8. */
  maxPassages?: number;
  /** Documents requested per source. Default 5. */
  documentsPerSource?: number;
  /** Per-source time limit in ms. Default 20 000. */
  sourceTimeoutMs?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const quoteList = (items: string[]) => items.join(', ');

function linkedSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Zeitüberschreitung')), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Abgebrochen', 'AbortError');
}

export function createGroundedResearch(opts: GroundedResearchOptions): ResearchProvider {
  const { llm, sources, resolve } = opts;
  const maxPassages = opts.maxPassages ?? 8;
  const allLocal = llm.locality === 'local' && sources.every((s) => s.locality === 'local');

  return {
    id: opts.id ?? 'grounded',
    label: opts.label ?? `Quellenrecherche (${llm.label})`,
    locality: allLocal ? 'local' : 'remote',
    description: `Durchsucht ${sources.map((s) => s.label).join(', ') || 'die konfigurierten Quellen'} und lässt ${llm.label} ausschließlich aus den gefundenen Passagen antworten; jede Aussage trägt einen geprüften Quellenverweis. ${
      llm.locality === 'local' ? 'Das Sprachmodell läuft lokal' : 'Frage und Passagen werden an das Sprachmodell übertragen'
    }; Suchbegriffe gehen an die Quellen.`,

    async research(query: ResearchQuery, ro: ResearchOptions = {}): Promise<ResearchAnswer> {
      const language = query.language ?? ro.language ?? 'de';
      const { signal } = ro;
      const progress = (p: Parameters<NonNullable<ResearchOptions['onProgress']>>[0]) => ro.onProgress?.(p);
      const warnings: string[] = [];
      const sourcesSearched = sources.map((s) => s.label);
      const result = (answer: string, grounded: boolean, citations: Citation[] = []): ResearchAnswer => ({
        question: query.question,
        answer,
        citations,
        grounded,
        sourcesSearched,
        provider: opts.id ?? 'grounded',
        ...(warnings.length ? { warnings } : {}),
      });

      // 1. Understand the question ------------------------------------------------------------
      progress({ stage: 'resolving', detail: 'Frage wird analysiert' });
      const analysis = await analyzeQuestion(query.question, query.concept?.label, llm, signal);
      throwIfAborted(signal);
      const resolved: (ResolvedTerm | null)[] = await Promise.all(
        analysis.entities.map(async (entity, i) => {
          if (!resolve) return null;
          try {
            return await resolve(entity, { language, codes: i === 0 ? query.concept?.codes : undefined, signal });
          } catch {
            return null; // resolving is an enrichment; the search still runs with the raw term
          }
        }),
      );
      throwIfAborted(signal);
      const describe = (entity: string, r: ResolvedTerm | null | undefined) => {
        const extra = [
          r?.english && r.english.toLowerCase() !== entity.toLowerCase() ? `engl. ${r.english}` : '',
          r?.aliases.length ? `auch: ${r.aliases.slice(0, 4).join(', ')}` : '',
        ].filter(Boolean);
        return extra.length ? `${entity} (${extra.join('; ')})` : entity;
      };
      const entityNote = analysis.entities.map((e, i) => describe(e, resolved[i])).join(' · ');
      progress({
        stage: 'resolving',
        detail: [entityNote ? `Begriff: ${entityNote}` : '', analysis.aspect ? `Aspekt: ${analysis.aspect.de}` : '']
          .filter(Boolean)
          .join(' · ') || 'Kein Schlüsselbegriff erkannt – Suche mit der ganzen Frage',
      });

      // 2. Search all sources in parallel ------------------------------------------------------
      // Sources receive the question as asked: they detect the topic and translate terms
      // themselves. Only an entity the model had to extract from a long question is added, since
      // a source's own keyword heuristics would not find it either.
      const sourceQuery: ResearchQuery = {
        question: query.question,
        language,
        ...(query.concept
          ? { concept: query.concept }
          : analysis.via === 'llm' && analysis.entities[0]
            ? {
                concept: {
                  conceptId: resolved[0]?.wikidataId ? `wikidata:${resolved[0].wikidataId}` : `term:${analysis.entities[0]}`,
                  label: analysis.entities[0],
                  type: 'other' as const,
                  ...(resolved[0]?.codes.length ? { codes: resolved[0].codes } : {}),
                },
              }
            : {}),
      };

      progress({ stage: 'searching', detail: `${plural(sources.length, 'Quelle', 'Quellen')} werden durchsucht` });
      const found: { doc: SourceDocument; sourceLabel: string }[][] = await Promise.all(
        sources.map(async (source) => {
          const linked = linkedSignal(signal, opts.sourceTimeoutMs ?? 45_000);
          try {
            const docs = await Promise.race([
              source.search(sourceQuery, { signal: linked.signal, language, limit: opts.documentsPerSource ?? 5 }),
              // Sources that ignore the signal must not stall the whole pipeline.
              new Promise<never>((_, reject) =>
                linked.signal.addEventListener('abort', () => reject(linked.signal.reason), { once: true }),
              ),
            ]);
            const usable = docs.filter((d) => d.passages.some((p) => p.text.trim()));
            progress({ stage: 'searching', detail: `${source.label}: ${plural(usable.length, 'Dokument', 'Dokumente')}` });
            return usable.map((doc) => ({ doc, sourceLabel: source.label }));
          } catch (error) {
            if (signal?.aborted) throw error;
            const reason = error instanceof Error ? error.message : String(error);
            warnings.push(`${source.label}: Suche fehlgeschlagen (${reason}).`);
            progress({ stage: 'searching', detail: `${source.label}: nicht erreichbar` });
            return [];
          } finally {
            linked.dispose();
          }
        }),
      );
      throwIfAborted(signal);
      const docs = found.flat();
      const searchedNote = sourcesSearched.length ? ` (${quoteList(sourcesSearched)})` : '';

      // No retrieval, no answer: the model is never asked to answer from memory.
      if (!docs.length) {
        const failed = warnings.length && warnings.length === sources.length;
        return result(
          sources.length === 0
            ? 'Es sind keine Quellen für die Recherche konfiguriert. Es wird bewusst keine Antwort aus dem Modellwissen erzeugt.'
            : failed
              ? `Die Quellen${searchedNote} waren nicht erreichbar. Es wird bewusst keine Antwort aus dem Modellwissen erzeugt.`
              : `Zu „${query.question}“ wurde in den durchsuchten Quellen${searchedNote} nichts gefunden. Es wird bewusst keine Antwort aus dem Modellwissen erzeugt.`,
          false,
        );
      }

      // 3. Select passages and ask the model ---------------------------------------------------
      const entityNames = analysis.entities.flatMap((e, i) => [
        e,
        ...(resolved[i]?.english ? [resolved[i]!.english!] : []),
        ...(resolved[i]?.aliases.slice(0, 8) ?? []),
      ]);
      const passages = rankPassages({ docs, question: query.question, entityNames, aspect: analysis.aspect, maxPassages });
      progress({
        stage: 'reading',
        detail: `${plural(passages.length, 'Passage', 'Passagen')} aus ${plural(new Set(passages.map((p) => p.doc)).size, 'Dokument', 'Dokumenten')} ausgewählt`,
      });

      const filter = createAnswerStreamFilter((delta) => progress({ stage: 'answering', delta }));
      progress({ stage: 'answering', detail: `${llm.label} formuliert die Antwort` });
      const { text: raw } = await llm.complete({
        system: groundedSystemPrompt(language),
        messages: [
          {
            role: 'user',
            content: groundedUserPrompt({ question: query.question, passages, entityNote, aspectNote: analysis.aspect?.de }),
          },
        ],
        signal,
        onToken: (delta) => filter.push(delta),
      });
      filter.end();

      // 4. Validate ------------------------------------------------------------------------------
      const parsed = parseModelOutput(raw);
      const validated = validateAnswer(parsed.answer, passages.length);
      if (validated.invalid.length) {
        warnings.push(`Verweise auf nicht vorhandene Passagen wurden entfernt: ${validated.invalid.map((n) => `[${n}]`).join(', ')}.`);
      }
      if (validated.removed) {
        warnings.push(`${plural(validated.removed, 'Aussage', 'Aussagen')} ohne Quellenbeleg ${validated.removed === 1 ? 'wurde' : 'wurden'} entfernt.`);
      }
      if (!validated.used.length) {
        const note = `Die durchsuchten Quellen${searchedNote} enthalten keine belegbare Antwort auf die Frage „${query.question}“.`;
        return result(validated.text ? `${validated.text}\n\n${note}` : note, false);
      }

      const withoutQuote: number[] = [];
      const citations: Citation[] = validated.used.map((n, i) => {
        const passage = passages[n - 1]!;
        const claimed = parsed.quotes.get(n) ?? [];
        let quote: string | undefined;
        for (const candidate of claimed) {
          quote = findVerbatim(passage.text, candidate) ?? undefined;
          if (quote) break;
        }
        if (!quote) {
          if (claimed.length) {
            warnings.push(`Quelle [${i + 1}]: Das vom Modell angegebene Zitat steht nicht wörtlich in der Passage und wurde verworfen.`);
          } else {
            withoutQuote.push(i + 1);
          }
        }
        return {
          index: i + 1,
          title: passage.heading ? `${passage.doc.title} – ${passage.heading}` : passage.doc.title,
          url: passage.doc.url,
          source: passage.doc.publisher ?? passage.sourceLabel,
          ...(quote ? { quote } : {}),
          ...(passage.doc.date ? { date: passage.doc.date } : {}),
        };
      });
      if (withoutQuote.length) {
        warnings.push(`Kein wörtlicher Beleg vom Modell geliefert für ${withoutQuote.map((n) => `[${n}]`).join(', ')}; der Verweis auf die Passage bleibt bestehen.`);
      }
      return result(validated.text, true, citations);
    },
  };
}
