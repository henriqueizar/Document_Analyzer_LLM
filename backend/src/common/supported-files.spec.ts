import { isImage, isPdf, isSupportedUpload } from './supported-files';

describe('supported-files', () => {
  it('detects PDFs case-insensitively', () => {
    expect(isPdf('scan.pdf')).toBe(true);
    expect(isPdf('SCAN.PDF')).toBe(true);
    expect(isPdf('scan.png')).toBe(false);
  });

  it('detects images case-insensitively', () => {
    expect(isImage('photo.JPG')).toBe(true);
    expect(isImage('photo.webp')).toBe(true);
    expect(isImage('notes.txt')).toBe(false);
  });

  it('accepts only matching extension + MIME type pairs', () => {
    expect(isSupportedUpload('a.pdf', 'application/pdf')).toBe(true);
    expect(isSupportedUpload('A.PDF', 'application/pdf')).toBe(true);
    expect(isSupportedUpload('a.png', 'image/png')).toBe(true);
    expect(isSupportedUpload('a.txt', 'text/plain')).toBe(false);
    expect(isSupportedUpload('a.pdf', 'text/plain')).toBe(false);
    expect(isSupportedUpload('a.png', 'application/pdf')).toBe(false);
  });
});
