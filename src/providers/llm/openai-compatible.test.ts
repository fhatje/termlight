// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createOpenAiCompatibleLlm } from './index.ts';
import { readSse } from './sse.ts';

function streamOf(parts: string[], contentType = 'text/event-stream'): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('readSse', () => {
  it('reassembles events split across network chunks and tolerates CRLF and a missing final blank line', async () => {
    const res = streamOf(['data: {"a"', ':1}\r\n\r\n: comment\n\nda', 'ta: two\n\ndata: [DONE]']);
    const out: string[] = [];
    for await (const data of readSse(res.body!)) out.push(data);
    expect(out).toEqual(['{"a":1}', 'two', '[DONE]']);
  });
});

describe('createOpenAiCompatibleLlm', () => {
  it('streams chat completions and sends the expected request', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      const [first, second] = [chunk('Hal'), chunk('lo')];
      // split inside an event and emit a reasoning-only delta that must be ignored
      return streamOf([
        first.slice(0, 20),
        first.slice(20) + `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'hm' } }] })}\n\n`,
        second,
        'data: [DONE]\n\n',
      ]);
    }) as unknown as typeof globalThis.fetch;
    const llm = createOpenAiCompatibleLlm({ baseUrl: 'http://localhost:11434/v1/', model: 'qwen', fetch });
    const tokens: string[] = [];
    const result = await llm.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 50,
      onToken: (t) => tokens.push(t),
    });

    expect(result.text).toBe('Hallo');
    expect(tokens).toEqual(['Hal', 'lo']);
    expect(seen!.url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(seen!.init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'qwen',
      stream: true,
      max_tokens: 50,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect((seen!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('infers locality from the host and lets the caller override it', () => {
    const make = (baseUrl: string, locality?: 'local' | 'remote') =>
      createOpenAiCompatibleLlm({ baseUrl, model: 'm', locality }).locality;
    expect(make('http://localhost:11434/v1')).toBe('local');
    expect(make('http://127.0.0.1:1234/v1')).toBe('local');
    expect(make('https://api.openai.com/v1')).toBe('remote');
    expect(make('/api/openai')).toBe('remote');
    expect(make('http://llm.klinik.intern/v1', 'local')).toBe('local');
  });

  it('accepts a non-streaming JSON answer', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ganz' } }] }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch;
    const llm = createOpenAiCompatibleLlm({ baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm', fetch });
    expect((await llm.complete({ messages: [{ role: 'user', content: 'hi' }] })).text).toBe('ganz');
  });

  it('surfaces HTTP errors with the server message', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 })) as unknown as typeof globalThis.fetch;
    const llm = createOpenAiCompatibleLlm({ baseUrl: 'http://localhost:1/v1', model: 'm', fetch });
    await expect(llm.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/HTTP 404: model not found/);
  });
});
