import type { LlmProvider, LlmRequest, Locality } from '../../core/types.ts';
import { readSse } from './sse.ts';

export interface OpenAiCompatibleLlmOptions {
  /** Up to and including the version segment, e.g. `http://localhost:11434/v1` or `/api/openai`. */
  baseUrl: string;
  apiKey?: string;
  model: string;
  id?: string;
  label?: string;
  /** Default: `local` for loopback hosts, otherwise `remote`. Set it when an on-prem host is not loopback. */
  locality?: Locality;
  /** Newer OpenAI models reject `max_tokens`; local servers mostly only know `max_tokens`. */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  fetch?: typeof fetch;
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null }; message?: { content?: string | null } }[];
  error?: { message?: string } | string;
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url, 'http://remote.invalid').hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\./.test(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path;
}

export async function httpError(response: Response, what: string): Promise<Error> {
  let detail = '';
  try {
    const body = await response.text();
    try {
      const json = JSON.parse(body) as { error?: { message?: string } | string };
      detail = typeof json.error === 'string' ? json.error : (json.error?.message ?? '');
    } catch {
      detail = body;
    }
  } catch {
    // body unreadable – status is all we have
  }
  const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
  return new Error(`${what}: HTTP ${response.status}${suffix}`);
}

export function createOpenAiCompatibleLlm(opts: OpenAiCompatibleLlmOptions): LlmProvider {
  const locality = opts.locality ?? (isLoopbackUrl(opts.baseUrl) ? 'local' : 'remote');
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? globalThis.fetch)(input, init);

  return {
    id: opts.id ?? 'openai-compatible',
    label: opts.label ?? opts.model,
    locality,
    description:
      locality === 'local'
        ? `Lokales Modell „${opts.model}“ über eine OpenAI-kompatible Schnittstelle (z. B. Ollama, LM Studio, vLLM). Texte verlassen das Gerät bzw. das eigene Netz nicht.`
        : `Modell „${opts.model}“ über eine OpenAI-kompatible Schnittstelle. Texte werden an den Anbieter unter ${hostOf(opts.baseUrl)} übertragen.`,

    async complete(request: LlmRequest): Promise<{ text: string }> {
      const messages = [
        ...(request.system ? [{ role: 'system', content: request.system }] : []),
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      const response = await doFetch(joinUrl(opts.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          stream: true,
          ...(request.maxTokens ? { [opts.maxTokensParam ?? 'max_tokens']: request.maxTokens } : {}),
        }),
        signal: request.signal,
      });
      if (!response.ok) throw await httpError(response, `LLM-Anfrage an ${hostOf(opts.baseUrl)} fehlgeschlagen`);

      // Servers that ignore `stream: true` answer with one JSON document.
      if (!response.body || /application\/json/i.test(response.headers.get('content-type') ?? '')) {
        const json = (await response.json()) as ChatChunk;
        const text = json.choices?.[0]?.message?.content ?? '';
        if (text) request.onToken?.(text);
        return { text };
      }

      let text = '';
      for await (const data of readSse(response.body)) {
        if (data === '[DONE]') break;
        let chunk: ChatChunk;
        try {
          chunk = JSON.parse(data) as ChatChunk;
        } catch {
          continue; // keep-alive comments or partial junk from lenient servers
        }
        if (chunk.error) {
          const message = typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? 'unbekannt');
          throw new Error(`LLM-Fehler: ${message}`);
        }
        // Reasoning models stream their thinking in separate fields (`reasoning`,
        // `reasoning_content`); only `content` is the answer.
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          request.onToken?.(delta);
        }
      }
      return { text };
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url, (globalThis as { location?: { href?: string } }).location?.href ?? 'http://localhost').host;
  } catch {
    return url;
  }
}
