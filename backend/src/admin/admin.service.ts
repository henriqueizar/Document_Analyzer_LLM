import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { AuditService } from '../audit/audit.service';
import { currentDestinations } from '../common/destinations';

/**
 * The administrator's panel: whether the system is working, and how teams and
 * sharing are organised. Metadata only: no document content, no questions or
 * answers, and private documents appear only as a count per person.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly audit: AuditService,
  ) {}

  async overview() {
    const [health, teams, usage] = await Promise.all([
      this.health(),
      this.teams(),
      this.usage(),
    ]);
    return { health, teams, usage };
  }

  async health() {
    const database = await this.prisma.$queryRaw`SELECT 1`.then(
      () => ({ ok: true }),
      (error: Error) => ({ ok: false, error: error.message }),
    );
    const [llm, queued, reading, writing, readFailed, explainFailed, files] =
      await Promise.all([
        this.llm.status(),
        this.prisma.document.count({ where: { status: 'PENDING' } }),
        this.prisma.document.count({ where: { status: 'PROCESSING' } }),
        this.prisma.document.count({
          where: {
            status: 'COMPLETED',
            explanationStatus: { in: ['PENDING', 'PROCESSING'] },
          },
        }),
        this.prisma.document.count({ where: { status: 'FAILED' } }),
        this.prisma.document.count({ where: { explanationStatus: 'FAILED' } }),
        this.prisma.document.findMany({ select: { filePath: true } }),
      ]);
    let uploadsBytes = 0;
    let missingFiles = 0;
    for (const { filePath } of files) {
      try {
        uploadsBytes += (await fs.stat(path.resolve(filePath))).size;
      } catch {
        missingFiles++;
      }
    }
    // where content goes (checked at startup): shown when it is not this machine
    const destinations = currentDestinations();
    return {
      database: {
        ...database,
        location: destinations?.database.location ?? 'local',
        host: destinations?.database.host,
      },
      llm: { ...llm, location: destinations?.llm.location ?? 'local' },
      queue: { queued, reading, writingExplanation: writing },
      failures: { reading: readFailed, explanation: explainFailed },
      storage: { documents: files.length, uploadsBytes, missingFiles },
    };
  }

  /** Each team with its members and the documents shared with it (name, owner, date, status). */
  async teams() {
    const teams = await this.prisma.team.findMany({
      orderBy: { name: 'asc' },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        shares: {
          orderBy: { createdAt: 'desc' },
          include: {
            document: {
              select: {
                id: true,
                originalName: true,
                status: true,
                explanationStatus: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        },
      },
    });
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      members: t.members
        .map((m) => m.user)
        .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
      documents: t.shares.map((s) => ({
        id: s.document.id,
        name: s.document.originalName,
        owner: s.document.user.name ?? s.document.user.email,
        sharedAt: s.createdAt,
        status: s.document.status,
        explanationStatus: s.document.explanationStatus,
      })),
    }));
  }

  /** Documents per person: a count only (private documents are not listed). */
  async usage() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        _count: { select: { documents: true } },
      },
    });
    return users.map(({ _count, ...u }) => ({
      ...u,
      documents: _count.documents,
    }));
  }

  /** Stops sharing a document with a team (the document stays with its owner). */
  async removeShare(
    teamId: string,
    documentId: string,
    actorEmail: string,
  ): Promise<void> {
    const share = await this.prisma.documentShare.findUnique({
      where: { documentId_teamId: { documentId, teamId } },
      include: {
        team: { select: { name: true } },
        document: { select: { originalName: true } },
      },
    });
    if (!share) throw new NotFoundException('Sharing not found.');
    await this.prisma.documentShare.delete({
      where: { documentId_teamId: { documentId, teamId } },
    });
    await this.audit.record(actorEmail, 'SHARING_REMOVED_BY_ADMIN', {
      documentId,
      target: share.document.originalName,
      details: { team: share.team.name },
    });
  }

  /** The activity log (metadata only). */
  auditLog(filter: { actor?: unknown; action?: unknown; limit?: unknown }) {
    return this.audit.list(filter);
  }
}
