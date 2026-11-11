export const JWT_ISSUER = 'dollma-frontend';
export const JWT_AUDIENCE = 'dollma-backend';
export const MIN_SECRET_LENGTH = 32;

/**
 * Shared secret used to verify tokens minted by the Next.js frontend
 * (frontend/app/api/backend-token/route.ts). Fails closed: the backend
 * refuses to start without a strong secret.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.BACKEND_JWT_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BACKEND_JWT_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long`,
    );
  }
  return new TextEncoder().encode(secret);
}
