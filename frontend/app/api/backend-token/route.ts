import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SignJWT } from "jose";
import { authOptions } from "@/lib/auth";

// Must match backend/src/auth/auth.constants.ts
const JWT_ISSUER = "dollma-frontend";
const JWT_AUDIENCE = "dollma-backend";
const TOKEN_TTL_SECONDS = 5 * 60;

export const dynamic = "force-dynamic";

/**
 * Exchanges the NextAuth session (httpOnly cookie, verified server-side) for a
 * short-lived token the NestJS backend can verify with BACKEND_JWT_SECRET.
 * The browser never sees the secret, and the backend never trusts a bare
 * e-mail header again.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const secret = process.env.BACKEND_JWT_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { error: "BACKEND_JWT_SECRET is not configured" },
      { status: 500 },
    );
  }

  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json(
    { token, expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
