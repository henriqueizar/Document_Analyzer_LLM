import {
  findReferences,
  formatPassages,
  selectPassages,
  splitIntoPassages,
  tokenize,
} from './passages';

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Parágrafo genérico ${i} sobre obrigações gerais das partes.`).join('\n\n');

const contract = [
  '--- Page 1 ---',
  'CONTRATO DE PRESTAÇÃO DE SERVIÇOS entre ACME Ltda. (CONTRATANTE) e Beta Serviços S.A. (CONTRATADA).',
  filler(12),
  '--- Page 2 ---',
  'CLÁUSULA 3 - DO PREÇO\n\nO valor mensal é de R$ 12.500,00, reajustado anualmente pelo IPCA.',
  filler(12),
  '--- Page 3 ---',
  'CLÁUSULA OITAVA - DA RESCISÃO\n\nQualquer parte pode rescindir mediante aviso prévio de 60 dias.',
  filler(12),
  '--- Page 4 ---',
  'CLÁUSULA 12 - DO FORO\n\nFica eleito o foro da Comarca de Brasília/DF.',
].join('\n');

describe('splitIntoPassages', () => {
  it('labels passages with the page they come from', () => {
    const passages = splitIntoPassages(contract, 500);
    expect(passages.find((p) => p.text.includes('R$ 12.500,00'))?.page).toBe(2);
    expect(passages.find((p) => p.text.includes('Brasília'))?.page).toBe(4);
    expect(passages.every((p) => p.text.length <= 500)).toBe(true);
  });

  it('treats text without page markers (images) as page 1', () => {
    expect(splitIntoPassages('RECEIPT TOTAL 42')).toEqual([{ index: 0, page: 1, text: 'RECEIPT TOTAL 42' }]);
  });

  it('splits a single very long block', () => {
    const passages = splitIntoPassages('x'.repeat(3000), 1000);
    expect(passages.length).toBeGreaterThanOrEqual(3);
    expect(passages.every((p) => p.text.length <= 1000)).toBe(true);
  });
});

describe('tokenize', () => {
  it('lower-cases, removes accents and stopwords, keeps numbers', () => {
    expect(tokenize('Qual é o prazo da Rescisão em 60 dias?')).toEqual(['prazo', 'rescisao', '60', 'dias']);
  });
});

describe('findReferences', () => {
  it.each([
    ['O que diz a cláusula 8?', { kind: 'clause', number: 8 }],
    ['Explique o Art. 5º', { kind: 'article', number: 5 }],
    ['What does section 2 say?', { kind: 'section', number: 2 }],
    ['O que tem na página 3?', { kind: 'page', number: 3 }],
    ['Resuma a questão 01', { kind: 'question', number: 1 }],
  ])('%s', (question, ref) => {
    expect(findReferences(question)).toContainEqual(ref);
  });
});

describe('selectPassages', () => {
  const passages = splitIntoPassages(contract, 500);
  const pagesOf = (q: string, budget = 700) =>
    selectPassages(passages, q, budget).passages.map((p) => p.page);

  it('sends everything when the document fits', () => {
    const small = splitIntoPassages('--- Page 1 ---\nA\n--- Page 2 ---\nB');
    expect(selectPassages(small, 'anything', 10_000)).toMatchObject({ complete: true, totalPages: 2 });
  });

  it('finds the passage that answers a keyword question', () => {
    expect(pagesOf('Qual é o valor mensal do contrato?')).toContain(2);
    expect(pagesOf('Qual o foro eleito?')).toContain(4);
  });

  it('finds clauses written as ordinals ("CLÁUSULA OITAVA") from "cláusula 8"', () => {
    const selected = selectPassages(passages, 'O que diz a cláusula 8?', 700).passages;
    expect(selected[0].text).toMatch(/CLÁUSULA OITAVA/);
  });

  it('finds numbered clauses', () => {
    const selected = selectPassages(passages, 'cláusula 12', 700).passages;
    expect(selected.some((p) => p.text.includes('Brasília'))).toBe(true);
  });

  it('honours explicit page references', () => {
    expect(pagesOf('O que tem na página 3?')).toEqual(expect.arrayContaining([3]));
  });

  it('stays within the budget and keeps document order', () => {
    const { passages: chosen, complete } = selectPassages(passages, 'rescisão aviso prévio', 900);
    expect(complete).toBe(false);
    expect(chosen.reduce((s, p) => s + p.text.length, 0)).toBeLessThanOrEqual(900);
    expect(chosen.map((p) => p.index)).toEqual([...chosen.map((p) => p.index)].sort((a, b) => a - b));
  });

  it('falls back to the start of the document when nothing matches', () => {
    expect(pagesOf('xyzzy', 400)[0]).toBe(1);
  });
});

describe('formatPassages', () => {
  it('prefixes each passage with its page', () => {
    expect(formatPassages([{ index: 0, page: 7, text: 'abc' }])).toBe('[p. 7]\nabc');
  });
});
