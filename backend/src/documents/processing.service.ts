import { HttpException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { LlmService } from '../llm/llm.service';
import { isImage, isPdf } from '../common/supported-files';

export const NO_TEXT_MESSAGE =
  'No readable text was found in this document. If it is a photo or a scan, try a sharper, well-lit image with the page filling the frame.';

/**
 * Processes documents in the background, one at a time (OCR and the local LLM
 * are CPU/GPU heavy), so uploads return immediately and the page shows
 * progress. Two stages with their own status:
 *
 *   reading      Document.status: PENDING (queued) -> PROCESSING -> COMPLETED | FAILED
 *   explanation  Document.explanationStatus: same values, only after reading succeeded
 *
 * A failed explanation (e.g. Ollama not running) leaves the document readable
 * and open to questions. Work interrupted by a restart is queued again on start.
 */
@Injectable()
export class ProcessingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProcessingService.name);
  private readonly queue: string[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ocr: OcrService,
    private readonly llm: LlmService,
  ) {}

  /** Queue work left unfinished when the server stopped. */
  async onApplicationBootstrap() {
    const unfinished = await this.prisma.document.findMany({
      where: {
        OR: [
          { status: { in: ['PENDING', 'PROCESSING'] } },
          { status: 'COMPLETED', explanationStatus: { in: ['PENDING', 'PROCESSING'] } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    for (const { id } of unfinished) this.enqueue(id);
    if (unfinished.length) this.logger.log(`Resuming ${unfinished.length} unfinished document(s)`);
  }

  isQueued(documentId: string): boolean {
    return this.queue.includes(documentId);
  }

  enqueue(documentId: string) {
    if (!this.queue.includes(documentId)) this.queue.push(documentId);
    this.running ??= this.drain().finally(() => (this.running = null));
  }

  /** Resolves when the queue is empty (used by tests). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain() {
    for (let id = this.queue.shift(); id; id = this.queue.shift()) {
      try {
        await this.run(id);
      } catch (error) {
        this.logger.error(`Unexpected error processing document ${id}`, error);
      }
    }
  }

  private async run(id: string) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) return;

    let text = document.extractedText;
    if (document.status !== 'COMPLETED' || !text) {
      text = await this.read(id, document.originalName, document.filePath);
      if (!text) return;
    }
    if (document.status !== 'COMPLETED' || document.explanationStatus !== 'COMPLETED') {
      await this.explain(id, document.originalName, text);
    }
  }

  private async read(id: string, name: string, filePath: string): Promise<string | null> {
    await this.prisma.document.update({
      where: { id },
      data: { status: 'PROCESSING', failureReason: null },
    });
    try {
      const fullPath = path.resolve(filePath);
      let text: string;
      if (isPdf(name)) text = await this.ocr.recognizePdf(fullPath);
      else if (isImage(name)) text = await this.ocr.extractText(fullPath);
      else throw new Error(`Unsupported file type: ${name}`);

      text = text.trim();
      if (!text) throw new Error(NO_TEXT_MESSAGE);
      await this.prisma.document.update({
        where: { id },
        data: { status: 'COMPLETED', extractedText: text, explanationStatus: 'PENDING', explanationError: null },
      });
      return text;
    } catch (error) {
      this.logger.error(`Reading failed for document ${id}`, error);
      await this.prisma.document.update({
        where: { id },
        data: { status: 'FAILED', failureReason: messageOf(error) },
      });
      return null;
    }
  }

  private async explain(id: string, name: string, text: string) {
    await this.prisma.document.update({
      where: { id },
      data: { explanationStatus: 'PROCESSING', explanationError: null },
    });
    try {
      const explanation = await this.llm.explainDocument({ name, text });
      // A new explanation replaces the previous one (reprocessing); Q&A are kept.
      await this.prisma.$transaction([
        this.prisma.llmInteraction.deleteMany({ where: { documentId: id, role: 'EXPLANATION' } }),
        this.prisma.llmInteraction.create({
          data: {
            documentId: id,
            role: 'EXPLANATION',
            question: '',
            answer: explanation.text,
            sources: explanation.sources as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.document.update({ where: { id }, data: { explanationStatus: 'COMPLETED' } }),
      ]);
    } catch (error) {
      this.logger.error(`Explanation failed for document ${id}`, error);
      await this.prisma.document.update({
        where: { id },
        data: { explanationStatus: 'FAILED', explanationError: messageOf(error) },
      });
    }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof HttpException) return error.message;
  return error instanceof Error ? error.message : 'Processing failed';
}
