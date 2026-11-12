import { join } from 'path';
import { readFile } from 'fs/promises';
import { OcrService, repairPdf } from './ocr.service';

const fixture = (name: string) => join(__dirname, '..', '..', 'test', 'fixtures', name);

// Real Tesseract (uses backend/eng.traineddata), no mocks: these tests are about OCR behaviour.
jest.setTimeout(60_000);

describe('OcrService', () => {
  const ocr = new OcrService();

  it('keeps Portuguese accents (por+eng models)', async () => {
    const text = await ocr.extractText(fixture('acentos.png'));
    expect(text).toMatch(/Prestação de serviços nº 027/);
    expect(text).toMatch(/Atenção à rescisão/);
  });

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

    it('reads scans compressed as JPEG 2000 (pdf.js needs its local wasm decoder)', async () => {
      const text = await ocr.recognizePdf(fixture('scanned-jpeg2000.pdf'));
      expect(text).toMatch(/CONTRATO DE LOCAÇÃO Nº 15\/2026/);
      expect(text).toMatch(/R\$ 3\.200,00/);
    });

    it('repairs PDFs that pdf.js only partly reads (stale object copies, broken xref)', async () => {
      const text = await ocr.recognizePdf(fixture('edited-pdf-stale-object.pdf'));
      expect(text).toMatch(/--- Page 1 ---\nCONTRATO DE COMODATO 88\/2026 - PAGINA UM/);
      expect(text).toMatch(/--- Page 2 ---\nPrazo de devolucao: 90 dias - PAGINA DOIS/);
    });

    it('does not rewrite genuine scans (no extra pages to recover)', async () => {
      const original = await readFile(fixture('scanned.pdf'));
      await expect(repairPdf(original, 1)).resolves.toBeNull();
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
