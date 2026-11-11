/**
 * Splits a document's extracted text into page-labelled passages and selects
 * the ones relevant to a question, so that only real document text (with page
 * numbers the model can cite) is sent to the LLM.
 *
 * This is lexical retrieval inside ONE document (BM25 + explicit references
 * such as "cláusula 8"). It is not RAG: no embeddings, no cross-document
 * search. The passage structure is what a future RAG index can reuse.
 */

export interface Passage {
  /** Position in the document (0-based). */
  index: number;
  /** 1-based page number ("--- Page N ---" markers from OCR; 1 for images). */
  page: number;
  text: string;
}

export interface Selection {
  passages: Passage[];
  /** True when the whole document fit and nothing was left out. */
  complete: boolean;
  totalPages: number;
}

const PAGE_MARKER = /^--- Page (\d+) ---$/m;
const DEFAULT_PASSAGE_CHARS = 1200;

export function splitIntoPassages(text: string, maxChars = DEFAULT_PASSAGE_CHARS): Passage[] {
  const pages: { page: number; text: string }[] = [];
  if (PAGE_MARKER.test(text)) {
    const parts = text.split(/^--- Page (\d+) ---$/m);
    // parts = [before, n1, text1, n2, text2, ...]
    for (let i = 1; i < parts.length; i += 2) {
      pages.push({ page: Number(parts[i]), text: parts[i + 1] ?? '' });
    }
  } else {
    pages.push({ page: 1, text });
  }

  const passages: Passage[] = [];
  for (const { page, text: pageText } of pages) {
    let current = '';
    const flush = () => {
      if (current.trim()) passages.push({ index: passages.length, page, text: current.trim() });
      current = '';
    };
    for (const block of pageText.split(/\n\s*\n/)) {
      const pieces = block.length > maxChars ? splitLong(block, maxChars) : [block];
      for (const piece of pieces) {
        if (current && current.length + piece.length + 2 > maxChars) flush();
        current += (current ? '\n\n' : '') + piece.trim();
      }
    }
    flush();
  }
  return passages;
}

function splitLong(block: string, maxChars: number): string[] {
  // Prefer line breaks, then sentence ends, then hard cuts.
  const out: string[] = [];
  let current = '';
  for (const unit of block.split(/(?<=\n)|(?<=[.!?;])\s+/)) {
    if (current && current.length + unit.length > maxChars) {
      out.push(current);
      current = '';
    }
    if (unit.length > maxChars) {
      for (let i = 0; i < unit.length; i += maxChars) out.push(unit.slice(i, i + maxChars));
    } else {
      current += (current && !current.endsWith('\n') ? ' ' : '') + unit;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

// --- tokenization ----------------------------------------------------------

const STOPWORDS = new Set(
  (
    // Portuguese
    'a o as os um uma uns umas de do da dos das no na nos nas em ao aos à às por pelo pela pelos pelas ' +
    'para pra com sem sob sobre entre e ou que se é são foi ser ter tem há qual quais quando onde como ' +
    'quem quanto quanta quantos quantas isso isto esse essa este esta aquele aquela seu sua seus suas ' +
    'meu minha nosso nossa ele ela eles elas eu você vocês nós me te lhe não sim mais menos muito ' +
    'documento documentos texto diz fala sobre trata explique explica qual quais ' +
    // English
    'the a an of to in on at by for with without from and or is are was were be been being what which ' +
    'who whom when where why how does do did this that these those it its about document text says'
  ).split(/\s+/),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)));
}

// --- explicit references ("cláusula 8", "art. 5º", "page 3") --------------

const LABELS: Record<string, string[]> = {
  clause: ['clausula', 'clause'],
  article: ['artigo', 'art', 'article'],
  item: ['item', 'inciso'],
  section: ['secao', 'section', 'capitulo', 'chapter'],
  paragraph: ['paragrafo', 'paragraph'],
  annex: ['anexo', 'annex', 'appendix'],
  question: ['questao', 'question', 'pergunta'],
};
const PAGE_WORDS = ['pagina', 'pag', 'page', 'p'];

const ORDINALS = [
  '', 'primeir', 'segund', 'terceir', 'quart', 'quint', 'sext', 'setim', 'oitav', 'non', 'decim',
  'decima primeir', 'decima segund', 'decima terceir', 'decima quart', 'decima quint',
  'decima sext', 'decima setim', 'decima oitav', 'decima non', 'vigesim',
];

interface Reference {
  kind: 'page' | keyof typeof LABELS;
  number: number;
}

export function findReferences(question: string): Reference[] {
  const q = normalize(question);
  const refs: Reference[] = [];
  const re = /\b([a-z]+)\.?\s*(?:n[o.]?\s*)?(\d{1,3})\b/g;
  for (const match of q.matchAll(re)) {
    const [, word, num] = match;
    const n = Number(num);
    if (PAGE_WORDS.includes(word)) refs.push({ kind: 'page', number: n });
    for (const [kind, words] of Object.entries(LABELS)) {
      if (words.includes(word)) refs.push({ kind: kind as Reference['kind'], number: n });
    }
  }
  return refs;
}

function mentions(passage: Passage, ref: Reference): boolean {
  if (ref.kind === 'page') return passage.page === ref.number;
  const text = normalize(passage.text);
  const words = LABELS[ref.kind].join('|');
  const numeric = new RegExp(`\\b(?:${words})\\.?\\s*(?:n[o.]?\\s*)?0*${ref.number}(?:\\s*[oa.])?\\b`);
  if (numeric.test(text)) return true;
  const ordinal = ORDINALS[ref.number];
  return Boolean(ordinal) && new RegExp(`\\b(?:${words})\\s+${ordinal}[oa]\\b`).test(text);
}

// --- selection ---------------------------------------------------------------

const REFERENCE_BOOST = 1000;

export function selectPassages(
  passages: Passage[],
  question: string,
  budgetChars: number,
): Selection {
  const totalPages = passages.reduce((max, p) => Math.max(max, p.page), 0);
  const total = passages.reduce((sum, p) => sum + p.text.length, 0);
  if (total <= budgetChars) return { passages, complete: true, totalPages };

  const scores = bm25(passages, tokenize(question));
  for (const ref of findReferences(question)) {
    passages.forEach((p, i) => {
      if (mentions(p, ref)) scores[i] += REFERENCE_BOOST;
    });
  }

  const ranked = passages
    .map((p, i) => ({ p, score: scores[i] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.p.index - b.p.index);

  if (ranked.length === 0) {
    // Nothing matches (e.g. "what is this about?"): use the start of the document.
    return { passages: leading(passages, budgetChars), complete: false, totalPages };
  }

  const chosen = new Map<number, Passage>();
  let used = 0;
  const add = (p: Passage | undefined) => {
    if (!p || chosen.has(p.index) || used + p.text.length > budgetChars) return false;
    chosen.set(p.index, p);
    used += p.text.length;
    return true;
  };
  for (const [rank, { p }] of ranked.entries()) {
    add(p);
    // A clause often continues in the next passage: keep the best hits' neighbours.
    if (rank < 3) add(passages[p.index + 1]);
  }

  return {
    passages: [...chosen.values()].sort((a, b) => a.index - b.index),
    complete: false,
    totalPages,
  };
}

/** The first passages of the document, up to the budget. */
export function leading(passages: Passage[], budgetChars: number): Passage[] {
  const out: Passage[] = [];
  let used = 0;
  for (const p of passages) {
    if (used + p.text.length > budgetChars) break;
    out.push(p);
    used += p.text.length;
  }
  return out.length ? out : passages.slice(0, 1).map((p) => ({ ...p, text: p.text.slice(0, budgetChars) }));
}

function bm25(passages: Passage[], queryTerms: string[], k1 = 1.2, b = 0.75): number[] {
  const docs = passages.map((p) => tokenize(p.text));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const terms of docs) for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);

  const unique = [...new Set(queryTerms)];
  return docs.map((terms) => {
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of unique) {
      const f = tf.get(q) ?? 0;
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * terms.length) / avgLen)));
    }
    return score;
  });
}

/** Renders passages for the prompt, each labelled with its page. */
export function formatPassages(passages: Passage[]): string {
  return passages.map((p) => `[p. ${p.page}]\n${p.text}`).join('\n\n');
}
