import { DEFAULT_LLM_MODEL, LlmService } from './llm.service';

const create = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((options) => ({
    options,
    chat: { completions: { create } },
  })),
}));

const reply = (content: string | null) => ({ choices: [{ message: { content } }] });

describe('LlmService', () => {
  const env = { ...process.env };

  beforeEach(() => {
    create.mockReset();
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });
  afterAll(() => {
    process.env = env;
  });

  it('defaults to a local Ollama endpoint and the default model', () => {
    const service = new LlmService();
    expect(service.model).toBe(DEFAULT_LLM_MODEL);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).client.options.baseURL).toBe('http://localhost:11434/v1');
  });

  it('reads base URL and model from the environment', () => {
    process.env.LLM_BASE_URL = 'http://host.docker.internal:11434/v1';
    process.env.LLM_MODEL = 'qwen2:0.5b';
    const service = new LlmService();
    expect(service.model).toBe('qwen2:0.5b');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).client.options.baseURL).toBe('http://host.docker.internal:11434/v1');
  });

  it('explainDocument sends the text deterministically (temperature 0)', async () => {
    create.mockResolvedValue(reply('summary'));
    const service = new LlmService();
    await expect(service.explainDocument('INVOICE 4711')).resolves.toBe('summary');

    const request = create.mock.calls[0][0];
    expect(request.model).toBe(DEFAULT_LLM_MODEL);
    expect(request.temperature).toBe(0);
    expect(request.messages.at(-1).content).toContain('INVOICE 4711');
  });

  it('askQuestion includes document and question with a low temperature', async () => {
    create.mockResolvedValue(reply('42'));
    const service = new LlmService();
    await expect(service.askQuestion('TOTAL 42', 'What is the total?')).resolves.toBe('42');

    const request = create.mock.calls[0][0];
    expect(request.temperature).toBeLessThanOrEqual(0.2);
    expect(request.messages.at(-1).content).toContain('TOTAL 42');
    expect(request.messages.at(-1).content).toContain('What is the total?');
  });

  it('every request uses a temperature within a sane range', async () => {
    create.mockResolvedValue(reply('x'));
    const service = new LlmService();
    await service.explainDocument('a');
    await service.askQuestion('a', 'b');
    for (const [request] of create.mock.calls) {
      expect(request.temperature).toBeGreaterThanOrEqual(0);
      expect(request.temperature).toBeLessThanOrEqual(1);
    }
  });
});
