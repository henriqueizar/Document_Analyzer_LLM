/**
 * Evaluates the configured LLM against a sample contract, with the real
 * Ollama model (no mocks). Run on the machine that runs Ollama:
 *
 *   npm run eval:llm                      # default context (whole document fits)
 *   LLM_NUM_CTX=4096 npm run eval:llm     # small context: forces passage selection
 *
 * Checks correctness with citations, refusals for questions the document
 * cannot answer (the hallucination traps), and answer language.
 */
import { join } from 'path';
import { OcrService } from '../src/ocr/ocr.service';
import { LlmService } from '../src/llm/llm.service';
import { isInterpretationNotice, isNotFound } from '../src/llm/grounding';
import type { Turn } from '../src/llm/prompts';

try {
  process.loadEnvFile();
} catch {
  // use the process environment
}

interface Case {
  name: string;
  question: string;
  history?: Turn[];
  /** Every pattern must match the answer. */
  expect?: RegExp[];
  /** The answer must be the fixed "not found" sentence. */
  refuse?: boolean;
  /** Interpretation mode (explicitly requested by the user in the app). */
  interpret?: boolean;
  /** Pages the answer may cite; every [p. N] must be one of them (wrong pages fail). */
  pages?: number[];
  /** Which sample document the question is about (default: the contract). */
  doc?: 'contrato' | 'prova' | 'artigo';
}

const CITATION = /\[p\.\s*\d+\]/;
const WARNING = /⚠/;

const cases: Case[] = [
  { name: 'valor mensal', question: 'Qual é o valor mensal do contrato?', expect: [/12\.500,00/, CITATION], pages: [2] },
  { name: 'aviso prévio', question: 'Qual o prazo de aviso prévio para rescindir o contrato?', expect: [/60/, CITATION], pages: [6] },
  { name: 'partes', question: 'Quem é a empresa contratada e quem a representa?', expect: [/Beta Serviços de Limpeza/, /Carlos Eduardo Pereira/, CITATION], pages: [1] },
  { name: 'cláusula por número', question: 'O que diz a cláusula 8?', expect: [/rescind|rescis/i, /60/, CITATION], pages: [6] },
  { name: 'cláusula ordinal', question: 'O que estabelece a cláusula 11?', expect: [/advert[êe]ncia|2%/i, CITATION], pages: [9] },
  { name: 'vigência', question: 'Até quando o contrato vale?', expect: [/31 de janeiro de 2028/, CITATION], pages: [1] },
  {
    name: 'continuação (histórico)',
    question: 'E qual o índice de reajuste?',
    history: [{ question: 'Qual é o valor mensal do contrato?', answer: 'O valor mensal é de R$ 12.500,00 [p. 2].' }],
    expect: [/IPCA/, CITATION],
    pages: [3],
  },
  // With a small context (passage selection), an English question about a Portuguese
  // document shares no keywords with it; a refusal is then the expected safe outcome.
  { name: 'inglês', question: 'Which court has jurisdiction over disputes?', expect: [/Bras[ií]lia/, /\b(the|court|jurisdiction)\b/i, CITATION], pages: [10] },
  // Hallucination traps: the answer is NOT in the document.
  { name: 'fora do escopo', question: 'Qual é a capital da França?', refuse: true },
  { name: 'dado ausente (CNPJ)', question: 'Qual é o CNPJ da contratada?', refuse: true },
  { name: 'dado ausente (multa por atraso de pagamento)', question: 'Qual é a multa se a contratante atrasar o pagamento?', refuse: true },
  { name: 'pergunta capciosa', question: 'Por que o contrato prevê um seguro de R$ 1 milhão?', refuse: true },
  // Strict mode must not chat, talk about itself or judge.
  { name: 'conversa', question: 'Oi, tudo bem?', refuse: true },
  { name: 'pergunta sobre o assistente', question: 'Quantos anos você tem?', refuse: true },
  { name: 'julgamento (modo estrito)', question: 'Este contrato é vantajoso para a contratante?', refuse: true },
  // Interpretation mode (explicit): analysis allowed, kept apart from what the document says.
  {
    name: 'interpretação (modo explícito)',
    question: 'O prazo de aviso prévio para rescisão é longo para a contratante?',
    interpret: true,
    expect: [/No documento:/i, /Interpreta[çc][ãa]o:/i, /60/, CITATION],
  },
  // A document that contains questions and options but no answer key (an
  // internal training quiz): transcribing is fine, choosing an answer is not.
  { name: 'prova: enunciado', doc: 'prova', question: 'Qual é o enunciado da questão 2?', expect: [/tr[êe]s per[íi]odos/i, CITATION], pages: [1] },
  { name: 'prova: escolher a resposta', doc: 'prova', question: 'Qual a resposta da questão 2?', refuse: true },
  { name: 'prova: alternativa correta', doc: 'prova', question: 'Qual alternativa está correta na questão 3?', refuse: true },
  {
    name: 'prova: interpretação (modo explícito)',
    doc: 'prova',
    question: 'Qual alternativa responde a questão 3?',
    interpret: true,
    expect: [/Interpreta[çc][ãa]o:/i, CITATION],
    pages: [2],
  },

  // A paper (fictional): reading the header (title, authors, institutions and
  // e-mails) is reading, not concluding; data that is not there is still refused.
  { name: 'artigo: título', doc: 'artigo', question: 'Qual o título do documento?', expect: [/Previs[ãa]o de Estoques/i, CITATION], pages: [1] },
  { name: 'artigo: e-mails dos autores', doc: 'artigo', question: 'Você consegue ver os e-mails dos autores?', expect: [/ana\.ferreira@uee\.exemplo\.br/, /marcos\.lima@itf\.exemplo\.br/, CITATION], pages: [1] },
  { name: 'artigo: de quem é o e-mail', doc: 'artigo', question: 'O que é marcos.lima@itf.exemplo.br?', expect: [/Marcos/, CITATION], pages: [1] },
  {
    name: 'artigo: depois de uma recusa (histórico)',
    doc: 'artigo',
    question: 'Qual a instituição da Ana Paula Ferreira?',
    history: [{ question: 'Qual o telefone dos autores?', answer: 'Não encontrei essa informação no documento.' }],
    expect: [/Universidade Estadual do Exemplo|UEE/, CITATION],
    pages: [1],
  },
  { name: 'artigo: dado ausente (telefone)', doc: 'artigo', question: 'Qual o telefone dos autores?', refuse: true },
  { name: 'artigo: julgamento (modo estrito)', doc: 'artigo', question: 'Esse artigo é bom?', refuse: true },
];

async function main() {
  const ocr = new OcrService();
  const load = async (file: string) => ({
    name: file,
    text: await ocr.recognizePdf(join(__dirname, '..', 'test', 'fixtures', file)),
  });
  const documents = {
    contrato: await load('contrato-exemplo.pdf'),
    prova: await load('prova-exemplo.pdf'),
    artigo: await load('artigo-exemplo.pdf'),
  };
  const document = documents.contrato;
  const llm = new LlmService();
  console.log(`Model: ${llm.model} | context: ${process.env.LLM_NUM_CTX || 'default (8192)'} tokens\n`);

  let failures = 0;
  const started = Date.now();

  const explanation = (await llm.explainDocument(document)).text;
  const explanationOk =
    !WARNING.test(explanation) && CITATION.test(explanation) && /12\.500,00|limpeza/i.test(explanation);
  failures += explanationOk ? 0 : 1;
  console.log(`${explanationOk ? 'PASS' : 'FAIL'}  explicação\n${indent(explanation)}\n`);

  for (const c of cases) {
    const t0 = Date.now();
    const answer = (
      await llm.askQuestion(documents[c.doc ?? 'contrato'], c.question, c.history ?? [], c.interpret ? 'INTERPRETATION' : 'STRICT')
    ).text;
    const problems: string[] = [];
    if (c.refuse) {
      // the refusal, or the notice that the question needs interpretation
      if (!isNotFound(answer) && !isInterpretationNotice(answer)) {
        problems.push('should have said the document does not state it');
      }
    } else {
      for (const re of c.expect ?? []) if (!re.test(answer)) problems.push(`missing ${re}`);
      if (c.pages) {
        const cited = [...answer.matchAll(/\[p\.\s*(\d+)\]/g)].map((m) => Number(m[1]));
        const wrong = cited.filter((p) => !c.pages!.includes(p));
        if (wrong.length) problems.push(`cites the wrong page (${wrong.join(', ')}; expected ${c.pages.join(' or ')})`);
      }
      if (WARNING.test(answer)) problems.push('automatic grounding check raised a warning');
    }
    failures += problems.length ? 1 : 0;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${c.name} (${secs}s)\n  Q: ${c.question}\n${indent(answer)}`);
    if (problems.length) console.log(`  -> ${problems.join('; ')}`);
    console.log();
  }

  const total = cases.length + 1;
  console.log(`${total - failures}/${total} passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  process.exitCode = failures ? 1 : 0;
}

const indent = (s: string) => s.split('\n').map((l) => `  | ${l}`).join('\n');

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
