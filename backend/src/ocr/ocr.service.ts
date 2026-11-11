import { Injectable, Logger } from '@nestjs/common';
import { createWorker, Worker } from 'tesseract.js';
import { PDFParse } from 'pdf-parse';
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
const OCR_LANGUAGE = 'eng';

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
    const parser = new PDFParse({ data: await fs.readFile(pdfPath) });
    let worker: Worker | undefined;
    try {
      const { pages, total } = await parser.getText({ first: this.maxPdfPages });
      if (total > this.maxPdfPages) {
        this.logger.warn(
          `${path.basename(pdfPath)} has ${total} pages; only the first ${this.maxPdfPages} are processed`,
        );
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
          text = (
            await this.recognize(worker, image, `${path.basename(pdfPath)} page ${page.num}`)
          ).trim();
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
    const dataFile = path.join(TESSDATA_DIR, `${OCR_LANGUAGE}.traineddata`);
    if (!existsSync(dataFile)) {
      throw new Error(
        `OCR language data not found at ${dataFile}. It is part of the repository ` +
          '(backend/eng.traineddata); set TESSDATA_DIR if you moved it. It is never downloaded.',
      );
    }
    return createWorker(OCR_LANGUAGE, undefined, {
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
