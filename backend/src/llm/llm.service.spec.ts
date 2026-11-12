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
      const { text: answer } = await new LlmService().askQuestion(contract, 'Qual é o valor mensal?');

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
        new LlmService().askQuestion(contract, 'Qual é a capital da França?').then((r) => r.text),
      ).resolves.toBe('Não encontrei essa informação no documento.');
    });

    it('reduces a refusal with extra words to the standard sentence', async () => {
      fetchMock.mockResolvedValue(
        ok('A multa para atraso no pagamento não está especificada no documento. Não encontrei essa informação no documento.'),
      );
      await expect(
        new LlmService().askQuestion(contract, 'Qual é a multa por atraso?').then((r) => r.text),
      ).resolves.toBe('Não encontrei essa informação no documento.');
    });

    it('keeps partial answers that cite pages even if they also say something was not found', async () => {
      const partial = 'O valor mensal é de R$ 12.500,00 [p. 2]. Não encontrei essa informação no documento quanto ao CNPJ.';
      fetchMock.mockResolvedValue(ok(partial));
      await expect(
        new LlmService().askQuestion(contract, 'Qual o valor mensal e o CNPJ?').then((r) => r.text),
      ).resolves.toBe(partial);
    });

    it('flags numbers that are not in the document', async () => {
      fetchMock.mockResolvedValue(ok('O valor mensal é de R$ 15.000,00 [p. 2].'));
      const { text: answer } = await new LlmService().askQuestion(contract, 'Qual é o valor mensal?');
      expect(answer).toMatch(/⚠ Verificação automática: a resposta contém 15.000,00, que não aparece no documento/);
    });

    it('cites by code an uncited answer that clearly comes from the document', async () => {
      fetchMock.mockResolvedValue(ok('O contrato é entre ACME e Beta.'));
      const { text: answer } = await new LlmService().askQuestion(contract, 'Quem são as partes?');
      expect(answer).toBe('O contrato é entre ACME e Beta [p. 1].');
    });

    it.each([
      ['small talk', 'oi tudo bem?', 'Tudo bem! E com você?'],
      ['questions about the assistant', 'Quantos anos você tem?', 'Tenho 3 anos de idade.'],
      ['judgements the document does not state', 'Este contrato é vantajoso?', 'Sim, é um bom negócio para a ACME.'],
    ])('strict mode: replaces an answer not tied to the document (%s) by the refusal', async (_, q, invented) => {
      fetchMock.mockResolvedValue(ok(invented));
      const { text } = await new LlmService().askQuestion(contract, q);
      expect(text).toBe('Não encontrei essa informação no documento.');
    });

    it.each([
      ['picking an option of an exercise', 'Qual a resposta da questão 3?', 'A resposta da questão 3 é: "B. aviso prévio de 60 dias" [p. 3].'],
      ['judging the contract', 'Esse prazo é bom?', 'O prazo de 60 dias é razoável [p. 3].'],
    ])('strict mode: replaces a judgement the document does not make (%s), even when cited', async (_, q, judged) => {
      fetchMock.mockResolvedValue(ok(judged));
      const { text } = await new LlmService().askQuestion(contract, q);
      expect(text).toBe('Não encontrei essa informação no documento.');
    });

    it('interpretation mode keeps judgements (they are labelled by the app)', async () => {
      fetchMock.mockResolvedValue(ok('No documento: aviso prévio de 60 dias [p. 3].\n\nInterpretação: o prazo é razoável.'));
      const { text } = await new LlmService().askQuestion(contract, 'Esse prazo é bom?', [], 'INTERPRETATION');
      expect(text).toMatch(/o prazo é razoável/);
    });

    it('strict mode: tells the model not to pick exercise answers, judge or chat', async () => {
      fetchMock.mockResolvedValue(ok('x [p. 1].'));
      await new LlmService().askQuestion(contract, 'Qual a resposta correta da questão 24?');
      expect(system()).toMatch(/Não escolha a resposta de questões ou exercícios/);
      expect(system()).toMatch(/cumprimentos, conversa e perguntas sobre você/);
    });

    it('interpretation mode: uses its own rules and keeps an analysis, with the usual checks', async () => {
      fetchMock.mockResolvedValue(
        ok('No documento: aviso prévio de 60 dias [p. 3].\n\nInterpretação: o prazo é longo para a contratante.'),
      );
      const { text } = await new LlmService().askQuestion(contract, 'O prazo de rescisão é bom para nós?', [], 'INTERPRETATION');
      expect(system()).toMatch(/pediu explicitamente uma INTERPRETAÇÃO/);
      expect(system()).toMatch(/"No documento:"/);
      expect(text).toMatch(/^No documento: aviso prévio de 60 dias \[p\. 3\]\./);
      expect(text).toMatch(/Interpretação: o prazo é longo/);
      expect(text).not.toMatch(/⚠/);
    });

    it('interpretation mode still refuses small talk', async () => {
      fetchMock.mockResolvedValue(ok('Não encontrei essa informação no documento.'));
      const { text } = await new LlmService().askQuestion(contract, 'oi tudo bem?', [], 'INTERPRETATION');
      expect(text).toBe('Não encontrei essa informação no documento.');
    });

    it('does not flag numbers that come from the question itself', async () => {
      fetchMock.mockResolvedValue(ok('A cláusula 8 trata da rescisão, com aviso prévio de 60 dias [p. 3].'));
      const { text: answer } = await new LlmService().askQuestion(contract, 'O que diz a cláusula 8?');
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

    it('sends the whole conversation when it is short', async () => {
      fetchMock.mockResolvedValue(ok('Aviso prévio de 60 dias [p. 3].'));
      const history = Array.from({ length: 6 }, (_, i) => ({ question: `pergunta ${i}`, answer: `resposta ${i} [p. 1].` }));
      await new LlmService().askQuestion(contract, 'E agora?', history);
      // system + 6 x (user, assistant) + final question
      expect(sent().messages).toHaveLength(1 + 12 + 1);
      expect(sent().messages[1].content).toBe('Pergunta: pergunta 0');
    });

    it('drops the oldest turns first when the conversation exceeds its budget', async () => {
      process.env.LLM_NUM_CTX = '4096'; // history budget ~ 3,000 characters
      fetchMock.mockResolvedValue(ok('ok [p. 1].'));
      const long = 'x'.repeat(600);
      const history = Array.from({ length: 10 }, (_, i) => ({ question: `pergunta ${i}`, answer: long }));
      await new LlmService().askQuestion(contract, 'E agora?', history);
      const questions = sent().messages.filter((m: { role: string }) => m.role === 'user').map((m: { content: string }) => m.content);
      expect(questions.at(-1)).toBe('Pergunta: E agora?');
      expect(questions).toContain('Pergunta: pergunta 9');
      expect(questions).not.toContain('Pergunta: pergunta 0');
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

  describe('language of the reply', () => {
    it('asks again once, with a reminder, when the explanation comes back in English', async () => {
      fetchMock
        .mockResolvedValueOnce(ok('This is a cleaning services contract between ACME and Beta, and the monthly amount is R$ 12.500,00 [p. 2].'))
        .mockResolvedValueOnce(ok('É um contrato de serviços de limpeza entre ACME e Beta, e o valor mensal é de R$ 12.500,00 [p. 2].'));
      const { text } = await new LlmService().explainDocument(contract);
      expect(text).toMatch(/^É um contrato de serviços de limpeza/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1).content).toMatch(
        /IMPORTANTE: escreva toda a resposta em português do Brasil/,
      );
    });

    it('does not ask again when the reply is already in the right language', async () => {
      fetchMock.mockResolvedValue(ok('É um contrato de serviços de limpeza entre ACME e Beta, com valor mensal de R$ 12.500,00 [p. 2].'));
      await new LlmService().explainDocument(contract);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('answers an English question in English, asking again if needed', async () => {
      fetchMock
        .mockResolvedValueOnce(ok('O aviso prévio para rescisão do contrato é de 60 dias, conforme a cláusula oitava [p. 3].'))
        .mockResolvedValueOnce(ok('The termination notice is 60 days, according to the eighth clause of the contract [p. 3].'));
      const { text } = await new LlmService().askQuestion(contract, 'What is the termination notice period?');
      expect(text).toMatch(/^The termination notice is 60 days/);
    });
  });

  describe('explainDocument', () => {
    it('explains in the document language and removes filler', async () => {
      fetchMock.mockResolvedValue(
        ok("Sure, here's the explanation:\n\nContrato de serviços entre ACME e Beta [p. 1]."),
      );
      const { text: explanation } = await new LlmService().explainDocument(contract);
      expect(explanation).toBe('Contrato de serviços entre ACME e Beta [p. 1].');
      expect(system()).toMatch(/Você resume documentos/);
    });

    it('asks for a page citation in every sentence and flags explanations without any', async () => {
      // nothing in the document backs this sentence, so no citation can be attributed
      fetchMock.mockResolvedValue(ok('Documento com disposições variadas e bem organizadas.'));
      const { text: explanation } = await new LlmService().explainDocument(contract);
      expect(system()).toMatch(/No fim de cada frase que traz informação do documento, indique a página/);
      expect(explanation).toMatch(/⚠ Verificação automática: a resposta não cita nenhuma página/);
    });

    it('adds a note (written by code) when only part of a long document was read', async () => {
      process.env.LLM_NUM_CTX = '2400';
      const long = {
        name: 'longo.pdf',
        text: ['--- Page 1 ---', filler(30), '--- Page 2 ---', filler(30), '--- Page 3 ---', filler(30)].join('\n'),
      };
      fetchMock.mockResolvedValue(ok('Documento com disposições gerais [p. 1].'));
      const { text: explanation } = await new LlmService().explainDocument(long);
      expect(explanation).toMatch(/\(Explicação baseada nas páginas 1(–\d)? de 3\./);
    });
  });

  it('propagates LLM failures instead of returning them as answers', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(new LlmService().askQuestion(contract, 'b')).rejects.toThrow(/LLM unavailable/);
  });

  it('returns the passages the model was given as sources, with their pages', async () => {
    fetchMock.mockResolvedValue(ok('O valor mensal é de R$ 12.500,00 [p. 2].'));
    const { sources } = await new LlmService().askQuestion(contract, 'Qual é o valor mensal?');
    expect(sources).toEqual(expect.arrayContaining([expect.objectContaining({ page: 2, text: expect.stringContaining('R$ 12.500,00') })]));
  });

  it('gives each explanation sentence its own citation when the model piles them up', async () => {
    fetchMock.mockResolvedValue(
      ok('Contrato de prestação de serviços entre ACME Ltda. e Beta S.A. O valor mensal é de R$ 12.500,00. [p. 1] [p. 2]'),
    );
    const { text } = await new LlmService().explainDocument(contract);
    expect(text).toBe('Contrato de prestação de serviços entre ACME Ltda. e Beta S.A [p. 1]. O valor mensal é de R$ 12.500,00 [p. 2].');
  });
});
