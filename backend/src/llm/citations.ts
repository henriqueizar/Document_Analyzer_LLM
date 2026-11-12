import { tokenize } from './passages';

/** A document passage that was sent to the model, as stored with each answer. */
export interface Source {
  page: number;
  text: string;
}

const CITATION = /\[\s*p\.?\s*\d+\s*\]/i;
/** Two or more citations piled up at the end of a paragraph: "... [p. 1] [p. 2] [p. 4]". */
const TRAILING_CLUSTER = /(?:\s*\[\s*p\.?\s*\d+\s*\]){2,}\s*$/i;
/**
 * Sentence boundary: end punctuation followed by a capital, digit or quote
 * (so not "Ltda. e"), never the "p." inside a "[p. 2]" citation.
 */
const SENTENCE_END = /(?<=[.!?])(?<!\bp\.)\s+(?=["“(\p{Lu}\d])/u;

const MIN_SHARE = 0.5;
/**
 * Words are compared by their first letters, a light stemming that matches
 * inflections ("reajuste" / "reajustado", "anual" / "anualmente"). Numbers
 * are compared whole.
 */
const STEM = 5;
const stems = (text: string) =>
  tokenize(text).map((t) => (/\d/.test(t) || t.length <= STEM ? t : t.slice(0, STEM)));
const MIN_SHARED_WORDS = 3;

/**
 * Small models often pile every page reference at the end of the explanation
 * ("... [p. 1] [p. 2] [p. 3]") instead of after each sentence, so readers
 * cannot tell where each fact comes from. This removes such a pile and, for
 * every sentence without a citation, adds the page of the passage it matches
 * best, but only when the match is strong (at least half of the sentence's
 * meaningful words, and at least 3 of them, or 2 when a number is shared).
 * Sentences without a strong match get no citation rather than a wrong one.
 * Deterministic: no model involved.
 */
export function attributeCitations(text: string, sources: Source[]): string {
  // "[p. 6].Em caso" -> "[p. 6]. Em caso" (models sometimes drop the space)
  text = text.replace(/(\[\s*p\.?\s*\d+\s*\])([.;,:])(?=\p{L})/gu, '$1$2 ');
  if (!sources.length) return text;
  const sourceTokens = sources.map((s) => new Set(stems(s.text)));
  const pageTokens = tokensByPage(sources);

  return text
    .split(/(\n\s*\n)/)
    .map((block) => {
      if (/^\n\s*\n$/.test(block)) return block;
      const paragraph = block.replace(TRAILING_CLUSTER, '');
      return paragraph
        .split(SENTENCE_END)
        .map((sentence) =>
          // items of a list joined by ";" often come from different pages
          sentence
            .split(/;\s+/)
            .map((item) =>
              CITATION.test(item) ? verify(item, pageTokens) : cite(item, sources, sourceTokens),
            )
            .join('; '),
        )
        .join(' ');
    })
    .join('');
}

/** Words of every page, so a citation can be checked against the whole page it names. */
function tokensByPage(sources: Source[]): Map<number, Set<string>> {
  const pages = new Map<number, Set<string>>();
  for (const s of sources) {
    const set = pages.get(s.page) ?? new Set<string>();
    for (const t of stems(s.text)) set.add(t);
    pages.set(s.page, set);
  }
  return pages;
}

const WEAK_SUPPORT = 0.35;
const CLEAR_MARGIN = 0.25;

/**
 * Checks a sentence that carries one citation. Models sometimes cite a page
 * that was sent but says something else (seen: "... pelo IPCA [p. 4]" while
 * the IPCA clause is on page 3). When the cited page shares few of the
 * sentence's words and another page clearly backs it, the page number is
 * corrected. Anything less clear is left as the model wrote it.
 */
function verify(sentence: string, pageTokens: Map<number, Set<string>>): string {
  const cites = [...sentence.matchAll(/\[\s*p\.?\s*(\d+)\s*\]/gi)];
  if (cites.length !== 1) return sentence;
  const cited = Number(cites[0][1]);
  const words = [...new Set(stems(sentence.replace(cites[0][0], '')))];
  if (words.length < MIN_SHARED_WORDS) return sentence;

  const support = (page: number) => {
    const tokens = pageTokens.get(page);
    return tokens ? words.filter((w) => tokens.has(w)).length / words.length : 0;
  };
  let bestPage = cited;
  let best = support(cited);
  for (const page of pageTokens.keys()) {
    const score = support(page);
    if (score > best) {
      best = score;
      bestPage = page;
    }
  }
  const citedSupport = support(cited);
  if (bestPage !== cited && citedSupport < WEAK_SUPPORT && best >= MIN_SHARE && best - citedSupport >= CLEAR_MARGIN) {
    return sentence.replace(cites[0][0], `[p. ${bestPage}]`);
  }
  return sentence;
}

function cite(sentence: string, sources: Source[], sourceTokens: Set<string>[]): string {
  const words = [...new Set(stems(sentence))];
  if (!words.length) return sentence;

  let best = -1;
  let bestShared = 0;
  sourceTokens.forEach((tokens, i) => {
    const shared = words.filter((w) => tokens.has(w)).length;
    if (shared > bestShared) {
      best = i;
      bestShared = shared;
    }
  });
  if (best < 0) return sentence;

  const sharedNumber = words.some((w) => /\d/.test(w) && sourceTokens[best].has(w));
  const strong =
    bestShared / words.length >= MIN_SHARE &&
    (bestShared >= MIN_SHARED_WORDS || (sharedNumber && bestShared >= 2));
  if (!strong) return sentence;

  const tag = `[p. ${sources[best].page}]`;
  const end = sentence.match(/[.!?]+$/);
  return end
    ? `${sentence.slice(0, -end[0].length).trimEnd()} ${tag}${end[0]}`
    : `${sentence.trimEnd()} ${tag}`;
}
