'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

/** A document passage sent to the model with an answer (stored by the backend). */
export interface Source {
  page: number;
  text: string;
}

const CITATION = /\[\s*p\.?\s*(\d+)\s*\]/gi;
const STOPWORDS = new Set(
  'a o as os um uma de do da dos das no na nos nas em ao aos por pelo pela para com sem que se e ou the of to in on and or is are was for with by'.split(
    ' ',
  ),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w) && (w.length > 2 || /\d/.test(w)))
    .map((w) => (/\d/.test(w) || w.length <= 5 ? w : w.slice(0, 5)));
}

/** The part of the answer a citation belongs to: from the previous sentence end or citation up to it. */
function claimBefore(text: string, citationStart: number): string {
  const before = text.slice(0, citationStart);
  const cut = Math.max(
    before.search(/[^\]]*$/) - 1,
    ...['. ', '! ', '? ', '; ', '\n'].map((sep) => before.lastIndexOf(sep)),
  );
  return before.slice(cut + 1).trim();
}

/** Index range of the sentence in `text` that shares most words with `claim`. */
function bestSentence(text: string, claim: string): [number, number] | null {
  return bestSentenceScored(text, claim)?.range ?? null;
}

function bestSentenceScored(text: string, claim: string): { range: [number, number]; score: number } | null {
  const target = new Set(words(claim));
  if (!target.size) return null;
  let best: [number, number] | null = null;
  let bestScore = 0;
  // Sentences end at . ! ? ; or a blank line. A '.' before a digit is part of a
  // number (12.500,00) and a single line break is just where the PDF line wrapped.
  const re = /(?:[^.!?;\n]|\.(?=\d)|\n(?!\n))+[.!?;]?/g;
  for (const m of text.matchAll(re)) {
    const score = words(m[0]).filter((w) => target.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = [m.index ?? 0, (m.index ?? 0) + m[0].length];
    }
  }
  return bestScore >= 2 && best ? { range: best, score: bestScore } : null;
}

interface Active {
  page: number;
  claim: string;
}

/**
 * LLM text where each [p. N] is a button. Clicking it opens, right below, the
 * passage of page N that the model was given, with the sentence that best
 * matches the cited claim highlighted.
 */
export function CitedText({
  label,
  text,
  sources,
  onShowPage,
}: {
  label: string;
  text: string;
  sources: Source[] | null;
  /** Shows page N in the document preview (PDFs only). */
  onShowPage?: (page: number) => void;
}) {
  const [active, setActive] = useState<Active | null>(null);

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const start = m.index ?? 0;
    const page = Number(m[1]);
    const claim = claimBefore(text, start);
    parts.push(<Fragment key={`t${start}`}>{text.slice(last, start)}</Fragment>);
    const isActive = active?.page === page && active.claim === claim;
    parts.push(
      <button
        key={`c${start}`}
        type="button"
        className="cite"
        aria-pressed={isActive}
        aria-label={`Show the source on page ${page}`}
        onClick={() => setActive(isActive ? null : { page, claim })}
      >
        {m[0]}
      </button>,
    );
    last = start + m[0].length;
  }
  parts.push(<Fragment key="end">{text.slice(last)}</Fragment>);

  return (
    <>
      <p className="llm-text">
        <strong>{label}</strong> {parts}
      </p>
      {active && (
        <SourcePanel
          page={active.page}
          claim={active.claim}
          sources={sources}
          onShowPage={onShowPage}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}

function SourcePanel({
  page,
  claim,
  sources,
  onShowPage,
  onClose,
}: {
  page: number;
  claim: string;
  sources: Source[] | null;
  onShowPage?: (page: number) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  // Bring the source into view: otherwise it may open below the screen and
  // look like the click did nothing.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [page, claim]);
  const passages = (sources ?? []).filter((s) => s.page === page).map((s) => ({ ...s, text: unwrap(s.text) }));
  // The excerpt that backs the claim; the rest of the page is one click away.
  const scores = passages.map((p) => bestSentenceScored(p.text, claim)?.score ?? 0);
  const primary = scores.length ? scores.indexOf(Math.max(...scores)) : -1;
  const shown = all ? passages : passages.filter((_, i) => i === primary);

  return (
    <div className="source" role="region" aria-label={`Source, page ${page}`} ref={panelRef}>
      <div className="source-head">
        <span>Source: page {page}</span>
        <span className="button-row">
          {onShowPage && (
            <button type="button" onClick={() => onShowPage(page)}>
              Show page {page} in the PDF
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close source">
            Close
          </button>
        </span>
      </div>
      {passages.length === 0 ? (
        <p>
          <small>
            {sources
              ? `The model was not given any text from page ${page}: this citation could not be checked.`
              : 'The source text was not stored for this answer (it was created before sources were saved).'}
          </small>
        </p>
      ) : (
        shown.map((p) => <Highlighted key={`${all}-${p.text.slice(0, 20)}`} text={p.text} claim={claim} whole={all} />)
      )}
      {passages.length > 0 && (
        <button type="button" className="link-button" onClick={() => setAll(!all)}>
          {all ? 'Show only the matching sentence' : `Show all the text the model received from page ${page}`}
        </button>
      )}
      <small>This is the exact text the model received from the document.</small>
    </div>
  );
}

/** Joins lines broken where the PDF line wrapped; keeps blank-line paragraph breaks. */
function unwrap(text: string): string {
  return text.replace(/([^\n])\n(?!\n)/g, '$1 ').replace(/ {2,}/g, ' ');
}

/** End of the sentence before `index` (start of the one before the highlight). */
function previousSentenceStart(text: string, index: number): number {
  const before = text.slice(0, index).trimEnd();
  const ends = [...before.matchAll(/[.!?;](?!\d)\s/g)].map((m) => (m.index ?? 0) + m[0].length);
  return ends.length >= 2 ? ends[ends.length - 2] : 0;
}

function nextSentenceEnd(text: string, index: number): number {
  const m = /[.!?;](?!\d)(\s|$)/.exec(text.slice(index));
  return m ? index + m.index + 1 : text.length;
}

/** The passage with the matching sentence highlighted (and only its neighbours unless `whole`). */
function Highlighted({ text, claim, whole }: { text: string; claim: string; whole: boolean }) {
  const range = bestSentence(text, claim);
  if (!range) {
    const short = !whole && text.length > 300;
    return <p className="source-text">{short ? `${text.slice(0, 300)} …` : text}</p>;
  }
  const [start, end] = range;
  const from = whole ? 0 : previousSentenceStart(text, start);
  const to = whole ? text.length : nextSentenceEnd(text, end);
  return (
    <p className="source-text">
      {from > 0 && '… '}
      {text.slice(from, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end, to)}
      {to < text.length && ' …'}
    </p>
  );
}
