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
});
