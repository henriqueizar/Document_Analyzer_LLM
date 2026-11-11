import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtVerify } from 'jose';
import type { Request } from 'express';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret, JWT_AUDIENCE, JWT_ISSUER } from './auth.constants';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

export type AuthenticatedRequest = Request & { user: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret = getJwtSecret();

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let email: string;
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || !payload.sub.includes('@')) {
        throw new Error('token subject is not an e-mail');
      }
      email = payload.sub.toLowerCase();
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Looked up on every request: a removed account or a changed role takes
    // effect immediately, not when the token expires.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Account not found or not active');
    }
    request.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    return true;
  }
}

/** Use after AuthGuard: only administrators pass. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user?.role !== 'ADMIN') {
      throw new ForbiddenException('Only administrators can do this.');
    }
    return true;
  }
}
