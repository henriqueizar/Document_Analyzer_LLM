import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface TeamSummary {
  id: string;
  name: string;
}

/**
 * Teams (usually departments) that documents can be shared with. Only
 * administrators manage them; an installation used by one person has none,
 * and then nothing about teams is shown.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every team with its members and how many documents are shared with it (no document content). */
  async list() {
    const teams = await this.prisma.team.findMany({
      orderBy: { name: 'asc' },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        _count: { select: { shares: true } },
      },
    });
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      members: t.members
        .map((m) => m.user)
        .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
      sharedDocuments: t._count.shares,
    }));
  }

  /** Teams the user belongs to. */
  async mine(userId: string): Promise<TeamSummary[]> {
    return this.prisma.team.findMany({
      where: { members: { some: { userId } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  async create(name: unknown, actorEmail: string) {
    const clean = teamName(name);
    try {
      const team = await this.prisma.team.create({
        data: { name: clean },
        select: { id: true, name: true },
      });
      await this.audit.record(actorEmail, 'TEAM_CREATED', {
        target: team.name,
      });
      return team;
    } catch (error) {
      throw uniqueName(error);
    }
  }

  async rename(id: string, name: unknown, actorEmail: string) {
    const clean = teamName(name);
    const before = await this.find(id);
    try {
      const team = await this.prisma.team.update({
        where: { id },
        data: { name: clean },
        select: { id: true, name: true },
      });
      await this.audit.record(actorEmail, 'TEAM_RENAMED', {
        target: team.name,
        details: { from: before.name },
      });
      return team;
    } catch (error) {
      throw uniqueName(error);
    }
  }

  /** Deletes the team: its members lose access to the documents shared with it (the documents stay with their owners). */
  async remove(id: string, actorEmail: string): Promise<void> {
    const team = await this.find(id);
    await this.prisma.team.delete({ where: { id } });
    await this.audit.record(actorEmail, 'TEAM_DELETED', { target: team.name });
  }

  /** Membership decides who sees shared documents: every change is recorded. */
  async addMember(
    teamId: string,
    userId: unknown,
    actorEmail: string,
  ): Promise<void> {
    const team = await this.find(teamId);
    const user =
      typeof userId === 'string'
        ? await this.prisma.user.findUnique({ where: { id: userId } })
        : null;
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    await this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId: user.id } },
      update: {},
      create: { teamId, userId: user.id },
    });
    await this.audit.record(actorEmail, 'TEAM_MEMBER_ADDED', {
      target: `${team.name}: ${user.email}`,
    });
  }

  async removeMember(
    teamId: string,
    userId: string,
    actorEmail: string,
  ): Promise<void> {
    const team = await this.find(teamId);
    const { count } = await this.prisma.teamMember.deleteMany({
      where: { teamId, userId },
    });
    if (count) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      await this.audit.record(actorEmail, 'TEAM_MEMBER_REMOVED', {
        target: `${team.name}: ${user?.email ?? userId}`,
      });
    }
  }

  private async find(id: string) {
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Team not found.');
    return team;
  }
}

function teamName(name: unknown): string {
  const clean =
    typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!clean) throw new BadRequestException('Enter a team name.');
  if (clean.length > 60)
    throw new BadRequestException(
      'The team name must have at most 60 characters.',
    );
  return clean;
}

function uniqueName(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return new ConflictException('A team with this name already exists.');
  }
  return error;
}
