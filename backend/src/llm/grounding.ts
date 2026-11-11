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
