import type { Metadata } from "next";
import "./globals.css";
import Providers from './providers';

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
          <main className="page">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
