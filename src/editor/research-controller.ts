import type { ConceptRef, ResearchAnswer, ResearchProgress, ResearchProvider } from '../core/types.ts';
import { errorMessage } from './text-utils.ts';

export interface ResearchStageLog {
  stage: ResearchProgress['stage'];
  details: string[];
}

export interface ResearchHistoryItem {
  question: string;
  concept: ConceptRef | null;
  answer: ResearchAnswer;
}

export interface ResearchHost {
  provider(): ResearchProvider | undefined;
  language(): string | undefined;
  /** Something visible changed. */
  changed(): void;
  /** A run finished with an answer. */
  answered(answer: ResearchAnswer): void;
}

export const HISTORY_LIMIT = 8;

/** State machine of the research panel; knows nothing about the DOM. */
export class ResearchController {
  question = '';
  concept: ConceptRef | null = null;
  status: 'idle' | 'running' | 'done' | 'error' = 'idle';
  stages: ResearchStageLog[] = [];
  /** Answer text streamed so far. */
  streamed = '';
  answer: ResearchAnswer | null = null;
  error = '';
  cancelled = false;
  history: ResearchHistoryItem[] = [];

  private readonly host: ResearchHost;
  private controller: AbortController | null = null;
  private runId = 0;

  constructor(host: ResearchHost) {
    this.host = host;
  }

  get running(): boolean {
    return this.status === 'running';
  }

  setConcept(concept: ConceptRef | null): void {
    this.concept = concept;
    this.host.changed();
  }

  /** Back to the empty question form (keeps the history). */
  reset(): void {
    this.cancel(false);
    this.status = 'idle';
    this.question = '';
    this.answer = null;
    this.error = '';
    this.streamed = '';
    this.stages = [];
    this.cancelled = false;
    this.host.changed();
  }

  cancel(markCancelled = true): void {
    if (!this.controller) return;
    this.runId++;
    this.controller.abort();
    this.controller = null;
    this.status = 'idle';
    this.cancelled = markCancelled;
    this.streamed = '';
    this.stages = [];
    this.host.changed();
  }

  show(item: ResearchHistoryItem): void {
    this.cancel(false);
    this.question = item.question;
    this.concept = item.concept;
    this.answer = item.answer;
    this.status = 'done';
    this.error = '';
    this.cancelled = false;
    this.host.changed();
  }

  async ask(question: string): Promise<void> {
    const trimmed = question.trim();
    const provider = this.host.provider();
    if (!trimmed || !provider) return;
    this.cancel(false);
    const runId = ++this.runId;
    const controller = new AbortController();
    this.controller = controller;
    this.question = trimmed;
    this.status = 'running';
    this.answer = null;
    this.error = '';
    this.cancelled = false;
    this.streamed = '';
    this.stages = [];
    this.host.changed();

    const concept = this.concept;
    const language = this.host.language();
    try {
      const answer = await provider.research(
        { question: trimmed, ...(concept ? { concept } : {}), ...(language ? { language } : {}) },
        {
          signal: controller.signal,
          ...(language ? { language } : {}),
          onProgress: (progress) => {
            if (runId === this.runId) this.progress(progress);
          },
        },
      );
      if (runId !== this.runId) return;
      this.controller = null;
      this.answer = answer;
      this.status = 'done';
      this.history = [
        { question: trimmed, concept, answer },
        ...this.history.filter((h) => h.question !== trimmed),
      ].slice(0, HISTORY_LIMIT);
      this.host.changed();
      this.host.answered(answer);
    } catch (error) {
      // After cancel() the run id moved on; a late AbortError must not overwrite the idle state.
      if (runId !== this.runId) return;
      this.controller = null;
      this.status = 'error';
      this.error = errorMessage(error);
      this.host.changed();
    }
  }

  private progress(progress: ResearchProgress): void {
    let last = this.stages[this.stages.length - 1];
    if (!last || last.stage !== progress.stage) {
      last = { stage: progress.stage, details: [] };
      this.stages.push(last);
    }
    if (progress.detail && last.details[last.details.length - 1] !== progress.detail) last.details.push(progress.detail);
    if (progress.delta) this.streamed += progress.delta;
    this.host.changed();
  }
}
