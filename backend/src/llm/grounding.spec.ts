import { checkGrounding, isNotFound } from './grounding';

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
