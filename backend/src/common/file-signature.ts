import { extname } from 'path';

/**
 * The first bytes of each accepted file type. A file whose content does not
 * match its extension (e.g. an executable renamed to .pdf) is refused before
 * any parser reads it.
 */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  '.pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  '.png': (b) =>
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
  '.bmp': (b) => b.subarray(0, 2).toString('latin1') === 'BM',
  '.tif': (b) => isTiff(b),
  '.tiff': (b) => isTiff(b),
};

function isTiff(b: Buffer) {
  const head = b.subarray(0, 4);
  return (
    head.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    head.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  );
}

/** True when the file's first bytes are those of the type its name claims. */
export function contentMatchesName(name: string, head: Buffer): boolean {
  const check = SIGNATURES[extname(name).toLowerCase()];
  return Boolean(check?.(head));
}
