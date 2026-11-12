import { asksToChooseAnswer, checkGrounding, isNegativeOnly, isNotFound, unsupportedJudgement } from './grounding';

const source = { text: '[p. 2]\nO valor mensal é de R$ 12.500,00, reajuste de 4,5% em 01/03/2027.', pages: [2] };
const check = (answer: string, requireCitation = true) =>
  checkGrounding(answer, source, 'pt', { requireCitation });

describe('checkGrounding', () => {
  it('accepts an answer whose numbers and citations come from the source', () => {
    expect(check('Valor mensal de R$ 12.500,00, com reajuste de 4,5% em 01/03/2027 [p. 2].').ok).toBe(true);
  });

  it('rejects an invented amount', () => {
    const r = check('Valor mensal de R$ 13.000,00 [p. 2].');
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/13.000,00/);
  });

  it('rejects a citation of a page that was not provided', () => {
    expect(check('Valor mensal de R$ 12.500,00 [p. 7].').problems[0]).toMatch(/página 7/);
  });

  it('requires a citation for answers but not for explanations', () => {
    expect(check('Valor mensal de R$ 12.500,00.').ok).toBe(false);
    expect(check('Valor mensal de R$ 12.500,00.', false).ok).toBe(true);
  });

  it('accepts the fixed not-found sentence in either language', () => {
    expect(check('Não encontrei essa informação no documento.').ok).toBe(true);
    expect(isNotFound('I could not find this information in the document.')).toBe(true);
  });

  it('ignores single digits (e.g. "3 parágrafos")', () => {
    expect(check('Há 3 condições [p. 2].').ok).toBe(true);
  });
});

describe('isNegativeOnly', () => {
  it.each([
    'A multa por atraso no pagamento não está explicitamente mencionada no documento. [p. 4]',
    'O documento não informa o CNPJ da contratada.',
    'Não há menção a seguro no contrato.',
    'The late payment fine is not specified in the document. [p. 4]',
    'The document does not mention an insurance.',
    // seen with qwen3:8b: its own wording plus the standard sentence and a page
    'A multa por atraso no pagamento não é mencionada no documento. Não encontrei essa informação no documento. [p. 7]',
  ])('recognises a refusal in other words: %s', (answer) => {
    expect(isNegativeOnly(answer)).toBe(true);
  });

  it.each([
    'O valor mensal é de R$ 12.500,00 [p. 2].',
    'O valor mensal é de R$ 12.500,00 [p. 2]. O documento não informa o CNPJ.',
    'A cláusula não prevista em lei foi anulada [p. 3].',
  ])('keeps answers that state a fact: %s', (answer) => {
    expect(isNegativeOnly(answer)).toBe(false);
  });
});

describe('unsupportedJudgement', () => {
  const exam = 'QUESTÃO 27 O texto é veiculado: A) é veiculado em programas de rádio pelo país B) circula em jornais impressos';

  it.each([
    'A resposta da questão 27 é: "A. é veiculado em programas de rádio pelo país" [p. 4].',
    'A alternativa correta é a A [p. 4].',
    'The correct answer is A [p. 4].',
    'Este contrato é vantajoso para a contratante [p. 2].',
    'Recomendo renegociar o prazo [p. 6].',
    'The notice period is reasonable [p. 6].',
  ])('flags a judgement the document does not make: %s', (answer) => {
    expect(unsupportedJudgement(answer, exam)).not.toBeNull();
  });

  it('allows it when the document itself says it (e.g. it has an answer key)', () => {
    const withKey = `${exam} GABARITO: questão 27, alternativa correta: A.`;
    expect(unsupportedJudgement('A alternativa correta é a A, segundo o gabarito [p. 9].', withKey)).toBeNull();
  });

  it.each([
    'A pergunta da questão 27 é: "O texto é veiculado" [p. 4].',
    'A CONTRATADA deve manter no mínimo 4 profissionais [p. 4].',
    'O valor mensal é de R$ 12.500,00 [p. 2].',
  ])('leaves factual answers alone: %s', (answer) => {
    expect(unsupportedJudgement(answer, exam)).toBeNull();
  });
});

describe('asksToChooseAnswer', () => {
  const exam = 'Questão 2. A política permite dividir as férias em: A) dois períodos B) três períodos';

  it.each([
    'Qual a resposta da questão 2?',
    'Qual alternativa está correta na questão 3?',
    'Qual alternativa responde a questão 3?',
    'Qual é a resposta certa do exercício 4?',
    'Resolva a questão 5',
    'Qual o gabarito?',
    'What is the correct answer to question 2?',
    'Which option is correct in question 3?',
  ])('recognises a request to pick an answer: %s', (question) => {
    expect(asksToChooseAnswer(question, exam)).toBe(true);
  });

  it.each([
    'Qual é o enunciado da questão 2?',
    'Quais são as alternativas da questão 3?',
    'Qual opção de pagamento o contrato prevê?',
    'Qual foi a resposta da empresa à notificação?',
    'Qual o prazo de aviso prévio?',
    'What does question 2 ask?',
  ])('lets other questions through: %s', (question) => {
    expect(asksToChooseAnswer(question, exam)).toBe(false);
  });

  it('allows it when the document has its own answer key', () => {
    expect(asksToChooseAnswer('Qual a resposta da questão 2?', `${exam}\nGABARITO: 1-A, 2-B`)).toBe(false);
  });
});
