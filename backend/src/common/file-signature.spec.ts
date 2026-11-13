import { readFileSync } from 'fs';
import { join } from 'path';
import { contentMatchesName } from './file-signature';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', '..', 'test', 'fixtures', name)).subarray(
    0,
    16,
  );

describe('contentMatchesName', () => {
  it('accepts real files of each type', () => {
    expect(
      contentMatchesName('contrato.pdf', fixture('contrato-exemplo.pdf')),
    ).toBe(true);
    expect(contentMatchesName('recibo.PNG', fixture('receipt.png'))).toBe(true);
    expect(
      contentMatchesName('x.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
    ).toBe(true);
    expect(
      contentMatchesName(
        'x.webp',
        Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'),
      ),
    ).toBe(true);
    expect(
      contentMatchesName('x.tiff', Buffer.from([0x49, 0x49, 0x2a, 0x00])),
    ).toBe(true);
    expect(contentMatchesName('x.bmp', Buffer.from('BM\0\0', 'latin1'))).toBe(
      true,
    );
  });

  it('refuses content that does not match the name', () => {
    expect(contentMatchesName('relatorio.pdf', fixture('receipt.png'))).toBe(
      false,
    );
    expect(
      contentMatchesName('foto.png', fixture('contrato-exemplo.pdf')),
    ).toBe(false);
    expect(
      contentMatchesName('programa.pdf', Buffer.from('MZ\x90\0', 'latin1')),
    ).toBe(false); // a Windows executable
    expect(contentMatchesName('texto.pdf', fixture('not-an-image.txt'))).toBe(
      false,
    );
    expect(contentMatchesName('arquivo.exe', Buffer.from('MZ', 'latin1'))).toBe(
      false,
    );
  });
});
