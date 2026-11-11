import type { Metadata } from "next";
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
            Runs entirely on this machine. <Link href="/privacy">Privacy</Link>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
