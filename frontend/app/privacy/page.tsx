'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';

const REPOSITORY = 'https://github.com/henriqueizar/Document_Analyzer_LLM';

/**
 * Neutral, sceptical audit prompt: it asks the AI to look for leaks rather than
 * to confirm there are none, so a clean answer actually means something.
 */
const AUDIT_PROMPT = {
  en: `Analyse this repository as a sceptical privacy auditor: ${REPOSITORY}

List every way data could leave the machine it runs on: network calls in the code, external authentication, telemetry (including from dependencies such as Next.js, Prisma and tesseract.js), CDNs, external fonts or scripts, and downloads at run time. For each one, give the file, what data would be sent and whether it can be disabled.

Then answer: during normal use (login, upload, OCR, questions and answers), is any document, extracted text, question, answer or personal data sent outside the machine? Justify by quoting the code.`,
  pt: `Analise este repositório como um auditor de privacidade cético: ${REPOSITORY}

Liste todas as formas pelas quais dados podem sair da máquina onde ele roda: chamadas de rede no código, autenticação externa, telemetria (inclusive de dependências como Next.js, Prisma e tesseract.js), CDNs, fontes ou scripts externos e downloads em tempo de execução. Para cada uma, indique o arquivo, que dado seria enviado e se é desativável.

Depois responda: durante o uso normal (login, upload, OCR, perguntas e respostas), algum documento, texto extraído, pergunta, resposta ou dado pessoal é enviado para fora da máquina? Justifique citando o código.`,
};

interface Me {
  privacyAcceptedAt: string | null;
}

export default function PrivacyPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [lang, setLang] = useState<'en' | 'pt'>('en');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = session?.user.email;
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    apiFetch('/auth/me')
      .then((r) => r.json() as Promise<Me>)
      .then((me) => !cancelled && setAccepted(Boolean(me.privacyAcceptedAt)))
      .catch(() => !cancelled && setAccepted(true));
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function copyPrompt() {
    await navigator.clipboard.writeText(AUDIT_PROMPT[lang]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function accept() {
    const res = await apiFetch('/auth/me/privacy', { method: 'POST' });
    if (res.ok) router.replace('/');
    else setError(await errorMessage(res));
  }

  return (
    <div className="privacy">
      <h1>Your documents stay on this machine</h1>
      <p>
        This application analyses and answers questions about business or personal documents
        <strong> entirely on the computer or server where it is installed</strong>. While you use
        it, no document, extracted text, question, answer or personal data is sent to external
        services.
      </p>

      <h2>What runs here</h2>
      <ul>
        <li>Reading PDFs and text recognition (OCR) of images and scans.</li>
        <li>The AI model that explains documents and answers questions (Ollama, on this machine).</li>
        <li>The database and the uploaded files.</li>
        <li>Login: local accounts, no Google or other external sign-in.</li>
      </ul>
      <p>
        <small>
          Installation is the only step that uses the internet (packages, Docker images and the AI
          model). After that, the application works offline.
        </small>
      </p>

      <h2>Don&apos;t take our word for it: check</h2>

      <div className="check">
        <h3>1. Ask an AI to audit the code</h3>
        <p>
          Give the repository to Claude, ChatGPT or DeepSeek and paste the text below. It asks the
          AI to <em>look for</em> leaks, not to confirm there are none.
        </p>
        <div className="button-row left" role="group" aria-label="Language of the text">
          <button type="button" className="toggle" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          <button type="button" className="toggle" aria-pressed={lang === 'pt'} onClick={() => setLang('pt')}>Português</button>
        </div>
        <textarea readOnly value={AUDIT_PROMPT[lang]} rows={9} aria-label="Audit prompt" />
        <button type="button" onClick={copyPrompt}>{copied ? 'Copied' : 'Copy text'}</button>
        <p>
          <small>
            An AI only reads the code in the repository and can make mistakes. Use the checks below
            as well.
          </small>
        </p>
      </div>

      <div className="check">
        <h3>2. Use it with the internet off</h3>
        <p>
          Turn off Wi-Fi (or unplug the network cable) and use the application as usual: sign in,
          upload a document, ask questions. Everything keeps working. To watch connections, use an
          outbound firewall such as LuLu (macOS, free): no process of this application connects to
          external hosts.
        </p>
      </div>

      <div className="check">
        <h3>3. Run the automatic check</h3>
        <p>
          In the <code>backend</code> folder, run <code>npm run verify:offline</code> (needs
          Docker). It runs the full flow (login, upload, OCR, questions) in a container with
          <strong> no route to the internet</strong>, after first proving that the container cannot
          reach any external host.
        </p>
      </div>

      <h2>LGPD</h2>
      <p>
        The application is designed not to transfer data to third parties. This is a technical
        description, not a legal certification of compliance with the LGPD (Lei 13.709/2018),
        which also depends on how your organisation uses it. The file
        <code> docs/privacidade-lgpd.md</code> lists what personal data is stored, where, and what is
        still missing.
      </p>

      {error && <p role="alert" className="error">{error}</p>}
      {accepted === false && (
        <button type="button" className="primary" onClick={accept}>
          I understand, continue
        </button>
      )}
    </div>
  );
}
