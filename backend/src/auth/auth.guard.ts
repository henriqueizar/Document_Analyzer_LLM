import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtVerify } from 'jose';
import type { Request } from 'express';
import { getJwtSecret, JWT_AUDIENCE, JWT_ISSUER } from './auth.constants';

export interface AuthUser {
  email: string;
}

export type AuthenticatedRequest = Request & { user: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret = getJwtSecret();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || !payload.sub.includes('@')) {
        throw new Error('token subject is not an e-mail');
      }
      request.user = { email: payload.sub.toLowerCase() };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
