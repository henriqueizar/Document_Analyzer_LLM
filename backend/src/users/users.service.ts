import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import { defaultLanguage, isLanguage } from '../common/language';

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
  /** False for accounts created before local login that have no password yet. */
  active: boolean;
  /** When the privacy notice was accepted; null until the user reads it. */
  privacyAcceptedAt: Date | null;
  /** Interface and LLM language: 'pt' or 'en'. */
  language: string;
}

export interface NewUser {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
  language?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class UsersService {
  /** Failed login attempts per e-mail, to slow down password guessing. */
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** The first run has no administrator yet: the setup screen creates one. */
  async needsSetup(): Promise<boolean> {
    return (await this.prisma.user.count({ where: { role: 'ADMIN', passwordHash: { not: null } } })) === 0;
  }

  async createFirstAdmin(input: NewUser): Promise<PublicUser> {
    if (!(await this.needsSetup())) {
      throw new ConflictException('The administrator account already exists. Sign in instead.');
    }
    return this.save({ ...input, role: 'ADMIN' }, { allowExisting: true });
  }

  async authenticate(emailInput: unknown, password: unknown): Promise<PublicUser> {
    const email = normalizeEmail(emailInput);
    this.checkThrottle(email);

    const user = email ? await this.prisma.user.findUnique({ where: { email } }) : null;
    const ok = typeof password === 'string' && (await verifyPassword(password, user?.passwordHash));
    if (!user || !ok) {
      this.recordFailure(email);
      // Same message whether the e-mail exists or not.
      throw new UnauthorizedException('Incorrect e-mail or password.');
    }
    this.failures.delete(email);
    return toPublic(user);
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    return user && user.passwordHash ? toPublic(user) : null;
  }

  async me(email: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (!user) throw new NotFoundException('User not found.');
    return toPublic(user);
  }

  async setLanguage(email: string, language: unknown): Promise<PublicUser> {
    if (!isLanguage(language)) throw new BadRequestException('Language must be "pt" or "en".');
    const user = await this.prisma.user.update({
      where: { email: normalizeEmail(email) },
      data: { language },
    });
    return toPublic(user);
  }

  async acceptPrivacyNotice(email: string): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { email: normalizeEmail(email) },
      data: { privacyAcceptedAt: new Date() },
    });
    return toPublic(user);
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toPublic);
  }

  /** Admin creates an account (or activates one created before local login). */
  async create(input: NewUser): Promise<PublicUser> {
    return this.save(input, { allowExisting: true });
  }

  async resetPassword(id: string, password: unknown): Promise<PublicUser> {
    const problem = passwordProblem(password);
    if (problem) throw new BadRequestException(problem);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found.');
    const updated = await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(password as string) },
    });
    return toPublic(updated);
  }

  async changeOwnPassword(email: string, current: unknown, next: unknown): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (!user || typeof current !== 'string' || !(await verifyPassword(current, user.passwordHash))) {
      throw new BadRequestException('The current password is incorrect.');
    }
    const problem = passwordProblem(next);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(next as string) },
    });
  }

  private async save(input: NewUser, { allowExisting }: { allowExisting: boolean }): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    if (!EMAIL.test(email)) throw new BadRequestException('Enter a valid e-mail address.');
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('Enter a name.');
    const problem = passwordProblem(input.password);
    if (problem) throw new BadRequestException(problem);
    const role: Role = input.role === 'ADMIN' ? 'ADMIN' : 'USER';

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.passwordHash) {
      throw new ConflictException('A user with this e-mail already exists.');
    }
    const data = {
      name,
      role,
      passwordHash: await hashPassword(input.password as string),
      language: isLanguage(input.language) ? input.language : defaultLanguage(),
    };
    // Accounts created before local login (e.g. via Google) keep their documents.
    const user =
      existing && allowExisting
        ? await this.prisma.user.update({ where: { id: existing.id }, data })
        : await this.prisma.user.create({ data: { email, ...data } });
    return toPublic(user);
  }

  private checkThrottle(email: string) {
    const entry = this.failures.get(email);
    if (!entry) return;
    if (Date.now() - entry.since > LOGIN_WINDOW_MS) {
      this.failures.delete(email);
    } else if (entry.count >= LOGIN_ATTEMPTS) {
      throw new HttpException(
        'Too many failed attempts. Wait 15 minutes or ask the administrator to reset your password.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordFailure(email: string) {
    const entry = this.failures.get(email);
    if (!entry || Date.now() - entry.since > LOGIN_WINDOW_MS) {
      this.failures.set(email, { count: 1, since: Date.now() });
    } else {
      entry.count += 1;
    }
  }
}

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function toPublic(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    active: Boolean(user.passwordHash),
    privacyAcceptedAt: user.privacyAcceptedAt ?? null,
    language: user.language,
  };
}
