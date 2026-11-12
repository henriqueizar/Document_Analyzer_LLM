import type { Language } from './language';
import { NOT_FOUND } from './prompts';
import { normalize } from './passages';

export interface GroundingResult {
  ok: boolean;
  problems: string[];
}

const CITATION = /\[\s*p(?:ag|ágina|age)?\.?\s*(\d+)\s*\]/gi;
// Numbers worth checking: 2+ digits, or with separators (12.500,00 / 1,5 / 10%).
const NUMBER = /\d[\d.,]*\d|\d{2,}/g;

const digitsOf = (s: string) => s.replace(/\D/g, '');

export function hasCitation(text: string): boolean {
  return new RegExp(CITATION.source, 'i').test(text);
}

/**
 * Refusals the model words its own way ("A multa ... não está explicitamente
 * mencionada no documento. [p. 4]"). Such an answer states only an absence,
 * so a page citation there is misleading.
 */
const NEGATIVE = [
  // (\b does not see accented letters such as the "á" of "está", hence the explicit spaces)
  /\bn[ãa]o\s(?:[^.]{0,60}\s)?(?:est[áa]|é|s[ãa]o|foi|foram|h[áa])\s[^.]{0,40}\b(?:mencionad|especificad|informad|previst|indicad|descrit|citad|definid|estabelecid|presente|dispon[íi]ve|claro|clara)/i,
  /\b(?:o|este|esse) documento n[ãa]o (?:menciona|informa|especifica|prev[êe]|traz|cita|define|estabelece|apresenta|cont[ée]m|diz|indica|fala)/i,
  /\bn[ãa]o (?:h[áa]|existe|consta|constam) (?:men[çc][ãa]o|informa[çc][ãa]o|refer[êe]ncia|cl[áa]usula|previs[ãa]o)/i,
  /\bnot (?:explicitly )?(?:mentioned|specified|stated|provided|included|defined|given|addressed)\b/i,
  /\bthe document does(?: not|n't) (?:mention|specify|state|provide|include|define|say|address)/i,
  /\bthere is no (?:mention|information|reference|clause|provision)\b/i,
];

/** True when every sentence of the answer only says something is absent from the document. */
export function isNegativeOnly(answer: string): boolean {
  const sentences = answer
    .replace(CITATION, '')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  // the standard sentence counts too: "X não é mencionado. Não encontrei essa informação no documento. [p. 7]"
  return sentences.length > 0 && sentences.every((x) => isNotFound(x) || NEGATIVE.some((re) => re.test(x)));
}

/**
 * Questions that ask for the answer to an exercise or test question. The model
 * may not pick it in strict mode, and it does not always say so with words the
 * answer check can see ("B) dividir as férias..."), so the question is checked.
 */
const ASKS_TO_CHOOSE: RegExp[] = [
  /\bresposta\s+(?:certa\s+|correta\s+)?(?:d[ao]|para\s+[ao]|a)\s+(?:questao|exercicio|item)\b/,
  /\b(?:alternativa|assertiva|afirmativa|opcao)s?\s+(?:esta\s+|e\s+)?(?:correta|certa|verdadeira|incorreta|errada|falsa|responde)/,
  /\bqual\s+(?:e\s+)?(?:a\s+)?(?:alternativa|assertiva)\b/,
  /\b(?:resolva|resolver|responda|responder)\s+(?:a\s+)?(?:questao|exercicio)/,
  /\bgabarito\b/,
  /\b(?:correct|right|true|wrong|false)\s+(?:answer|option|alternative|choice)/,
  /\banswer\s+(?:to|for|of)\s+(?:question|exercise)\b/,
  /\bwhich\s+(?:option|alternative|choice)\s+(?:is|answers)/,
  /\b(?:solve|answer)\s+(?:question|exercise)\s*\d/,
  /\banswer\s+key\b/,
];
const ANSWER_KEY = /\b(?:gabarito|answer\s+key|respostas?\s+corretas?|resposta\s+certa)\b/;

/**
 * True when the question asks to choose an exercise's answer and the document
 * has no answer key of its own (then repeating the key is reading, and allowed).
 */
export function asksToChooseAnswer(question: string, documentText: string): boolean {
  const q = normalize(question);
  return ASKS_TO_CHOOSE.some((re) => re.test(q)) && !ANSWER_KEY.test(normalize(documentText));
}

/**
 * Phrasings that pick an answer or judge something. In strict mode these may
 * only repeat the document: if the document itself does not say it (an answer
 * key, a recommendation), the claim is the model's own and is not shown.
 * Pattern-based: it catches the common phrasings, not every possible one.
 */
const JUDGEMENT: RegExp[] = [
  // choosing among options: "a alternativa correta", "resposta certa", "the correct answer"
  /\b(?:resposta|alternativa|opcao|assertiva|afirmativa)s?\s+(?:correta|certa|verdadeira|incorreta|errada|falsa)s?\b/,
  /\ba?\s*resposta\s+(?:da|a|para\s+a)\s+questao\s*\d+/,
  /\bgabarito\b/,
  /\b(?:correct|right|true|wrong|false)\s+(?:answer|option|alternative|choice|statement)s?\b/,
  /\bthe\s+answer\s+(?:to|for|of)\s+question\s*\d+/,
  /\banswer\s+key\b/,
  // assessments and advice
  /\b(?:e|seria|parece|sao|sera)\s+(?:mais\s+|muito\s+|bastante\s+)?(?:vantajos|desvantajos|recomendave|adequad|inadequad|razoave|justo|injusto|abusiv|arriscad|favorave|desfavorave|bom\b|boa\b|ruim\b)/,
  /\b(?:recomendo|recomenda-se|sugiro|sugere-se|o\s+ideal\s+e|a\s+melhor\s+opcao|voce\s+deveria|deveria|vale\s+a\s+pena)\b/,
  /\b(?:is|seems|would\s+be|are)\s+(?:more\s+|very\s+)?(?:advantageous|disadvantageous|reasonable|fair|unfair|abusive|risky|recommended|appropriate|favourable|favorable|good|bad)\b/,
  /\b(?:i\s+recommend|i\s+suggest|you\s+should|the\s+best\s+option|it\s+is\s+worth)\b/,
];

/**
 * Returns the judgement phrase an answer contains that the document itself
 * does not contain, or null. Accents and case are ignored.
 */
export function unsupportedJudgement(answer: string, sourceText: string): string | null {
  const a = normalize(answer.replace(CITATION, ''));
  const source = normalize(sourceText);
  for (const re of JUDGEMENT) {
    const m = a.match(re);
    if (m && !source.includes(m[0].trim())) return m[0].trim();
  }
  return null;
}

export function isNotFound(answer: string): boolean {
  const a = normalize(answer);
  return Object.values(NOT_FOUND).some((phrase) =>
    a.includes(normalize(phrase).replace(/\.$/, '')),
  );
}

/**
 * Checks an LLM answer against the exact text it was given. It cannot prove an
 * answer is correct, but it catches the most harmful kinds of hallucination:
 * numbers (amounts, dates, deadlines) that are not in the document, citations
 * of pages that were not provided, and answers with no source at all.
 */
export function checkGrounding(
  answer: string,
  source: { text: string; pages: number[] },
  lang: Language,
  options: { requireCitation: boolean; ignore?: string } = { requireCitation: true },
): GroundingResult {
  if (isNotFound(answer)) return { ok: true, problems: [] };

  const problems: string[] = [];
  const cited = [...answer.matchAll(CITATION)].map((m) => Number(m[1]));

  const unknownPages = [...new Set(cited.filter((p) => !source.pages.includes(p)))];
  if (unknownPages.length) {
    problems.push(
      lang === 'pt'
        ? `cita a página ${unknownPages.join(', ')}, que não estava entre os trechos consultados`
        : `cites page ${unknownPages.join(', ')}, which was not among the excerpts consulted`,
    );
  }

  if (options.requireCitation && cited.length === 0) {
    problems.push(lang === 'pt' ? 'não cita nenhuma página do documento' : 'does not cite any page of the document');
  }

  const sourceNumbers = new Set((source.text.match(NUMBER) ?? []).map(digitsOf));
  const ignored = new Set((options.ignore?.match(NUMBER) ?? []).map(digitsOf));
  const withoutCitations = answer.replace(CITATION, '');
  const missing = [
    ...new Set(
      (withoutCitations.match(NUMBER) ?? []).filter((n) => {
        const d = digitsOf(n);
        return !sourceNumbers.has(d) && !ignored.has(d);
      }),
    ),
  ];
  if (missing.length) {
    problems.push(
      lang === 'pt'
        ? `contém ${missing.join(', ')}, que não aparece${missing.length > 1 ? 'm' : ''} no documento`
        : `contains ${missing.join(', ')}, which do${missing.length > 1 ? '' : 'es'} not appear in the document`,
    );
  }

  return { ok: problems.length === 0, problems };
}

export function groundingWarning(lang: Language, result: GroundingResult): string {
  return lang === 'pt'
    ? `⚠ Verificação automática: a resposta ${result.problems.join('; ')}. Confira no documento antes de usar esta informação.`
    : `⚠ Automatic check: the answer ${result.problems.join('; ')}. Check the document before relying on this information.`;
}
