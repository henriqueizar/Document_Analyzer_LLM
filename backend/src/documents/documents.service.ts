import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import * as path from 'path';
import { LlmService } from '../llm/llm.service';
import { isImage, isPdf } from '../common/supported-files';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService, 
    private ocrService: OcrService,
    private llmService: LlmService) {}

  async create(userEmail: string, file: Express.Multer.File) {
    if (!userEmail) {
      throw new BadRequestException('Missing user identity.');
    }
    const user = await this.prisma.user.upsert({
      where: { email: userEmail },
      update: {},
      create:{
        email: userEmail,
      }
    });

    
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
  const document = await this.prisma.document.findUnique({
    where: { id: documentId },
  });
  if (!document) {
    throw new NotFoundException('Document not found');
  }

  try {
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
      throw new UnprocessableEntityException(
        `Unsupported file type: ${document.originalName}`,
      );
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
    throw new UnprocessableEntityException('No text could be extracted from the document');
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
    this.logger.error(`Processing failed for document ${documentId}`, error);

    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED' },
    });

    if (error instanceof HttpException) throw error;
    throw new UnprocessableEntityException(
      error instanceof Error ? error.message : 'Document processing failed',
    );
  }
}


async ask(documentId: string, question: string) {
  const document = await this.prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!question?.trim()) {
    throw new BadRequestException('Question must not be empty');
  }
  if (!document) {
    throw new NotFoundException('Document not found');
  }
  if (document.status !== 'COMPLETED' || !document.extractedText) {
    throw new ConflictException(
      `Document is not ready for questions (status: ${document.status})`,
    );
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
    throw new NotFoundException('Document not found');
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
  if (!userEmail) {
    throw new BadRequestException('Missing user identity.');
  }
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