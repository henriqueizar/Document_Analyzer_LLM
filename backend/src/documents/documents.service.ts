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
import { stripPreamble } from '../llm/clean-response';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private llmService: LlmService,
  ) {}

  async create(userEmail: string, file: Express.Multer.File) {
    if (!userEmail) {
      throw new BadRequestException('Missing user identity.');
    }
    const user = await this.prisma.user.upsert({
      where: { email: userEmail },
      update: {},
      create: { email: userEmail },
    });

    const document = await this.prisma.document.create({
      data: {
        userId: user.id,
        filename: file.filename,
        originalName: file.originalname,
        filePath: file.path,
        status: 'PENDING',
      },
    });
    return this.toPublic(document);
  }

  async process(documentId: string, userEmail: string) {
    const document = await this.findOwned(documentId, userEmail);
    if (document.status === 'PROCESSING') {
      throw new ConflictException('Document is already being processed');
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

      // save the extracted text
      const updatedDocument = await this.prisma.document.update({
        where: { id: documentId },
        data: {
          extractedText: text,
          status: 'COMPLETED',
        },
      });
      if (!updatedDocument.extractedText) {
        throw new UnprocessableEntityException(
          'No text could be extracted from the document',
        );
      }

      // automatic explanation of the document
      const explanation = await this.llmService.explainDocument(
        updatedDocument.extractedText,
      );

      // save the initial LLM interaction
      await this.prisma.llmInteraction.create({
        data: {
          documentId: updatedDocument.id,
          role: 'EXPLANATION',
          question: '',
          answer: explanation,
        },
      });

      return this.toPublic(updatedDocument);
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

  async ask(documentId: string, question: string, userEmail: string) {
    if (!question?.trim()) {
      throw new BadRequestException('Question must not be empty');
    }
    const document = await this.findOwned(documentId, userEmail);
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

  async findOne(documentId: string, userEmail: string) {
    const document = await this.findOwned(documentId, userEmail);

    const interactions = await this.prisma.llmInteraction.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      document: this.toPublic(document),
      // also cleans explanations stored before filler removal existed
      interactions: interactions.map((i) => ({ ...i, answer: stripPreamble(i.answer) })),
    };
  }

  async getFile(documentId: string, userEmail: string) {
    const document = await this.findOwned(documentId, userEmail);
    const extension = path.extname(document.originalName).toLowerCase();
    return {
      path: path.resolve(document.filePath),
      mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
    };
  }

  async findAllByUser(userEmail: string) {
    if (!userEmail) {
      throw new BadRequestException('Missing user identity.');
    }
    return this.prisma.document.findMany({
      where: { user: { email: userEmail } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        status: true,
        createdAt: true,
      },
    });
  }

  /**
   * Looks a document up only among the caller's own documents. Someone else's
   * document yields the same 404 as a missing one, so ids cannot be probed.
   */
  private async findOwned(documentId: string, userEmail: string) {
    if (!userEmail) {
      throw new BadRequestException('Missing user identity.');
    }
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, user: { email: userEmail } },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return document;
  }

  /** Strip server-side storage details before returning a document. */
  private toPublic<T extends { filePath: string; filename: string }>(document: T) {
    const { filePath: _filePath, filename: _filename, ...rest } = document;
    return rest;
  }
}
