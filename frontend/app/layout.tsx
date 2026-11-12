import type { Metadata } from "next";
// Terminal font, bundled and served by this app (no external font service).
import "@fontsource/vt323/latin.css";
import "@fontsource/vt323/latin-ext.css";
import "./globals.css";
import Providers from './providers';
import NavBar from './nav-bar';
import Footer from './footer';

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
    <html lang="pt-BR">
      <body>
        <Providers>
          <NavBar />
          <main className="page">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
