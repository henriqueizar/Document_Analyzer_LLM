import { LlmService } from './llm.service';

const ok = (content: string) =>
  new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status: 200 });

describe('LlmService', () => {
  const fetchMock = jest.fn();
  const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('uses qwen3:8b by default', () => {
    expect(new LlmService().model).toBe('qwen3:8b');
  });

  it('explainDocument sends the text deterministically (temperature 0)', async () => {
    fetchMock.mockResolvedValue(ok('summary'));
    await expect(new LlmService().explainDocument('INVOICE 4711')).resolves.toBe('summary');
    expect(sent().options.temperature).toBe(0);
    expect(sent().messages.at(-1).content).toContain('INVOICE 4711');
  });

  it('removes filler the model adds before the explanation', async () => {
    fetchMock.mockResolvedValue(
      ok("Sure, here's the explanation of the document in 3 paragraphs:\n\nACME billed $42."),
    );
    await expect(new LlmService().explainDocument('x')).resolves.toBe('ACME billed $42.');
  });

  it('askQuestion includes document and question with a low temperature', async () => {
    fetchMock.mockResolvedValue(ok('42'));
    await expect(new LlmService().askQuestion('TOTAL 42', 'What is the total?')).resolves.toBe('42');
    expect(sent().options.temperature).toBeLessThanOrEqual(0.2);
    expect(sent().messages.at(-1).content).toContain('TOTAL 42');
    expect(sent().messages.at(-1).content).toContain('What is the total?');
  });

  it('propagates LLM failures instead of returning them as answers', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(new LlmService().askQuestion('a', 'b')).rejects.toThrow(/LLM unavailable/);
  });
});
