import type { Metadata } from "next";
// Terminal font, bundled and served by this app (no external font service).
import "@fontsource/vt323/latin.css";
import "@fontsource/vt323/latin-ext.css";
import "./globals.css";
import Providers from './providers';
import NavBar from './nav-bar';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "Document LLM Analyzer",
  description: "Upload a document, get an explanation and ask questions about it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <NavBar />
          <main className="page">{children}</main>
          <footer className="footer">
            <Link href="/privacy">This program runs entirely on this machine.</Link>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
