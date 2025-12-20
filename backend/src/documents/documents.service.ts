import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import * as path from 'path';
import { LlmService } from '../llm/llm.service';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService, 
    private ocrService: OcrService,
    private llmService: LlmService) {}

  async create(userId: string, file: Express.Multer.File) {
    return this.prisma.document.create({
      data: {
        userId,
        filename: file.filename,
        originalName: file.originalname, 
        filePath: file.path,
        status: 'PENDING',
      },
    });
  }

async process(documentId: string) {
  try {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING' },
    });

    const fullPath = path.resolve(document.filePath);

    let text = '';

    if (document.originalName.endsWith('.pdf')) {
      text = await this.ocrService.recognizePdf(fullPath);
    } else {
      text = await this.ocrService.extractText(fullPath);
    }

    // salva o texto extraído
    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        extractedText: text,
        status: 'COMPLETED',
      },
    });
    if (!updatedDocument.extractedText) {
    throw new Error('Extracted text empty after OCR');
    }
    //explicacao automatica do documento
    const explanation = await this.llmService.explainDocument(
      updatedDocument.extractedText,
    );

    //salva a interação inicial do LLM
    await this.prisma.llmInteraction.create({
      data: {
        documentId: updatedDocument.id,
        role: 'EXPLANATION',
        question: '',
        answer: explanation,
      },
    });

    return updatedDocument;
  } catch (error) {
    console.error('OCR failed:', error);

    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED' },
    });

    throw error;
  }
}


async ask(documentId: string, question: string) {
  const document = await this.prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document || !document.extractedText) {
    throw new Error('Document not ready for LLM interaction');
  }

  const answer = await this.llmService.askQuestion(
    document.extractedText,
    question,
  );

  return this.prisma.llmInteraction.create({
    data: {
      documentId: document.id,
      role: 'QUESTION',
      question,
      answer,
    },
  });
}

}