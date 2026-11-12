import { repairShiftedGlyphs } from './shifted-glyphs';

/** Encodes text the way the broken fonts do (29 below; spaces as 0x03, dots as 0x11). */
const shift = (text: string) =>
  [...text]
    .map((c) =>
      String.fromCharCode(
        c === ' ' ? 0x03 : c === '.' ? 0x11 : c.charCodeAt(0) - 29,
      ),
    )
    .join('');

describe('repairShiftedGlyphs', () => {
  it('decodes the header of a paper whose fonts have no character map', () => {
    // as extracted from a real ACM paper (title, authors, affiliation, e-mail)
    const extracted = [
      '$\u00020XOWLDJHQW\u0002$SSURDFK\u0002IRU\u00020XVLFDO\u0002,QWHUDFWLYH\u00026\\VWHPV\u0002',
      "5RGROIR\u0006'DQLHO\u0006:XOIKRUVW\u0006 \u0006",
      '8)5*6\u0006',
      ':XOIKRUV#LQI\u0011XIUJV\u0011EU\u0006',
      'ABSTRACT',
      'The present work proposes a model for a Multiagent System',
    ].join('\n');
    expect(repairShiftedGlyphs(extracted).split('\n')).toEqual([
      'A Multiagent Approach for Musical Interactive Systems',
      'Rodolfo Daniel Wulfhorst',
      'UFRGS',
      'Wulfhors@inf.ufrgs.br',
      'ABSTRACT',
      'The present work proposes a model for a Multiagent System',
    ]);
  });

  it('decodes shifted lines extracted with ordinary spaces', () => {
    expect(
      repairShiftedGlyphs(
        '$ 0XOWLDJHQW $SSURDFK IRU 0XVLFDO ,QWHUDFWLYH 6\\VWHPV',
      ),
    ).toBe('A Multiagent Approach for Musical Interactive Systems');
  });

  it('decodes Portuguese text too', () => {
    expect(
      repairShiftedGlyphs(shift('Contrato de Prestacao de Servicos')),
    ).toBe('Contrato de Prestacao de Servicos');
  });

  it('leaves ordinary text alone, including all-caps lines, numbers and codes', () => {
    const ordinary = [
      'CLÁUSULA TERCEIRA - DO PREÇO',
      'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
      'II. RELATED WORK',
      '1. INTRODUCTION',
      'ABSTRACT',
      'TABLE 1',
      'CNPJ: 12.345.678/0001-90',
      'CPF 123.456.789-00',
      'R$ 12.500,00',
      'ISBN 978-3-16-148410-0',
      'IEEE 802.11',
      'HTTP/1.1 200 OK',
      'COVID-19',
      'ABC1D23',
      'NCM 8471.30.12 CFOP 5102',
      '[1], [2], [14], [13], [18]',
      'I.2.11 [Distributed Artificial Intelligence]: Multiagent systems.',
      'P.O. BOX 42',
      'UFRGS',
      'DO THE SUM',
      '12 34 56',
      'X1Y2 Z3',
      'SKU: 4XQ-77',
      'ART. 5º',
      '§ 2º',
      '***',
      '----',
      '(11) 98765-4321',
      '01/02/2026 a 31/01/2028',
    ].join('\n');
    expect(repairShiftedGlyphs(ordinary)).toBe(ordinary);
  });
});
