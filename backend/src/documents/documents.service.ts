import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import * as path from 'path';
import { LlmService } from '../llm/llm.service';
import { isImage, isPdf } from '../common/supported-files';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService, 
    private ocrService: OcrService,
    private llmService: LlmService) {}

  async create(userEmail: string, file: Express.Multer.File) {
    console.log('EMAIL RECEBIDO:', userEmail);
    const user = await this.prisma.user.upsert({
      where: { email: userEmail },
      update: {},
      create:{
        email: userEmail,
      }
    });
    console.log('USER ENCONTRADO:', user);

    
    return this.prisma.document.create({
      data: {
        userId: user.id,
        filename: file.filename,
        originalName: file.originalname, 
        filePath: file.path,
        status: 'PENDING',
      },
    });
  }

async process(documentId: string) {
  console.log('PROCESS START:', documentId);
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

    if (isPdf(document.originalName)) {
      text = await this.ocrService.recognizePdf(fullPath);
    } else if (isImage(document.originalName)) {
      text = await this.ocrService.extractText(fullPath);
    } else {
      throw new Error(`Unsupported file type: ${document.originalName}`);
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
async findOne(documentId: string) {
  const document = await this.prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  const interactions = await this.prisma.llmInteraction.findMany({
    where: { documentId },
    orderBy: { createdAt: 'asc' },
  });

  return {
    document,
    interactions,
  };
}
async findAllByUser(userEmail: string) {
  const user = await this.prisma.user.findUnique({
    where: { email: userEmail },
  });

  if (!user) return [];

  return this.prisma.document.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      originalName: true,
      status: true,
      createdAt: true,
    },
  });
}

}