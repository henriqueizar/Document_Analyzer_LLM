import { LlmService } from './llm.service';

const ok = (content: string) =>
  new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status: 200 });

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Parágrafo ${i} com disposições gerais e obrigações recíprocas das partes.`).join('\n\n');

const contract = {
  name: 'contrato.pdf',
  text: [
    '--- Page 1 ---',
    'CONTRATO DE PRESTAÇÃO DE SERVIÇOS entre ACME Ltda. e Beta S.A.',
    '--- Page 2 ---',
    'CLÁUSULA 3 - DO PREÇO. O valor mensal é de R$ 12.500,00.',
    '--- Page 3 ---',
    'CLÁUSULA 8 - DA RESCISÃO. Aviso prévio de 60 dias.',
  ].join('\n'),
};

describe('LlmService', () => {
  const fetchMock = jest.fn();
  const sent = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);
  const system = () => sent().messages[0].content as string;
  const lastUser = () => sent().messages.at(-1).content as string;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.LLM_NUM_CTX;
  });

  it('uses qwen3:8b by default', () => {
    expect(new LlmService().model).toBe('qwen3:8b');
  });

  describe('askQuestion', () => {
    it('answers in Portuguese with Portuguese-only instructions for a Portuguese question', async () => {
      fetchMock.mockResolvedValue(ok('O valor mensal é de R$ 12.500,00 [p. 2].'));
      const answer = await new LlmService().askQuestion(contract, 'Qual é o valor mensal?');

      expect(answer).toBe('O valor mensal é de R$ 12.500,00 [p. 2].');
      expect(system()).toMatch(/Use SOMENTE as informações dos trechos/);
      expect(system()).toMatch(/Não encontrei essa informação no documento\./);
      expect(system()).not.toMatch(/\b(the|answer|document does not)\b/i);
      expect(system()).toMatch(/<documento nome="contrato.pdf">/);
      expect(system()).toMatch(/\[p\. 2\]\nCLÁUSULA 3/);
      expect(lastUser()).toBe('Pergunta: Qual é o valor mensal?');
      expect(sent().options.temperature).toBe(0);
    });

    it('uses English instructions for an English question', async () => {
      fetchMock.mockResolvedValue(ok('60 days [p. 3].'));
      await new LlmService().askQuestion(contract, 'What is the termination notice period?');
      expect(system()).toMatch(/Use ONLY the information/);
      expect(lastUser()).toMatch(/^Question: What is the termination/);
    });

    it('accepts the fixed "not found" answer without a warning', async () => {
      fetchMock.mockResolvedValue(ok('Não encontrei essa informação no documento.'));
      await expect(
        new LlmService().askQuestion(contract, 'Qual é a capital da França?'),
      ).resolves.toBe('Não encontrei essa informação no documento.');
    });

    it('reduces a refusal with extra words to the standard sentence', async () => {
      fetchMock.mockResolvedValue(
        ok('A multa para atraso no pagamento não está especificada no documento. Não encontrei essa informação no documento.'),
      );
      await expect(
        new LlmService().askQuestion(contract, 'Qual é a multa por atraso?'),
      ).resolves.toBe('Não encontrei essa informação no documento.');
    });

    it('keeps partial answers that cite pages even if they also say something was not found', async () => {
      const partial = 'O valor mensal é de R$ 12.500,00 [p. 2]. Não encontrei essa informação no documento quanto ao CNPJ.';
      fetchMock.mockResolvedValue(ok(partial));
      await expect(
        new LlmService().askQuestion(contract, 'Qual o valor mensal e o CNPJ?'),
      ).resolves.toBe(partial);
    });

    it('flags numbers that are not in the document', async () => {
      fetchMock.mockResolvedValue(ok('O valor mensal é de R$ 15.000,00 [p. 2].'));
      const answer = await new LlmService().askQuestion(contract, 'Qual é o valor mensal?');
      expect(answer).toMatch(/⚠ Verificação automática: a resposta contém 15.000,00, que não aparece no documento/);
    });

    it('flags answers without any page citation', async () => {
      fetchMock.mockResolvedValue(ok('O contrato é entre ACME e Beta.'));
      const answer = await new LlmService().askQuestion(contract, 'Quem são as partes?');
      expect(answer).toMatch(/não cita nenhuma página/);
    });

    it('does not flag numbers that come from the question itself', async () => {
      fetchMock.mockResolvedValue(ok('A cláusula 8 trata da rescisão, com aviso prévio de 60 dias [p. 3].'));
      const answer = await new LlmService().askQuestion(contract, 'O que diz a cláusula 8?');
      expect(answer).not.toMatch(/⚠/);
    });

    it('sends recent history as earlier turns and uses it to find passages', async () => {
      fetchMock.mockResolvedValue(ok('Aviso prévio de 60 dias [p. 3].'));
      await new LlmService().askQuestion(contract, 'E qual o prazo?', [
        { question: 'O que diz a cláusula de rescisão?', answer: 'Trata da rescisão [p. 3].' },
      ]);
      const roles = sent().messages.map((m: { role: string }) => m.role);
      expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    });

    it('keeps the document at the start of the prompt so follow-ups can reuse it', async () => {
      fetchMock.mockImplementation(async () => ok('R$ 12.500,00 [p. 2].'));
      const service = new LlmService();
      await service.askQuestion(contract, 'Qual é o valor mensal?');
      await service.askQuestion(contract, 'E o reajuste?', [
        { question: 'Qual é o valor mensal?', answer: 'R$ 12.500,00 [p. 2].' },
      ]);
      // Same system message (rules + document) for both: the expensive prefix is shared.
      expect(sent(1).messages[0]).toEqual(sent(0).messages[0]);
      expect(sent(1).messages[0].content).toMatch(/<documento/);
    });

    it('sends only the relevant passages of a long document, with their pages', async () => {
      process.env.LLM_NUM_CTX = '2600'; // tiny context to force selection
      const long = {
        name: 'longo.pdf',
        text: [
          '--- Page 1 ---', filler(25),
          '--- Page 2 ---', 'CLÁUSULA 3 - DO PREÇO. O valor mensal é de R$ 12.500,00.', filler(25),
          '--- Page 3 ---', filler(25),
          '--- Page 4 ---', 'CLÁUSULA 9 - DO FORO. Foro da Comarca de Brasília.', filler(25),
        ].join('\n'),
      };
      fetchMock.mockResolvedValue(ok('Comarca de Brasília [p. 4].'));
      await new LlmService().askQuestion(long, 'Qual é o foro do contrato?');
      expect(system()).toMatch(/Comarca de Brasília/);
      expect(system()).toMatch(/seleção do documento \(páginas .*4.* de 4\)/);
      expect(system()).not.toMatch(/R\$ 12\.500,00/);
    });
  });

  describe('explainDocument', () => {
    it('explains in the document language and removes filler', async () => {
      fetchMock.mockResolvedValue(
        ok("Sure, here's the explanation:\n\nContrato de serviços entre ACME e Beta [p. 1]."),
      );
      const explanation = await new LlmService().explainDocument(contract);
      expect(explanation).toBe('Contrato de serviços entre ACME e Beta [p. 1].');
      expect(system()).toMatch(/Você resume documentos/);
    });

    it('adds a note (written by code) when only part of a long document was read', async () => {
      process.env.LLM_NUM_CTX = '2400';
      const long = {
        name: 'longo.pdf',
        text: ['--- Page 1 ---', filler(30), '--- Page 2 ---', filler(30), '--- Page 3 ---', filler(30)].join('\n'),
      };
      fetchMock.mockResolvedValue(ok('Documento com disposições gerais [p. 1].'));
      const explanation = await new LlmService().explainDocument(long);
      expect(explanation).toMatch(/\(Explicação baseada nas páginas 1(–\d)? de 3\./);
    });
  });

  it('propagates LLM failures instead of returning them as answers', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(new LlmService().askQuestion(contract, 'b')).rejects.toThrow(/LLM unavailable/);
  });
});
