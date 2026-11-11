import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

/** Backend URL as seen from the Next.js server (same machine). */
const BACKEND_URL =
  process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Role = "ADMIN" | "USER";

/**
 * Local accounts only: the e-mail and password are checked by this
 * application's backend. No external identity provider is involved.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "E-mail and password",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const res = await fetch(`${BACKEND_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: credentials?.email, password: credentials?.password }),
        });
        if (res.status === 429) {
          throw new Error("Too many failed attempts. Wait 15 minutes or ask the administrator to reset your password.");
        }
        if (!res.ok) return null;
        const user = (await res.json()) as { id: string; email: string; name: string | null; role: Role };
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    // Re-login after 12 hours.
    maxAge: 12 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: Role }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
};
