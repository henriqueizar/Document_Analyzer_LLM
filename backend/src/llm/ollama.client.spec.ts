import { ServiceUnavailableException } from '@nestjs/common';
import { OllamaClient, ollamaConfigFromEnv, stripThinking } from './ollama.client';

const ok = (content: string) =>
  new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status: 200 });

describe('ollamaConfigFromEnv', () => {
  it('defaults to native Ollama on localhost with qwen3:8b and an 8k context', () => {
    expect(ollamaConfigFromEnv({})).toMatchObject({
      baseUrl: 'http://localhost:11434',
      model: 'qwen3:8b',
      numCtx: 8192,
    });
  });

  it('accepts the old OpenAI-style LLM_BASE_URL and strips /v1', () => {
    expect(ollamaConfigFromEnv({ LLM_BASE_URL: 'http://localhost:11434/v1' }).baseUrl).toBe(
      'http://localhost:11434',
    );
  });

  it('reads OLLAMA_URL, LLM_MODEL and LLM_NUM_CTX', () => {
    expect(
      ollamaConfigFromEnv({ OLLAMA_URL: 'http://gpu-box:11434/', LLM_MODEL: 'gemma3:4b', LLM_NUM_CTX: '16384' }),
    ).toMatchObject({ baseUrl: 'http://gpu-box:11434', model: 'gemma3:4b', numCtx: 16384 });
  });
});

describe('OllamaClient', () => {
  const fetchMock = jest.fn();
  const client = new OllamaClient({ baseUrl: 'http://ollama', model: 'qwen3:8b', numCtx: 8192, timeoutMs: 1000 });

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('calls the native chat API with num_ctx, temperature and thinking disabled', async () => {
    fetchMock.mockResolvedValue(ok('answer'));
    await expect(
      client.chat([{ role: 'user', content: 'hi' }], { temperature: 0, maxTokens: 100 }),
    ).resolves.toBe('answer');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ollama/api/chat');
    expect(JSON.parse(init.body)).toEqual({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      think: false,
      options: { num_ctx: 8192, temperature: 0, num_predict: 100 },
    });
  });

  it('removes <think> blocks if the model still emits them', async () => {
    fetchMock.mockResolvedValue(ok('<think>reasoning</think>\nThe total is 42.'));
    await expect(client.chat([], { temperature: 0, maxTokens: 10 })).resolves.toBe('The total is 42.');
  });

  it('retries without `think` when the server rejects it', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":"think value not supported"}', { status: 400 }))
      .mockResolvedValueOnce(ok('fine'));
    await expect(client.chat([], { temperature: 0, maxTokens: 10 })).resolves.toBe('fine');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('think');
  });

  it('explains how to install a missing model', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"model not found"}', { status: 404 }));
    const call = client.chat([], { temperature: 0, maxTokens: 10 });
    await expect(call).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(call).rejects.toThrow(/ollama pull qwen3:8b/);
  });

  it('says when Ollama is not running', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.chat([], { temperature: 0, maxTokens: 10 })).rejects.toThrow(
      /not reachable at http:\/\/ollama/,
    );
  });
});

describe('stripThinking', () => {
  it('keeps text without think blocks unchanged', () => {
    expect(stripThinking('plain')).toBe('plain');
  });
});
