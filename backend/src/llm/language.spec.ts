import { detectLanguage } from './language';

describe('detectLanguage', () => {
  it.each([
    ['Qual é o prazo de rescisão do contrato?', 'pt'],
    ['Quem assina pela contratante?', 'pt'],
    ['What is the termination notice period?', 'en'],
    ['Who signs the contract for the client?', 'en'],
  ])('%s -> %s', (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it('uses the fallback when there is no signal', () => {
    expect(detectLanguage('R$ 12.500,00', 'en')).toBe('en');
    expect(detectLanguage('ACME', 'pt')).toBe('pt');
  });
});
