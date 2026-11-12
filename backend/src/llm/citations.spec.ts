import { attributeCitations, Source } from './citations';

const sources: Source[] = [
  { page: 1, text: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE LIMPEZA entre ACME Tecnologia Ltda. e Beta Serviços de Limpeza S.A.' },
  { page: 2, text: 'CLÁUSULA TERCEIRA - DO PREÇO. O valor mensal é de R$ 12.500,00, incluídos tributos.' },
  { page: 6, text: 'CLÁUSULA OITAVA - DA RESCISÃO. Aviso prévio por escrito de 60 (sessenta) dias.' },
];

describe('attributeCitations', () => {
  it('replaces a pile of citations at the end with one citation per sentence', () => {
    const text =
      'É um contrato de prestação de serviços de limpeza entre ACME Tecnologia e Beta Serviços. ' +
      'O valor mensal é de R$ 12.500,00. A rescisão exige aviso prévio de 60 dias. [p. 1] [p. 2] [p. 6]';
    expect(attributeCitations(text, sources)).toBe(
      'É um contrato de prestação de serviços de limpeza entre ACME Tecnologia e Beta Serviços [p. 1]. ' +
        'O valor mensal é de R$ 12.500,00 [p. 2]. A rescisão exige aviso prévio de 60 dias [p. 6].',
    );
  });

  it('keeps sentences that already cite a page', () => {
    const text = 'O valor mensal é de R$ 12.500,00 [p. 2].';
    expect(attributeCitations(text, sources)).toBe(text);
  });

  it('does not invent a citation for a sentence without a strong match', () => {
    const text = 'O documento parece bem organizado e claro.';
    expect(attributeCitations(text, sources)).toBe(text);
  });

  it('does not split sentences at abbreviations such as "Ltda. e"', () => {
    const text = 'Contrato de limpeza entre ACME Tecnologia Ltda. e Beta Serviços de Limpeza S.A.';
    expect(attributeCitations(text, sources)).toBe(
      'Contrato de limpeza entre ACME Tecnologia Ltda. e Beta Serviços de Limpeza S.A [p. 1].',
    );
  });

  it('keeps paragraph breaks', () => {
    const text = 'O valor mensal é de R$ 12.500,00.\n\nA rescisão exige aviso prévio de 60 dias.';
    expect(attributeCitations(text, sources)).toBe(
      'O valor mensal é de R$ 12.500,00 [p. 2].\n\nA rescisão exige aviso prévio de 60 dias [p. 6].',
    );
  });

  it('keeps a single trailing citation (that is a normal per-sentence citation)', () => {
    const text = 'O valor mensal é de R$ 12.500,00. [p. 2]';
    expect(attributeCitations(text, sources)).toBe(text);
  });

  it('cites each item of a ";"-separated list on its own (real qwen3:8b output)', () => {
    const contract: Source[] = [
      { page: 1, text: 'CLÁUSULA SEGUNDA - DA VIGÊNCIA. O contrato vigorará por 24 (vinte e quatro) meses, de 1º de fevereiro de 2026 a 31 de janeiro de 2028.' },
      { page: 2, text: 'CLÁUSULA TERCEIRA - DO PREÇO. Valor mensal de R$ 12.500,00, já incluídos todos os tributos e materiais de limpeza. CLÁUSULA QUARTA - DO PAGAMENTO. Até o dia 10 do mês subsequente.' },
      { page: 3, text: 'CLÁUSULA QUINTA - DO REAJUSTE. Reajustado anualmente pela variação acumulada do IPCA.' },
      { page: 6, text: 'CLÁUSULA OITAVA - DA RESCISÃO. Aviso prévio por escrito de 60 (sessenta) dias.' },
    ];
    const text =
      'Os pontos principais incluem: o contrato tem vigência de 24 meses, de 1º de fevereiro de 2026 a 31 de janeiro de 2028; ' +
      'o valor mensal é de R$ 12.500,00, já incluindo tributos e materiais; o pagamento é feito até o dia 10 do mês seguinte; ' +
      'o reajuste anual é feito com base no IPCA; e a rescisão pode ocorrer com 60 dias de aviso. [p. 1] [p. 2] [p. 3] [p. 6]';
    const result = attributeCitations(text, contract);
    expect(result).toMatch(/31 de janeiro de 2028 \[p\. 1\];/);
    expect(result).toMatch(/tributos e materiais \[p\. 2\];/);
    expect(result).toMatch(/dia 10 do mês seguinte \[p\. 2\];/);
    expect(result).toMatch(/IPCA \[p\. 3\];/);
    expect(result).toMatch(/60 dias de aviso \[p\. 6\]\.$/);
    expect(result).not.toMatch(/\] \[p\./);
  });
});
