import { Injectable, Logger } from '@nestjs/common';
import { stripPreamble } from './clean-response';
import { ChatMessage, ChatOptions, OllamaClient, ollamaConfigFromEnv } from './ollama.client';
import { formatPassages, leading, selectPassages, splitIntoPassages, Passage } from './passages';
import { detectLanguage, Language } from './language';
import {
  AnswerMode,
  answerMessages,
  DocumentContext,
  NEEDS_INTERPRETATION,
  NOT_FOUND,
  explainMessages,
  partialExplanationNote,
  Turn,
} from './prompts';
import {
  asksToChooseAnswer,
  checkGrounding,
  groundingWarning,
  hasCitation,
  isInterpretationNotice,
  isNegativeOnly,
  isNotFound,
  unsupportedJudgement,
} from './grounding';
import { attributeCitations, Source } from './citations';

export { DEFAULT_LLM_MODEL } from './ollama.client';

export interface DocumentInput {
  name: string;
  text: string;
}

/** An explanation or answer, with the document passages the model was given. */
export interface LlmResult {
  text: string;
  /** Language the text was written in. */
  language?: Language;
  /** What each [p. N] in `text` can refer to: exactly what the model saw. */
  sources: Source[];
}

/** Rough size of a token in characters (Portuguese/English, conservative). */
const CHARS_PER_TOKEN = 3;
/** Tokens kept free for instructions, chat history and the answer itself. */
const RESERVED_TOKENS = { answer: 1800, explain: 1600 };
const MAX_TOKENS = { answer: 500, explain: 700, interpretation: 700 };
/**
 * Share of the context window for earlier questions and answers. As many
 * recent turns as fit are sent (whole conversation when it is short); the
 * oldest are dropped first, so the document excerpts always keep their room.
 */
const HISTORY_SHARE = 0.25;
/** Turns whose questions are also used to find passages for follow-ups. */
const SEARCH_TURNS = 3;

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

  /** Health of the local LLM, for the administrator's panel. */
  async status() {
    return { model: this.model, url: this.client.config.baseUrl, ...(await this.client.status()) };
  }

  /** Automatic explanation shown when a document is processed. */
  /** `language`: the reader's preference; when absent, the document's language. */
  async explainDocument(document: DocumentInput, language?: Language): Promise<LlmResult> {
    const lang = language ?? detectLanguage(document.text);
    const passages = splitIntoPassages(document.text);
    const budget = this.budget(RESERVED_TOKENS.explain);
    const selected = leading(passages, budget);
    const doc = this.context(document, passages, selected);
    const sources = toSources(selected);

    const raw = await this.chatIn(lang, explainMessages(lang, doc), {
      temperature: 0,
      maxTokens: MAX_TOKENS.explain,
    });
    // One citation per sentence, computed by code when the model piled them up.
    let explanation = attributeCitations(stripPreamble(raw), sources);

    explanation = this.withGroundingCheck(explanation, doc, lang, { requireCitation: true });
    if (!doc.complete) explanation += `\n\n${partialExplanationNote(lang, doc)}`;
    return { text: explanation, sources, language: lang };
  }

  /**
   * Answers a question about the document.
   *
   * STRICT (default): only what the document states. An answer that cannot be
   * tied to the excerpts (no citation from the model and no sentence that
   * clearly matches a passage) is replaced by the refusal sentence, so small
   * talk or invented facts ("Tenho 3 anos de idade") never reach the user.
   *
   * INTERPRETATION: only when the user explicitly asks for it. The model may
   * analyse; the answer is kept and the application labels it as interpretation.
   * Page and number checks apply in both modes.
   */
  async askQuestion(
    document: DocumentInput,
    question: string,
    history: Turn[] = [],
    mode: AnswerMode = 'STRICT',
    language?: Language,
  ): Promise<LlmResult> {
    // The reader's preference; without one, the language of the question.
    const lang = language ?? detectLanguage(question, detectLanguage(document.text));
    const passages = splitIntoPassages(document.text);
    const recent = this.fitHistory(history);
    // Follow-ups ("e a seguinte?") need the previous questions' terms to find passages.
    const searchText = [...recent.slice(-SEARCH_TURNS).map((t) => t.question), question].join('\n');
    const historyChars = recent.reduce((n, t) => n + t.question.length + t.answer.length, 0);
    const budget = this.budget(RESERVED_TOKENS.answer) - historyChars;
    const selection = selectPassages(passages, searchText, budget);
    const doc = this.context(document, passages, selection.passages);
    const sources = toSources(selection.passages);

    // Earlier refusals carry no information and lead small models to refuse
    // again ("Não encontrei..." three times in a row); they are not sent.
    const conversation = recent.filter(
      (t) => !(isNotFound(t.answer) && !hasCitation(t.answer)) && !isInterpretationNotice(t.answer),
    );
    // Choosing an exercise's answer is the model's own conclusion: refused in
    // strict mode before asking, unless the document has its own answer key.
    if (mode === 'STRICT' && asksToChooseAnswer(question, document.text)) {
      this.logger.warn('Question asks to choose an exercise answer; pointed to Interpret');
      return { text: NEEDS_INTERPRETATION.exercise[lang], sources, language: lang };
    }
    const raw = await this.chatIn(lang, answerMessages(lang, doc, question, conversation, mode), {
      temperature: 0,
      maxTokens: mode === 'INTERPRETATION' ? MAX_TOKENS.interpretation : MAX_TOKENS.answer,
    });
    const answer = stripPreamble(raw) || '';
    if (!answer) {
      return { text: lang === 'pt' ? 'O modelo não retornou resposta.' : 'The model returned an empty response.', sources, language: lang };
    }
    // "A multa não está especificada. Não encontrei essa informação no documento."
    // -> just the standard sentence. Answers that cite pages carry real content
    // (e.g. one part found, another not) and are kept as they are.
    if (isNotFound(answer) && !hasCitation(answer)) return { text: NOT_FOUND[lang], sources, language: lang };
    // A refusal in the model's own words ("... não está mencionada no documento. [p. 4]")
    // is shown as the standard sentence, without a misleading page.
    if (isNegativeOnly(answer)) return { text: NOT_FOUND[lang], sources, language: lang };

    // Cite, by code, sentences that clearly come from a passage.
    const cited = attributeCitations(answer, sources);
    if (mode === 'STRICT' && !hasCitation(cited)) {
      this.logger.warn(`Answer not tied to the document, replaced by the refusal: ${JSON.stringify(answer.slice(0, 120))}`);
      return { text: NOT_FOUND[lang], sources, language: lang };
    }
    // Picking an exercise's answer or judging is the model's own conclusion even
    // when the quoted option is in the document: strict mode does not show it.
    const judgement = mode === 'STRICT' ? unsupportedJudgement(cited, doc.excerpts) : null;
    if (judgement) {
      this.logger.warn(`Judgement not stated in the document ("${judgement}"), pointed to Interpret`);
      return { text: NEEDS_INTERPRETATION.judgement[lang], sources, language: lang };
    }

    return {
      text: this.withGroundingCheck(cited, doc, lang, { requireCitation: true, ignore: question }),
      sources,
      language: lang,
    };
  }

  /**
   * Small models sometimes answer in English even when told to write in
   * Portuguese (more so when the excerpts contain English). When the reply
   * comes back in the wrong language, ask once more with an explicit
   * reminder at the end of the request.
   */
  /**
   * Translates an explanation or answer for a reader of another language. The
   * original is never replaced; the translation is shown as such. Citations and
   * numbers must survive unchanged: if they do not, it is tried once more and,
   * failing that, returned with verified = false so the reader is warned.
   */
  async translate(text: string, to: Language): Promise<{ text: string; verified: boolean }> {
    const instructions =
      to === 'pt'
        ? 'Traduza o texto do usuário para o português do Brasil. Regras: traduza fielmente, sem resumir, acrescentar ou comentar; mantenha exatamente cada marcador [p. N], todos os números, valores, datas e nomes próprios; mantenha as quebras de parágrafo; responda apenas com a tradução.'
        : 'Translate the user\'s text into English. Rules: translate faithfully, without summarising, adding or commenting; keep every [p. N] marker, number, amount, date and proper name exactly; keep paragraph breaks; reply with the translation only.';
    let best = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.client.chat(
        [
          { role: 'system', content: instructions },
          { role: 'user', content: text },
        ],
        { temperature: 0, maxTokens: MAX_TOKENS.explain + 300 },
      );
      best = stripPreamble(raw);
      if (sameCitationsAndNumbers(text, best)) return { text: best, verified: true };
      this.logger.warn('Translation changed citations or numbers; trying again');
    }
    return { text: best, verified: false };
  }

  private async chatIn(lang: Language, messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const first = await this.client.chat(messages, options);
    if (!this.wrongLanguage(first, lang)) return first;

    this.logger.warn(`Reply not in ${lang}; asking again with an explicit language reminder`);
    const reminder =
      lang === 'pt'
        ? '\n\nIMPORTANTE: escreva toda a resposta em português do Brasil, mesmo que o documento esteja em outro idioma. Citações literais do documento podem ficar no idioma original.'
        : '\n\nIMPORTANT: write the whole answer in English, even if the document is in another language. Literal quotes from the document may stay in their original language.';
    const last = messages[messages.length - 1];
    const second = await this.client.chat(
      [...messages.slice(0, -1), { ...last, content: last.content + reminder }],
      options,
    );
    return second;
  }

  /** Long enough to judge, not a refusal, and clearly in the other language. */
  private wrongLanguage(text: string, lang: Language): boolean {
    const plain = text.replace(/\[\s*p\.?\s*\d+\s*\]/gi, '').trim();
    if (isNotFound(plain) || plain.split(/\s+/).length < 8) return false;
    return detectLanguage(plain, lang) !== lang;
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

  /** The most recent turns that fit in the history budget, oldest first. */
  private fitHistory(history: Turn[]): Turn[] {
    const limit = this.numCtx * HISTORY_SHARE * CHARS_PER_TOKEN;
    const kept: Turn[] = [];
    let used = 0;
    for (const turn of [...history].reverse()) {
      const size = turn.question.length + turn.answer.length;
      if (used + size > limit) break;
      kept.unshift(turn);
      used += size;
    }
    return kept;
  }

  /** Characters of document text that fit next to the instructions and answer. */
  private budget(reservedTokens: number): number {
    return Math.max(2000, (this.numCtx - reservedTokens) * CHARS_PER_TOKEN);
  }
}

function toSources(passages: Passage[]): Source[] {
  return passages.map((p) => ({ page: p.page, text: p.text }));
}

/** Citations and multi-digit numbers of the original, all present in the translation. */
export function sameCitationsAndNumbers(original: string, translated: string): boolean {
  const cites = (t: string) => [...t.matchAll(/\[\s*p\.?\s*(\d+)\s*\]/gi)].map((m) => m[1]).sort().join(',');
  const numbers = (t: string) =>
    (t.replace(/\[\s*p\.?\s*\d+\s*\]/gi, '').match(/\d[\d.,]*\d|\d{2,}/g) ?? []).map((n) => n.replace(/\D/g, ''));
  if (cites(original) !== cites(translated)) return false;
  const translatedNumbers = new Set(numbers(translated));
  return numbers(original).every((n) => translatedNumbers.has(n));
}
