import { join } from 'path';
import { OcrService } from './ocr.service';

const fixture = (name: string) => join(__dirname, '..', '..', 'test', 'fixtures', name);

// Real Tesseract (uses backend/eng.traineddata), no mocks: these tests are about OCR behaviour.
jest.setTimeout(60_000);

describe('OcrService', () => {
  const ocr = new OcrService();

  it('extracts text from an image', async () => {
    const text = await ocr.extractText(fixture('receipt.png'));
    expect(text).toMatch(/RECEIPT TOTAL 42/);
  });

  it('rejects (instead of crashing the process) on a non-image file', async () => {
    await expect(ocr.extractText(fixture('not-an-image.txt'))).rejects.toThrow(/OCR failed/);
  });

  it('rejects (instead of crashing the process) when a PDF is sent to image OCR', async () => {
    await expect(ocr.extractText(fixture('three-pages.pdf'))).rejects.toThrow(/OCR failed/);
  });

  describe('recognizePdf', () => {
    it('returns the text of every page, not just page 1', async () => {
      const text = await ocr.recognizePdf(fixture('three-pages.pdf'));
      expect(text).toMatch(/PAGE 1 INVOICE NUMBER 4711/);
      expect(text).toMatch(/PAGE 2 TOTAL AMOUNT 999/);
      expect(text).toMatch(/PAGE 3 DUE DATE DECEMBER/);
    });

    it('falls back to OCR for scanned pages without a text layer', async () => {
      const text = await ocr.recognizePdf(fixture('scanned.pdf'));
      expect(text).toMatch(/SCANNED TOTAL 314/);
    });

    it('keeps concurrent jobs isolated (no shared temp files)', async () => {
      for (let i = 0; i < 3; i++) {
        const [a, b] = await Promise.all([
          ocr.recognizePdf(fixture('doc-a.pdf')),
          ocr.recognizePdf(fixture('doc-b.pdf')),
        ]);
        expect(a).toMatch(/ALPHA/);
        expect(a).not.toMatch(/BRAVO/);
        expect(b).toMatch(/BRAVO/);
        expect(b).not.toMatch(/ALPHA/);
      }
    });

    it('rejects a file that is not a PDF', async () => {
      await expect(ocr.recognizePdf(fixture('not-an-image.txt'))).rejects.toThrow();
    });
  });
});
