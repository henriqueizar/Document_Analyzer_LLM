'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const REPOSITORY = 'https://github.com/henriqueizar/Document_Analyzer_LLM';

/**
 * Neutral, sceptical audit prompt: it asks the AI to look for leaks rather than
 * to confirm there are none, so a clean answer actually means something.
 */
const AUDIT_PROMPT = {
  en: `Analyse this repository as a sceptical privacy auditor: ${REPOSITORY}

List every way data could leave the machine it runs on: network calls in the code, external authentication, telemetry and version checks (including from dependencies such as Next.js, Prisma and tesseract.js), CDNs, external fonts or scripts, downloads at run time and browser features (spell checking, translation). For each one, give the file, what data would be sent, whether it is user content or only metadata, whether it happens in development mode, in production or only with a non-default configuration, and whether it can be disabled.

Then answer: during normal use (login, upload, OCR, questions and answers), is any document, extracted text, question, answer or personal data sent outside the machine? Justify by quoting the code. Also say what you could not verify by reading the code alone, and how confident you are.`,
  pt: `Analise este repositório como um auditor de privacidade cético: ${REPOSITORY}

Liste todas as formas pelas quais dados podem sair da máquina onde ele roda: chamadas de rede no código, autenticação externa, telemetria e verificações de versão (inclusive de dependências como Next.js, Prisma e tesseract.js), CDNs, fontes ou scripts externos, downloads em tempo de execução e recursos do navegador (corretor ortográfico, tradução). Para cada uma, indique o arquivo, que dado seria enviado, se é conteúdo do usuário ou só metadados, se ocorre em modo de desenvolvimento, em produção ou só com uma configuração diferente do padrão, e se é desativável.

Depois responda: durante o uso normal (login, upload, OCR, perguntas e respostas), algum documento, texto extraído, pergunta, resposta ou dado pessoal é enviado para fora da máquina? Justifique citando o código. Diga também o que você não conseguiu verificar apenas lendo o código e o seu grau de confiança.`,
};

interface Me {
  privacyAcceptedAt: string | null;
}

export default function PrivacyPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const { language, server } = useI18n();
  // language of the audit text; follows the interface unless changed here
  const [chosen, setLang] = useState<'en' | 'pt' | null>(null);
  const lang = chosen ?? language;
  const pt = language === 'pt';
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
    else setError(server(await errorMessage(res)));
  }

  return (
    <div className="privacy">
      {pt ? <IntroPt /> : <IntroEn />}

      <div className="check">
        <h3>{pt ? '1. Peça a uma IA para auditar o código' : '1. Ask an AI to audit the code'}</h3>
        {pt ? (
          <p>
            Entregue o repositório ao Claude, ChatGPT ou DeepSeek e cole o texto abaixo. Ele pede à
            IA que <em>procure</em> vazamentos, e não que confirme que não há nenhum.
          </p>
        ) : (
          <p>
            Give the repository to Claude, ChatGPT or DeepSeek and paste the text below. It asks the
            AI to <em>look for</em> leaks, not to confirm there are none.
          </p>
        )}
        <div className="button-row left" role="group" aria-label={pt ? 'Idioma do texto' : 'Language of the text'}>
          <button type="button" className="toggle" aria-pressed={lang === 'pt'} onClick={() => setLang('pt')}>Português</button>
          <button type="button" className="toggle" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
        </div>
        <textarea readOnly value={AUDIT_PROMPT[lang]} rows={9} aria-label={pt ? 'Texto da auditoria' : 'Audit prompt'} />
        <button type="button" onClick={copyPrompt}>
          {copied ? (pt ? 'Copiado' : 'Copied') : pt ? 'Copiar texto' : 'Copy text'}
        </button>
        <p>
          <small>
            {pt
              ? 'Uma IA só lê o código do repositório e pode errar. Use também as verificações abaixo.'
              : 'An AI only reads the code in the repository and can make mistakes. Use the checks below as well.'}
          </small>
        </p>
      </div>

      {pt ? <ChecksPt /> : <ChecksEn />}

      {error && <p role="alert" className="error">{error}</p>}
      {accepted === false && (
        <button type="button" className="primary" onClick={accept}>
          {pt ? 'Entendi, continuar' : 'I understand, continue'}
        </button>
      )}
    </div>
  );
}

function IntroEn() {
  return (
    <>
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
        <li>The AI model that explains documents, answers questions and translates (Ollama, on this machine).</li>
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
    </>
  );
}

function IntroPt() {
  return (
    <>
      <h1>Seus documentos ficam nesta máquina</h1>
      <p>
        Este aplicativo analisa e responde perguntas sobre documentos empresariais ou pessoais
        <strong> inteiramente no computador ou servidor onde está instalado</strong>. Durante o uso,
        nenhum documento, texto extraído, pergunta, resposta ou dado pessoal é enviado a serviços
        externos.
      </p>

      <h2>O que roda aqui</h2>
      <ul>
        <li>Leitura de PDFs e reconhecimento de texto (OCR) de imagens e digitalizações.</li>
        <li>O modelo de IA que explica os documentos, responde perguntas e traduz (Ollama, nesta máquina).</li>
        <li>O banco de dados e os arquivos enviados.</li>
        <li>Login: contas locais, sem Google nem outro login externo.</li>
      </ul>
      <p>
        <small>
          A instalação é a única etapa que usa a internet (pacotes, imagens Docker e o modelo de IA).
          Depois disso, o aplicativo funciona offline.
        </small>
      </p>

      <h2>Não acredite só na nossa palavra: verifique</h2>
    </>
  );
}

function ChecksEn() {
  return (
    <>
      <div className="check">
        <h3>2. Use it with the internet off</h3>
        <p>
          Turn off Wi-Fi (or unplug the network cable) and use the application as usual: sign in,
          upload a document, ask questions. Everything keeps working. To watch connections, use an
          outbound firewall such as LuLu (macOS, free). Installed in production mode (the{' '}
          <code>deploy</code> folder), no process of this application connects to external hosts;
          the development server (<code>npm run dev</code>) checks for a newer Next.js version,
          sending no data of yours.
        </p>
      </div>

      <div className="check">
        <h3>3. Run the automatic check</h3>
        <p>
          In the <code>deploy</code> folder, run <code>./verify-egress.sh</code> (needs Docker). It
          starts a temporary production installation, does what users do (sign-in, upload with
          OCR, questions, every page) and records <strong>every connection the application
          attempts</strong>, including those that would fail silently. It fails if any goes outside
          the installation, and it checks that the recording works with a deliberate control
          attempt.
        </p>
      </div>

      <div className="check">
        <h3>Your browser</h3>
        <p>
          The app turns off the browser&apos;s automatic translation and spell checking, which
          would send the text on screen to cloud services. It cannot block the browser&apos;s AI
          features: do not use &quot;Ask Google about this page&quot;, Google Lens or Gemini in
          Chrome with a document open, because they send the page to Google.
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
    </>
  );
}

function ChecksPt() {
  return (
    <>
      <div className="check">
        <h3>2. Use com a internet desligada</h3>
        <p>
          Desligue o Wi-Fi (ou tire o cabo de rede) e use o aplicativo normalmente: faça login, envie
          um documento, faça perguntas. Tudo continua funcionando. Para observar as conexões, use um
          firewall de saída como o LuLu (macOS, gratuito). Instalado em modo produção (a pasta{' '}
          <code>deploy</code>), nenhum processo deste aplicativo se conecta a hosts externos; o
          servidor de desenvolvimento (<code>npm run dev</code>) consulta se há versão nova do
          Next.js, sem enviar nenhum dado seu.
        </p>
      </div>

      <div className="check">
        <h3>3. Rode a verificação automática</h3>
        <p>
          Na pasta <code>deploy</code>, rode <code>./verify-egress.sh</code> (requer Docker). Ele
          sobe uma instalação de produção temporária, faz o que os usuários fazem (login, upload com
          OCR, perguntas, todas as páginas) e registra <strong>toda conexão que o aplicativo
          tenta</strong>, inclusive as que falhariam em silêncio. Falha se alguma for para fora da
          instalação, e confere que o registro funciona com uma tentativa de controle feita de
          propósito.
        </p>
      </div>

      <div className="check">
        <h3>O seu navegador</h3>
        <p>
          O aplicativo desliga a tradução automática e o corretor ortográfico do navegador, que
          mandariam o texto da tela para serviços na nuvem. Ele não tem como bloquear os recursos de
          IA do navegador: não use &quot;Perguntar ao Google sobre esta página&quot;, o Google Lens
          ou o Gemini no Chrome com um documento aberto, porque eles enviam a página ao Google.
        </p>
      </div>

      <h2>LGPD</h2>
      <p>
        O aplicativo foi feito para não transferir dados a terceiros. Esta é uma descrição técnica,
        não uma certificação jurídica de conformidade com a LGPD (Lei 13.709/2018), que também
        depende de como a sua organização o utiliza. O arquivo
        <code> docs/privacidade-lgpd.md</code> lista quais dados pessoais são guardados, onde, e o que
        ainda falta.
      </p>
    </>
  );
}
