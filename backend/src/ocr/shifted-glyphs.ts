/* eslint-disable no-control-regex -- this module exists to find control characters */
/**
 * Repairs PDF text whose characters come out shifted by a constant offset.
 *
 * Some PDFs (common in papers made with older Word/LaTeX toolchains) embed
 * subset fonts without a ToUnicode map, so the extracted characters are the
 * glyph indices, which for these fonts sit exactly 29 below the real
 * characters: "0XOWLDJHQW $SSURDFK" is "Multiagent Approach", "8)5*6" is
 * "UFRGS" and even spaces and dots come out as control characters (0x03, 0x11).
 *
 * Only lines that decode into plausible words are changed; ordinary text never
 * decodes (any lowercase letter is outside the shifted range), and all-caps or
 * numeric lines are left alone unless they carry clear evidence of the shift.
 */
const SHIFT = 29;
const CONTROL = /[\x01-\x08\x0b\x0c\x0e-\x1f]/;
const NUMERIC = /^[\d.,:;/%()[\]+-]+$/;
const WORD_LIKE = /^[A-Za-z]+[.,;:!?]?$/;

const PLAUSIBLE = [
  /^[A-Z]?[a-z]+(?:[A-Z][a-z]+)*$/, // word, Word, joined names (RosaMariaVicari)
  /^[A-Z]{2,6}$/, // acronym
  /^[A-Za-z0-9._-]+@[a-z0-9.-]+$/, // e-mail
  /^[AaIi]$/,
];

function plausible(token: string): boolean {
  const core = token.replace(/^[.,;:()]+|[.,;:()]+$/g, '');
  if (!core) return false;
  if (!PLAUSIBLE.some((re) => re.test(core))) return false;
  // real words of three or more letters have a vowel
  return (
    core.length < 3 ||
    /[A-Z]{2,6}/.test(core) ||
    /[aeiouy]/i.test(core.split('@')[0])
  );
}

/** The line with every character moved up by SHIFT, or null if it cannot be shifted text. */
function decodeLine(line: string): string | null {
  let out = '';
  for (const char of line) {
    const code = char.charCodeAt(0);
    if (char === ' ' || char === '\t') out += ' ';
    else if (code >= 0x01 && code <= 0x1f) {
      // control codes are separators in these fonts, except the ones that decode to e-mail punctuation
      const decoded = String.fromCharCode(code + SHIFT);
      out += /[A-Za-z0-9.@_-]/.test(decoded) ? decoded : ' ';
    } else if (code >= 0x21 && code + SHIFT <= 0x7a)
      out += String.fromCharCode(code + SHIFT);
    else return null;
  }
  return out;
}

function repairLine(line: string): string {
  if (!line.trim()) return line;
  const decoded = decodeLine(line);
  if (decoded === null) return line;

  const originals = line.split(/[\s\x01-\x1f]+/).filter(Boolean);
  const tokens = decoded.split(/\s+/).filter(Boolean);
  if (!tokens.length) return line;
  const good = tokens.filter(plausible);
  if (good.length / tokens.length < 0.6 || !good.some((t) => t.length >= 3))
    return line;

  // Control characters are a strong sign; without them, ask for a token that is
  // neither a word nor a number but decodes into one (e.g. "0XVLFDO" -> "Musical").
  const evidence =
    CONTROL.test(line) ||
    originals.some((o) => {
      if (NUMERIC.test(o) || WORD_LIKE.test(o)) return false;
      const d = decodeLine(o);
      // a decoded acronym alone is weak ("***" -> "GGG"); ask for a word or an e-mail
      return d !== null && d.length >= 3 && plausible(d) && !/^[A-Z]+$/.test(d);
    });
  if (!evidence) return line;

  // Joined names get their spaces back: "RosaMariaVicari" -> "Rosa Maria Vicari".
  return tokens
    .map((t) => (/@/.test(t) ? t : t.replace(/([a-z])([A-Z])/g, '$1 $2')))
    .join(' ');
}

export function repairShiftedGlyphs(text: string): string {
  return text.split('\n').map(repairLine).join('\n');
}
