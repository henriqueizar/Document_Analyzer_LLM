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
import { isNotFound } from '../src/llm/grounding';
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
}

const CITATION = /\[p\.\s*\d+\]/;
const WARNING = /⚠/;

const cases: Case[] = [
  { name: 'valor mensal', question: 'Qual é o valor mensal do contrato?', expect: [/12\.500,00/, CITATION] },
  { name: 'aviso prévio', question: 'Qual o prazo de aviso prévio para rescindir o contrato?', expect: [/60/, CITATION] },
  { name: 'partes', question: 'Quem é a empresa contratada e quem a representa?', expect: [/Beta Serviços de Limpeza/, /Carlos Eduardo Pereira/, CITATION] },
  { name: 'cláusula por número', question: 'O que diz a cláusula 8?', expect: [/rescind|rescis/i, /60/, CITATION] },
  { name: 'cláusula ordinal', question: 'O que estabelece a cláusula 11?', expect: [/advert[êe]ncia|2%/i, CITATION] },
  { name: 'vigência', question: 'Até quando o contrato vale?', expect: [/31 de janeiro de 2028/, CITATION] },
  {
    name: 'continuação (histórico)',
    question: 'E qual o índice de reajuste?',
    history: [{ question: 'Qual é o valor mensal do contrato?', answer: 'O valor mensal é de R$ 12.500,00 [p. 2].' }],
    expect: [/IPCA/, CITATION],
  },
  // With a small context (passage selection), an English question about a Portuguese
  // document shares no keywords with it; a refusal is then the expected safe outcome.
  { name: 'inglês', question: 'Which court has jurisdiction over disputes?', expect: [/Bras[ií]lia/, /\b(the|court|jurisdiction)\b/i, CITATION] },
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
];

async function main() {
  const fixture = join(__dirname, '..', 'test', 'fixtures', 'contrato-exemplo.pdf');
  const text = await new OcrService().recognizePdf(fixture);
  const llm = new LlmService();
  const document = { name: 'contrato-exemplo.pdf', text };
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
      await llm.askQuestion(document, c.question, c.history ?? [], c.interpret ? 'INTERPRETATION' : 'STRICT')
    ).text;
    const problems: string[] = [];
    if (c.refuse) {
      if (!isNotFound(answer)) problems.push('should have said the information is not in the document');
    } else {
      for (const re of c.expect ?? []) if (!re.test(answer)) problems.push(`missing ${re}`);
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
