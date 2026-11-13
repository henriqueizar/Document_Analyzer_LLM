import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
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
import { AuditService } from '../audit/audit.service';
import { RateLimiter } from '../common/rate-limit';
import { contentMatchesName } from '../common/file-signature';

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

/** Questions per person per minute: far above human use, low enough to stop a script. */
const QUESTIONS_PER_MINUTE = 20;

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly questionsPerUser = new RateLimiter(
    QUESTIONS_PER_MINUTE,
    60_000,
  );
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
    private processing: ProcessingService,
    private audit: AuditService,
  ) {}

  /**
   * Names uploaded before the UTF-8 fix were stored wrongly decoded
   * ("3Âª EDICÌ§AÌO.pdf"). Repaired once on start; correct names are untouched.
   */
  async onModuleInit() {
    // Mis-decoded Portuguese accents (ª, ç, ã, é, ó, and the combining accents of
    // macOS file names) all start with one of these Latin-1 characters.
    const suspects = await this.prisma.document.findMany({
      where: {
        OR: ['Â', 'Ã', 'Ì', 'Í'].map((c) => ({
          originalName: { contains: c },
        })),
      },
      select: { id: true, originalName: true },
    });
    for (const doc of suspects) {
      const fixed = repairMisdecodedName(doc.originalName);
      if (fixed) {
        await this.prisma.document.update({
          where: { id: doc.id },
          data: { originalName: fixed },
        });
        this.logger.log(`Repaired file name: ${fixed}`);
      }
    }
  }

  async create(userEmail: string, file: Express.Multer.File) {
    if (!userEmail) {
      throw new BadRequestException('Missing user identity.');
    }
    // The extension and the browser's type can lie; the first bytes cannot.
    const handle = await fs.open(file.path, 'r');
    const head = Buffer.alloc(16);
    try {
      await handle.read(head, 0, 16, 0);
    } finally {
      await handle.close();
    }
    if (!contentMatchesName(file.originalname, head)) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new BadRequestException(
        'The file content does not match its type.',
      );
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
    await this.audit.record(userEmail, 'DOCUMENT_UPLOAD', {
      documentId: document.id,
      target: document.originalName,
    });
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
      data: {
        status: 'PENDING',
        failureReason: null,
        explanationStatus: null,
        explanationError: null,
      },
    });
    this.processing.enqueue(documentId);
    await this.audit.record(userEmail, 'DOCUMENT_REPROCESS', {
      documentId,
      target: document.originalName,
    });
    return this.toPublic(queued);
  }

  /**
   * Translation of an explanation or answer into `to`, done once by the local
   * LLM and stored. The original is kept; the translation is shown as such.
   */
  async translate(
    documentId: string,
    interactionId: string,
    userEmail: string,
    to: unknown,
  ) {
    if (to !== 'pt' && to !== 'en')
      throw new BadRequestException('Language must be "pt" or "en".');
    await this.findAccessible(documentId, userEmail);
    const interaction = await this.prisma.llmInteraction.findFirst({
      where: { id: interactionId, documentId, ...visibleTo(userEmail) },
    });
    if (!interaction) throw new NotFoundException('Answer not found');

    const stored = (interaction.translations ?? {}) as Record<
      string,
      { text: string; verified: boolean }
    >;
    if (stored[to]) return { language: to, ...stored[to] };

    const translation = await this.llmService.translate(
      stripPreamble(interaction.answer),
      to,
    );
    await this.prisma.llmInteraction.update({
      where: { id: interactionId },
      data: {
        translations: {
          ...stored,
          [to]: translation,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return { language: to, ...translation };
  }

  /** Writes the automatic explanation again (e.g. after the LLM was unavailable). */
  async explain(documentId: string, userEmail: string) {
    const document = await this.findOwned(documentId, userEmail);
    if (document.status !== 'COMPLETED') {
      throw new ConflictException(
        'The document must be read before it can be explained.',
      );
    }
    if (this.busy(document)) {
      throw new ConflictException('This document is already being processed.');
    }
    const queued = await this.prisma.document.update({
      where: { id: documentId },
      data: { explanationStatus: 'PENDING', explanationError: null },
    });
    this.processing.enqueue(documentId);
    await this.audit.record(userEmail, 'DOCUMENT_EXPLAIN_RETRY', {
      documentId,
      target: document.originalName,
    });
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
      throw new ConflictException(
        'This document is being processed. Wait for it to finish, then delete it.',
      );
    }
    await this.prisma.$transaction([
      this.prisma.llmInteraction.deleteMany({ where: { documentId } }),
      this.prisma.document.delete({ where: { id: documentId } }),
    ]);
    await this.audit.record(userEmail, 'DOCUMENT_DELETE', {
      documentId,
      target: document.originalName,
    });
    try {
      await fs.unlink(path.resolve(document.filePath));
    } catch (error) {
      // already gone is fine; anything else is logged (the records are deleted)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(
          `Could not delete the file of document ${documentId}`,
          error,
        );
      }
    }
  }

  private busy(document: {
    id: string;
    status: string;
    explanationStatus: string | null;
  }) {
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
    userId?: string,
  ) {
    const mode: AnswerMode = interpret ? 'INTERPRETATION' : 'STRICT';
    if (!question?.trim()) {
      throw new BadRequestException('Question must not be empty');
    }
    // The LLM is the scarcest resource: one person cannot monopolise it.
    if (!this.questionsPerUser.allowed(userEmail)) {
      throw new HttpException(
        'Too many questions in a short time. Wait a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.questionsPerUser.hit(userEmail);
    const document = await this.findAccessible(documentId, userEmail);
    if (document.status !== 'COMPLETED' || !document.extractedText) {
      throw new ConflictException(
        `Document is not ready for questions (status: ${document.status})`,
      );
    }

    const previous = await this.prisma.llmInteraction.findMany({
      // each person's own conversation, also on shared documents
      where: {
        documentId: document.id,
        role: 'QUESTION',
        user: { email: userEmail },
      },
      orderBy: { createdAt: 'desc' },
      // the LLM keeps as many of these as fit in its history budget
      take: 50,
    });
    const history = previous.reverse().map((i) => {
      // earlier automatic warnings are for the user, not for the model
      const answer = i.answer.replace(/\n*⚠[^\n]*$/u, '').trim();
      // an earlier interpretation must never be read back as a fact of the document
      return {
        question: i.question,
        answer:
          i.mode === 'INTERPRETATION' ? `[interpretation] ${answer}` : answer,
      };
    });

    const answer = await this.llmService.askQuestion(
      { name: document.originalName, text: document.extractedText },
      question,
      history,
      mode,
      language,
    );

    // the question's text is never logged: only that a question was asked, and in which mode
    await this.audit.record(userEmail, 'DOCUMENT_ASK', {
      documentId: document.id,
      target: document.originalName,
      details: { mode },
    });
    return this.prisma.llmInteraction.create({
      data: {
        documentId: document.id,
        userId: userId ?? document.userId,
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
    const document = await this.findAccessible(documentId, userEmail);

    const interactions = await this.prisma.llmInteraction.findMany({
      // the shared explanation, and only the caller's own questions
      where: { documentId, ...visibleTo(userEmail) },
      orderBy: { createdAt: 'asc' },
    });

    await this.audit.record(userEmail, 'DOCUMENT_VIEW', {
      documentId,
      target: document.originalName,
    });
    const { owner: documentOwner, ...rest } = document;
    return {
      document: this.toPublic(rest),
      access: {
        owner: documentOwner?.email === userEmail,
        ownerName: documentOwner?.name ?? documentOwner?.email ?? null,
      },
      // also cleans explanations stored before filler removal existed
      interactions: interactions.map((i) => ({
        ...i,
        answer: stripPreamble(i.answer),
      })),
    };
  }

  async getFile(documentId: string, userEmail: string) {
    const document = await this.findAccessible(documentId, userEmail);
    await this.audit.record(userEmail, 'DOCUMENT_DOWNLOAD', {
      documentId,
      target: document.originalName,
    });
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
        shares: { select: { team: { select: { name: true } } } },
      },
    });
  }

  /** Documents other people shared with teams the caller belongs to. */
  async findSharedWith(userEmail: string) {
    const inMyTeams = {
      team: { members: { some: { user: { email: userEmail } } } },
    };
    return this.prisma.document.findMany({
      where: {
        user: { email: { not: userEmail } },
        shares: { some: inMyTeams },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        status: true,
        explanationStatus: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        // only the caller's own teams: other teams' names are not revealed
        shares: {
          where: inMyTeams,
          select: { team: { select: { name: true } } },
        },
      },
    });
  }

  /** The owner's view of the sharing: teams it is shared with and the owner's teams. */
  async shares(documentId: string, userEmail: string) {
    const document = await this.findOwned(documentId, userEmail);
    const [shared, mine] = await Promise.all([
      this.prisma.documentShare.findMany({
        where: { documentId },
        select: { team: { select: { id: true, name: true } } },
      }),
      this.myTeams(document.userId),
    ]);
    // the choices: the owner's teams, plus any team it is already shared with
    const teams = [
      ...mine,
      ...shared
        .map((s) => s.team)
        .filter((t) => !mine.some((m) => m.id === t.id)),
    ];
    return { sharedWith: shared.map((s) => s.team), teams };
  }

  /**
   * Sets the teams the document is shared with (an empty list makes it private
   * again). Only the owner, and only with teams the owner belongs to.
   */
  async setShares(documentId: string, userEmail: string, teamIds: unknown) {
    const document = await this.findOwned(documentId, userEmail);
    if (!Array.isArray(teamIds) || teamIds.some((t) => typeof t !== 'string')) {
      throw new BadRequestException('teamIds must be a list of team ids.');
    }
    // Existing shares may stay even with teams the owner is not in (e.g. after
    // the documents of a deleted account were transferred); new ones may not.
    const current = await this.prisma.documentShare.findMany({
      where: { documentId },
      select: { teamId: true },
    });
    const allowed = new Set([
      ...(await this.myTeams(document.userId)).map((t) => t.id),
      ...current.map((c) => c.teamId),
    ]);
    const wanted = [...new Set(teamIds as string[])];
    if (wanted.some((id) => !allowed.has(id))) {
      throw new BadRequestException(
        'You can only share with teams you belong to.',
      );
    }
    await this.prisma.$transaction([
      this.prisma.documentShare.deleteMany({ where: { documentId } }),
      this.prisma.documentShare.createMany({
        data: wanted.map((teamId) => ({ documentId, teamId })),
      }),
    ]);
    const result = await this.shares(documentId, userEmail);
    await this.audit.record(userEmail, 'DOCUMENT_SHARING_CHANGED', {
      documentId,
      target: document.originalName,
      details: { teams: result.sharedWith.map((t) => t.name) },
    });
    return result;
  }

  private myTeams(userId: string) {
    return this.prisma.team.findMany({
      where: { members: { some: { userId } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  /**
   * A document the caller owns, or one shared with a team the caller belongs
   * to. Anything else yields the same 404 as a missing document.
   */
  private async findAccessible(documentId: string, userEmail: string) {
    if (!userEmail) {
      throw new BadRequestException('Missing user identity.');
    }
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        OR: [
          { user: { email: userEmail } },
          {
            shares: {
              some: {
                team: { members: { some: { user: { email: userEmail } } } },
              },
            },
          },
        ],
      },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    const { user: owner, ...rest } = document;
    return { ...rest, owner };
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
  private toPublic<T extends { filePath: string; filename: string }>(
    document: T,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
    const { filePath: _filePath, filename: _filename, ...rest } = document;
    return rest;
  }
}

/** Interactions a person may see: the shared explanation and their own questions. */
function visibleTo(userEmail: string) {
  return { OR: [{ role: 'EXPLANATION' }, { user: { email: userEmail } }] };
}
