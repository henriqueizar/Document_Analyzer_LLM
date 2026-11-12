import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LlmService } from '../llm/llm.service';
import { ProcessingService } from './processing.service';
import type { AnswerMode } from '../llm/prompts';
import { repairMisdecodedName } from '../common/file-names';
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
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
    private processing: ProcessingService,
  ) {}

  /**
   * Names uploaded before the UTF-8 fix were stored wrongly decoded
   * ("3Âª EDICÌ§AÌO.pdf"). Repaired once on start; correct names are untouched.
   */
  async onModuleInit() {
    // Mis-decoded Portuguese accents (ª, ç, ã, é, ó, and the combining accents of
    // macOS file names) all start with one of these Latin-1 characters.
    const suspects = await this.prisma.document.findMany({
      where: { OR: ['Â', 'Ã', 'Ì', 'Í'].map((c) => ({ originalName: { contains: c } })) },
      select: { id: true, originalName: true },
    });
    for (const doc of suspects) {
      const fixed = repairMisdecodedName(doc.originalName);
      if (fixed) {
        await this.prisma.document.update({ where: { id: doc.id }, data: { originalName: fixed } });
        this.logger.log(`Repaired file name: ${fixed}`);
      }
    }
  }

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
    // Reading and explaining run in the background; the page shows progress.
    this.processing.enqueue(document.id);
    return this.toPublic(document);
  }

  /**
   * Reads the document again and writes a new explanation (retry after a
   * failure, or after changing the OCR/LLM). Questions and answers are kept.
   * Runs in the background: returns at once with the queued document.
   */
  async process(documentId: string, userEmail: string) {
    const document = await this.findOwned(documentId, userEmail);
    if (this.busy(document)) {
      throw new ConflictException('This document is already being processed.');
    }
    const queued = await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'PENDING', failureReason: null, explanationStatus: null, explanationError: null },
    });
    this.processing.enqueue(documentId);
    return this.toPublic(queued);
  }

  /**
   * Translation of an explanation or answer into `to`, done once by the local
   * LLM and stored. The original is kept; the translation is shown as such.
   */
  async translate(documentId: string, interactionId: string, userEmail: string, to: unknown) {
    if (to !== 'pt' && to !== 'en') throw new BadRequestException('Language must be "pt" or "en".');
    await this.findOwned(documentId, userEmail);
    const interaction = await this.prisma.llmInteraction.findFirst({
      where: { id: interactionId, documentId },
    });
    if (!interaction) throw new NotFoundException('Answer not found');

    const stored = (interaction.translations ?? {}) as Record<string, { text: string; verified: boolean }>;
    if (stored[to]) return { language: to, ...stored[to] };

    const translation = await this.llmService.translate(stripPreamble(interaction.answer), to);
    await this.prisma.llmInteraction.update({
      where: { id: interactionId },
      data: { translations: { ...stored, [to]: translation } as unknown as Prisma.InputJsonValue },
    });
    return { language: to, ...translation };
  }

  /** Writes the automatic explanation again (e.g. after the LLM was unavailable). */
  async explain(documentId: string, userEmail: string) {
    const document = await this.findOwned(documentId, userEmail);
    if (document.status !== 'COMPLETED') {
      throw new ConflictException('The document must be read before it can be explained.');
    }
    if (this.busy(document)) {
      throw new ConflictException('This document is already being processed.');
    }
    const queued = await this.prisma.document.update({
      where: { id: documentId },
      data: { explanationStatus: 'PENDING', explanationError: null },
    });
    this.processing.enqueue(documentId);
    return this.toPublic(queued);
  }

  /**
   * Deletes the document permanently: the uploaded file, the extracted text and
   * every explanation, question and answer (LGPD right to erasure, art. 18).
   * Refused while the document is being processed, so nothing is left half-done.
   */
  async remove(documentId: string, userEmail: string): Promise<void> {
    const document = await this.findOwned(documentId, userEmail);
    if (this.busy(document)) {
      throw new ConflictException('This document is being processed. Wait for it to finish, then delete it.');
    }
    await this.prisma.$transaction([
      this.prisma.llmInteraction.deleteMany({ where: { documentId } }),
      this.prisma.document.delete({ where: { id: documentId } }),
    ]);
    try {
      await fs.unlink(path.resolve(document.filePath));
    } catch (error) {
      // already gone is fine; anything else is logged (the records are deleted)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(`Could not delete the file of document ${documentId}`, error);
      }
    }
  }

  private busy(document: { id: string; status: string; explanationStatus: string | null }) {
    return (
      this.processing.isQueued(document.id) ||
      ['PENDING', 'PROCESSING'].includes(document.status) ||
      ['PENDING', 'PROCESSING'].includes(document.explanationStatus ?? '')
    );
  }

  async ask(
    documentId: string,
    question: string,
    userEmail: string,
    interpret = false,
    language: 'pt' | 'en' = 'pt',
  ) {
    const mode: AnswerMode = interpret ? 'INTERPRETATION' : 'STRICT';
    if (!question?.trim()) {
      throw new BadRequestException('Question must not be empty');
    }
    const document = await this.findOwned(documentId, userEmail);
    if (document.status !== 'COMPLETED' || !document.extractedText) {
      throw new ConflictException(
        `Document is not ready for questions (status: ${document.status})`,
      );
    }

    const previous = await this.prisma.llmInteraction.findMany({
      where: { documentId: document.id, role: 'QUESTION' },
      orderBy: { createdAt: 'desc' },
      // the LLM keeps as many of these as fit in its history budget
      take: 50,
    });
    const history = previous.reverse().map((i) => {
      // earlier automatic warnings are for the user, not for the model
      const answer = i.answer.replace(/\n*⚠[^\n]*$/u, '').trim();
      // an earlier interpretation must never be read back as a fact of the document
      return { question: i.question, answer: i.mode === 'INTERPRETATION' ? `[interpretation] ${answer}` : answer };
    });

    const answer = await this.llmService.askQuestion(
      { name: document.originalName, text: document.extractedText },
      question,
      history,
      mode,
      language,
    );

    return this.prisma.llmInteraction.create({
      data: {
        documentId: document.id,
        role: 'QUESTION',
        question,
        answer: answer.text,
        sources: answer.sources as unknown as Prisma.InputJsonValue,
        mode,
        language: answer.language ?? language,
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
        explanationStatus: true,
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
    const { filePath: _filePath, filename: _filename, ...rest } = document;
    return rest;
  }
}
