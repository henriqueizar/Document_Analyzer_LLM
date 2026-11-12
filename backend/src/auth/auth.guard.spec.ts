import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AdminGuard, AuthGuard } from './auth.guard';
import { JWT_AUDIENCE, JWT_ISSUER } from './auth.constants';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const key = (s: string) => new TextEncoder().encode(s);

function sign(
  overrides: { sub?: string; iss?: string; aud?: string; exp?: string | number; secret?: string } = {},
) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(overrides.sub ?? 'Alice@Example.com')
    .setIssuer(overrides.iss ?? JWT_ISSUER)
    .setAudience(overrides.aud ?? JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '5m')
    .sign(key(overrides.secret ?? SECRET));
}

function contextWith(authorization?: string) {
  const request: Record<string, unknown> = { headers: { authorization } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

const ALICE = { id: 'u1', email: 'alice@example.com', name: 'Alice', role: 'USER', passwordHash: 'scrypt$...' };

describe('AuthGuard', () => {
  const original = process.env.BACKEND_JWT_SECRET;
  const prisma = { user: { findUnique: jest.fn() } };
  let guard: AuthGuard;

  beforeAll(() => {
    process.env.BACKEND_JWT_SECRET = SECRET;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    guard = new AuthGuard(prisma as any);
  });
  beforeEach(() => {
    prisma.user.findUnique.mockReset().mockResolvedValue(ALICE);
  });
  afterAll(() => {
    process.env.BACKEND_JWT_SECRET = original;
  });

  it('accepts a valid token and exposes the (lower-cased) e-mail', async () => {
    const { context, request } = contextWith(`Bearer ${await sign()}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alice@example.com' } });
    expect(request.user).toEqual({ id: 'u1', email: 'alice@example.com', name: 'Alice', role: 'USER', language: 'pt' });
  });

  it('rejects a valid token whose account no longer exists or has no password', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(guard.canActivate(contextWith(`Bearer ${await sign()}`).context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    prisma.user.findUnique.mockResolvedValueOnce({ ...ALICE, passwordHash: null });
    await expect(guard.canActivate(contextWith(`Bearer ${await sign()}`).context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['no header', undefined],
    ['wrong scheme', 'Basic abc'],
    ['the old user-id style value', 'alice@example.com'],
  ])('rejects %s', async (_, header) => {
    await expect(guard.canActivate(contextWith(header).context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['signed with another secret', () => sign({ secret: 'another-secret-that-is-at-least-32-chars!!' })],
    ['expired', () => sign({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ['wrong audience', () => sign({ aud: 'someone-else' })],
    ['wrong issuer', () => sign({ iss: 'someone-else' })],
    ['subject that is not an e-mail', () => sign({ sub: 'not-an-email' })],
  ])('rejects a token %s', async (_, make) => {
    const { context } = contextWith(`Bearer ${await make()}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unsigned (alg: none) token', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = `${b64({ alg: 'none' })}.${b64({ sub: 'alice@example.com', iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp })}.`;
    const { context } = contextWith(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses to start without a strong secret', () => {
    process.env.BACKEND_JWT_SECRET = 'short';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new AuthGuard(prisma as any)).toThrow(/BACKEND_JWT_SECRET/);
    process.env.BACKEND_JWT_SECRET = SECRET;
  });
});

describe('AdminGuard', () => {
  const ctx = (role?: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }) }) as unknown as ExecutionContext;

  it('lets administrators through and refuses everyone else', () => {
    const guard = new AdminGuard();
    expect(guard.canActivate(ctx('ADMIN'))).toBe(true);
    expect(() => guard.canActivate(ctx('USER'))).toThrow(/Only administrators/);
    expect(() => guard.canActivate(ctx())).toThrow(/Only administrators/);
  });
});
