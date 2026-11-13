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
  // Browsers must not offer to send these pages to a cloud translator.
  other: { google: "notranslate" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // translate="no": no automatic page translation (it sends the text to a cloud service).
    // spellCheck={false}: inherited by every field, so the browser's cloud spell checker
    // (e.g. Chrome's enhanced spell check) never receives what is typed here.
    <html lang="pt-BR" translate="no">
      <body spellCheck={false}>
        <Providers>
          <NavBar />
          <main className="page">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
