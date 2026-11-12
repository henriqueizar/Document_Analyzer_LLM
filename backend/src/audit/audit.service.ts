import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  documentId?: string | null;
  /** What the action was about, as shown to the administrator (file, team, account). */
  target?: string | null;
  /** Small non-content details. Never the text of questions, answers or documents. */
  details?: Record<string, unknown>;
}

/** Repeated views of the same document by the same person count once per window. */
const REPEAT_WINDOW_MS = 10 * 60 * 1000;
const REPEATABLE = new Set(['DOCUMENT_VIEW', 'DOCUMENT_DOWNLOAD']);

/**
 * Activity log (metadata only). Recording never breaks the action being
 * recorded: a failure is logged and the request goes on.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    actorEmail: string,
    action: string,
    entry: AuditEntry = {},
  ): Promise<void> {
    try {
      if (REPEATABLE.has(action)) {
        const recent = await this.prisma.auditEvent.findFirst({
          where: {
            actorEmail,
            action,
            documentId: entry.documentId ?? null,
            createdAt: { gt: new Date(Date.now() - REPEAT_WINDOW_MS) },
          },
          select: { id: true },
        });
        if (recent) return;
      }
      await this.prisma.auditEvent.create({
        data: {
          actorEmail,
          action,
          documentId: entry.documentId ?? null,
          target: entry.target ?? null,
          details: entry.details as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Could not record ${action} by ${actorEmail}`, error);
    }
  }

  /** Most recent events first, optionally for one person or one action. */
  async list(
    filter: { actor?: unknown; action?: unknown; limit?: unknown } = {},
  ) {
    const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 1000);
    return this.prisma.auditEvent.findMany({
      where: {
        ...(typeof filter.actor === 'string' && filter.actor
          ? { actorEmail: filter.actor.toLowerCase() }
          : {}),
        ...(typeof filter.action === 'string' && filter.action
          ? { action: filter.action }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
