import { Injectable, Logger } from '@nestjs/common';
import { createWorker, Worker } from 'tesseract.js';
import { PDFParse } from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

/** Pages whose text layer is shorter than this are treated as scanned and OCR'd. */
const MIN_TEXT_LAYER_CHARS = 20;
/** Render scale for OCR of scanned pages (1 = 72 dpi, 2 ≈ 144 dpi). */
const OCR_RENDER_SCALE = 2;
const DEFAULT_MAX_PDF_PAGES = 50;

/**
 * Folder with the Tesseract language data (eng.traineddata). Defaults to the
 * backend folder, resolved from this file so it does not depend on the
 * directory the server was started from. The data is never downloaded:
 * without the file, OCR fails with a clear error instead of fetching it from
 * a CDN (tesseract.js's default when it cannot find the file).
 */
export const TESSDATA_DIR = process.env.TESSDATA_DIR || path.resolve(__dirname, '..', '..');
/**
 * Tesseract languages, '+'-separated. Portuguese first: with English only,
 * accents are lost ("Prestação" -> "Prestacao", "nº" -> "n?"). Each language
 * needs <lang>.traineddata in TESSDATA_DIR (por and eng are in the repository,
 * from the tesseract.js-data "4.0.0_best_int" set).
 */
const OCR_LANGUAGES = (process.env.OCR_LANGUAGES || 'por+eng').split('+').filter(Boolean);

/**
 * pdf.js support files shipped with the pdfjs-dist package. Without them pdf.js
 * cannot decode JPEG 2000 images (common in scanners and "optimized" PDFs) and
 * renders those pages blank, so OCR finds no text. Local paths only.
 */
// Resolved from pdf-parse's location so it is always the copy pdf-parse uses.
const PDFJS_DIR = path.dirname(
  require.resolve('pdfjs-dist/package.json', { paths: [path.dirname(require.resolve('pdf-parse'))] }),
);
const PDFJS_OPTIONS = {
  wasmUrl: `${PDFJS_DIR}/wasm/`,
  standardFontDataUrl: `${PDFJS_DIR}/standard_fonts/`,
  cMapUrl: `${PDFJS_DIR}/cmaps/`,
  cMapPacked: true,
};

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  private readonly maxPdfPages =
    Number(process.env.MAX_PDF_PAGES) || DEFAULT_MAX_PDF_PAGES;

  /** OCR a single image file. */
  async extractText(imagePath: string): Promise<string> {
    const worker = await this.createOcrWorker();
    try {
      return await this.recognize(worker, imagePath, path.basename(imagePath));
    } finally {
      await worker.terminate();
    }
  }

  /**
   * Extract text from every page of a PDF (up to MAX_PDF_PAGES).
   *
   * Each page uses its embedded text layer when it has one; pages without a
   * usable text layer (scans) are rendered in memory and OCR'd. Nothing is
   * written to disk, so concurrent jobs cannot read each other's pages.
   */
  async recognizePdf(pdfPath: string): Promise<string> {
    const name = path.basename(pdfPath);
    const original = await fs.readFile(pdfPath);
    let parser = new PDFParse({ data: original, ...PDFJS_OPTIONS });
    let worker: Worker | undefined;
    try {
      let { pages, total } = await parser.getText({ first: this.maxPdfPages });

      // Every page empty: either a scan (OCR below) or a damaged file that
      // pdf.js could only partly read. Repair the second case and read again.
      if (pages.every((p) => p.text.trim().length < MIN_TEXT_LAYER_CHARS)) {
        const repaired = await repairPdf(original, total);
        if (repaired) {
          this.logger.warn(`${name}: pdf.js read ${total} page(s); reading a repaired copy`);
          await parser.destroy();
          parser = new PDFParse({ data: repaired, ...PDFJS_OPTIONS });
          ({ pages, total } = await parser.getText({ first: this.maxPdfPages }));
        }
      }

      if (total > this.maxPdfPages) {
        this.logger.warn(`${name} has ${total} pages; only the first ${this.maxPdfPages} are processed`);
      }

      const texts: string[] = [];
      for (const page of pages) {
        let text = page.text.trim();
        if (text.length < MIN_TEXT_LAYER_CHARS) {
          worker ??= await this.createOcrWorker();
          const shot = await parser.getScreenshot({
            partial: [page.num],
            scale: OCR_RENDER_SCALE,
            imageDataUrl: false,
          });
          const image = Buffer.from(shot.pages[0].data);
          text = (await this.recognize(worker, image, `${name} page ${page.num}`)).trim();
        }
        if (text) texts.push(`--- Page ${page.num} ---\n${text}`);
      }
      return texts.join('\n\n');
    } finally {
      await worker?.terminate();
      await parser.destroy();
    }
  }

  private createOcrWorker(): Promise<Worker> {
    for (const lang of OCR_LANGUAGES) {
      const dataFile = path.join(TESSDATA_DIR, `${lang}.traineddata`);
      if (!existsSync(dataFile)) {
        throw new Error(
          `OCR language data not found at ${dataFile}. por and eng are part of the repository ` +
            '(backend/*.traineddata); set TESSDATA_DIR if you moved them. It is never downloaded.',
        );
      }
    }
    return createWorker(OCR_LANGUAGES, undefined, {
      // Local files only: no CDN download, no cache written to the working directory.
      langPath: TESSDATA_DIR,
      gzip: false,
      cacheMethod: 'none',
      // Without an errorHandler, tesseract.js rethrows worker errors outside the
      // returned promise, which crashes the whole Node process on unreadable input.
      errorHandler: () => undefined,
    });
  }

  private async recognize(
    worker: Worker,
    input: string | Buffer,
    label: string,
  ): Promise<string> {
    try {
      const {
        data: { text },
      } = await worker.recognize(input);
      return text;
    } catch (error) {
      throw new Error(`OCR failed for ${label}: ${String(error)}`);
    }
  }
}

/**
 * Rebuilds a PDF that pdf.js cannot fully read. Files edited and re-saved by
 * some tools (seen with macOS Preview, "AppendMode") can carry stale copies of
 * objects and a broken cross-reference table: pdf.js then rebuilds the index,
 * hits a generation mismatch on a page and drops it, while other readers keep
 * every page. pdf-lib keeps each object version, so copying its pages into a
 * new document yields a clean file. Returns null when the repair would not add
 * pages (e.g. a genuine scan), so normal files are never rewritten.
 */
export async function repairPdf(data: Buffer, pagesSeenByPdfJs: number): Promise<Buffer | null> {
  try {
    const source = await PDFDocument.load(data, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
    if (source.getPageCount() <= pagesSeenByPdfJs) return null;
    const copy = await PDFDocument.create();
    for (const page of await copy.copyPages(source, source.getPageIndices())) copy.addPage(page);
    return Buffer.from(await copy.save({ useObjectStreams: false }));
  } catch {
    return null;
  }
}
