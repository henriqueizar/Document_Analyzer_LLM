import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server, only for the production image (frontend/Dockerfile);
  // `npm run dev` and `npm start` keep working as usual.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
