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

  it('ignores words spelled the same in both languages ("a", "do", "à" -> "a")', () => {
    expect(detectLanguage('a do a do à', 'en')).toBe('en');
    expect(detectLanguage('a do a do à', 'pt')).toBe('pt');
  });

  it('detects longer texts by their many function words', () => {
    expect(detectLanguage('The Company shall have the right to terminate this agreement and the parties will be notified.')).toBe('en');
    expect(detectLanguage('A empresa tem o direito de rescindir o contrato e as partes serão notificadas pelos meios usuais.')).toBe('pt');
  });
});
