import { Injectable } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { fromPath } from 'pdf2pic';
import * as path from 'path';
import * as fs from 'fs';
//import pdfParse from 'pdf-parse'; //import error
const pdfParse = require('pdf-parse').default;

@Injectable()
export class OcrService {
  async extractText(imagePath: string): Promise<string> {
    // Without an errorHandler, tesseract.js rethrows worker errors outside the
    // returned promise, which crashes the whole Node process on unreadable input.
    const worker = await createWorker('eng', undefined, {
      errorHandler: () => undefined,
    });
    try {
      const {
        data: { text },
      } = await worker.recognize(imagePath);
      return text;
    } catch (error) {
      throw new Error(`OCR failed for ${path.basename(imagePath)}: ${String(error)}`);
    } finally {
      await worker.terminate();
    }
  }
  async recognizePdf(pdfPath: string): Promise<string> {
    const outputDir = path.join(process.cwd(), 'tmp');

    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    const converter = fromPath(pdfPath, {
        density: 150,         //diminuição para não sobrecarregar a memoria
        saveFilename: 'page',
        savePath: './tmp',
        format: 'png',
        width: 1240,
        height: 1754, 
    
});
    //const pages = await converter.bulk(1, { responseType: 'image' });
    // para evitar erro de runtime (visto usando bulk),
    // o convert(e o OCR) processa somente a primeira pagina do PDF
  
  const page = await converter(1);
  if (!page?.path) {
    throw new Error('Failed to convert PDF page');
  }

  const text = await this.extractText(page.path);
  fs.unlinkSync(page.path); // limpa a imagem temporaria

    return text.trim();
  }
}
