import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
// The API: the same address in production (/backend), another port in development.
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const apiOrigin = /^https?:\/\//.test(api) ? new URL(api).origin : "";

/**
 * Content Security Policy: the browser may load and contact only this app
 * (and, in development, the API port). Nothing from other sites, and the app
 * cannot be embedded elsewhere. Inline scripts are needed by Next.js itself.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
  // the document preview: a blob: URL in a frame (PDFs use the browser's viewer)
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Self-contained server, only for the production image (frontend/Dockerfile);
  // `npm run dev` and `npm start` keep working as usual.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
