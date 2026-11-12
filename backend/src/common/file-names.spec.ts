import { normalizeFileName, repairMisdecodedName } from './file-names';

describe('file names', () => {
  it('composes macOS decomposed accents', () => {
    expect(normalizeFileName('3ª EDIÇÃO.pdf'.normalize('NFD'))).toBe('3ª EDIÇÃO.pdf');
  });

  it('repairs names stored with the wrong decoding (as seen in the app)', () => {
    expect(repairMisdecodedName('3Âª EDICÌ§AÌ\u0083O.pdf')).toBe('3ª EDIÇÃO.pdf');
    const broken = Buffer.from('Relatório Anual.pdf', 'utf8').toString('latin1');
    expect(repairMisdecodedName(broken)).toBe('Relatório Anual.pdf');
  });

  it('leaves correct names alone', () => {
    expect(repairMisdecodedName('SÃO PAULO.pdf')).toBeNull();
    expect(repairMisdecodedName('Relatório Anual.pdf')).toBeNull();
    expect(repairMisdecodedName('contrato.pdf')).toBeNull();
    expect(repairMisdecodedName('3ª EDIÇÃO.pdf')).toBeNull();
  });
});
