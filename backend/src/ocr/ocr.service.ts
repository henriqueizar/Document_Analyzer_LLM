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
    const worker = await createWorker('eng');

    const {
      data: { text },
    } = await worker.recognize(imagePath);

    await worker.terminate();

    return text;
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
