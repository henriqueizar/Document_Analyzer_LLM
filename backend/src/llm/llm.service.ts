import { Injectable, Logger } from '@nestjs/common';
import { stripPreamble } from './clean-response';
import { OllamaClient, ollamaConfigFromEnv } from './ollama.client';
import { formatPassages, leading, selectPassages, splitIntoPassages, Passage } from './passages';
import { detectLanguage, Language } from './language';
import {
  answerMessages,
  DocumentContext,
  NOT_FOUND,
  explainMessages,
  partialExplanationNote,
  Turn,
} from './prompts';
import { checkGrounding, groundingWarning, hasCitation, isNotFound } from './grounding';

export { DEFAULT_LLM_MODEL } from './ollama.client';

export interface DocumentInput {
  name: string;
  text: string;
}

/** Rough size of a token in characters (Portuguese/English, conservative). */
const CHARS_PER_TOKEN = 3;
/** Tokens kept free for instructions, chat history and the answer itself. */
const RESERVED_TOKENS = { answer: 1800, explain: 1600 };
const MAX_TOKENS = { answer: 500, explain: 700 };
/** Previous question/answer pairs sent to resolve follow-ups ("and clause 9?"). */
const HISTORY_TURNS = 3;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OllamaClient;
  readonly model: string;
  private readonly numCtx: number;

  constructor() {
    const config = ollamaConfigFromEnv();
    this.client = new OllamaClient(config);
    this.model = config.model;
    this.numCtx = config.numCtx;
    this.logger.log(
      `Using LLM "${config.model}" at ${config.baseUrl} (context ${config.numCtx} tokens)`,
    );
  }

  /** Automatic explanation shown when a document is processed. */
  async explainDocument(document: DocumentInput): Promise<string> {
    const lang = detectLanguage(document.text);
    const passages = splitIntoPassages(document.text);
    const budget = this.budget(RESERVED_TOKENS.explain);
    const selected = leading(passages, budget);
    const doc = this.context(document, passages, selected);

    const raw = await this.client.chat(explainMessages(lang, doc), {
      temperature: 0,
      maxTokens: MAX_TOKENS.explain,
    });
    let explanation = stripPreamble(raw);

    explanation = this.withGroundingCheck(explanation, doc, lang, { requireCitation: false });
    if (!doc.complete) explanation += `\n\n${partialExplanationNote(lang, doc)}`;
    return explanation;
  }

  /** Answers a question using only passages of the document. */
  async askQuestion(document: DocumentInput, question: string, history: Turn[] = []): Promise<string> {
    const lang = detectLanguage(question, detectLanguage(document.text));
    const passages = splitIntoPassages(document.text);
    const recent = history.slice(-HISTORY_TURNS);
    // Follow-ups ("e a seguinte?") need the previous question's terms to find passages.
    const searchText = [...recent.map((t) => t.question), question].join('\n');
    const historyChars = recent.reduce((n, t) => n + t.question.length + t.answer.length, 0);
    const budget = this.budget(RESERVED_TOKENS.answer) - historyChars;
    const selection = selectPassages(passages, searchText, budget);
    const doc = this.context(document, passages, selection.passages);

    const raw = await this.client.chat(answerMessages(lang, doc, question, recent), {
      temperature: 0,
      maxTokens: MAX_TOKENS.answer,
    });
    const answer = stripPreamble(raw) || '';
    if (!answer) return lang === 'pt' ? 'O modelo não retornou resposta.' : 'The model returned an empty response.';
    // "A multa não está especificada. Não encontrei essa informação no documento."
    // -> just the standard sentence. Answers that cite pages carry real content
    // (e.g. one part found, another not) and are kept as they are.
    if (isNotFound(answer) && !hasCitation(answer)) return NOT_FOUND[lang];

    return this.withGroundingCheck(answer, doc, lang, { requireCitation: true, ignore: question });
  }

  private withGroundingCheck(
    text: string,
    doc: DocumentContext,
    lang: Language,
    options: { requireCitation: boolean; ignore?: string },
  ): string {
    const result = checkGrounding(text, { text: doc.excerpts, pages: doc.pages }, lang, options);
    if (result.ok) return text;
    this.logger.warn(`Grounding check failed: ${result.problems.join('; ')}`);
    return `${text}\n\n${groundingWarning(lang, result)}`;
  }

  private context(document: DocumentInput, all: Passage[], selected: Passage[]): DocumentContext {
    const totalPages = all.reduce((max, p) => Math.max(max, p.page), 0) || 1;
    return {
      name: document.name,
      excerpts: formatPassages(selected),
      totalPages,
      pages: [...new Set(selected.map((p) => p.page))],
      complete: selected.length === all.length,
    };
  }

  /** Characters of document text that fit next to the instructions and answer. */
  private budget(reservedTokens: number): number {
    return Math.max(2000, (this.numCtx - reservedTokens) * CHARS_PER_TOKEN);
  }
}
