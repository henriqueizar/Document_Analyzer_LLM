import { normalize } from './passages';

export type Language = 'pt' | 'en';

const PT_WORDS =
  'o os as um uma de da dos das no na nos nas em por para com que qual quais quando onde como quem quanto ' +
  'e é nao não sao são esta está estão isso este essa esse ao aos pelo pela pelos pelas seu sua seus suas ' +
  'mais foi ser tem têm também já ou mas prazo valor contrato documento clausula cláusula'.normalize();
const EN_WORDS =
  'the an of to in on at by for with what which when where who how is are was were does did this that ' +
  'these those it its not and or be been has have will would from their there also but contract document clause';

/** Words of one language only: shared spellings such as "a" or "do" carry no signal. */
function markers(own: string, other: string): Set<string> {
  const otherSet = new Set(other.split(/\s+/).map(normalize));
  return new Set(own.split(/\s+/).map(normalize).filter((w) => w && !otherSet.has(w)));
}

const MARKERS: Record<Language, Set<string>> = {
  pt: markers(PT_WORDS, EN_WORDS),
  en: markers(EN_WORDS, PT_WORDS),
};

/**
 * Tiny stopword-based detector for the languages the prompts support.
 * Returns `fallback` when the text gives no clear signal.
 */
export function detectLanguage(text: string, fallback: Language = 'pt'): Language {
  const words = normalize(text).split(/[^a-z]+/).filter(Boolean);
  const pt = words.filter((w) => MARKERS.pt.has(w)).length;
  const en = words.filter((w) => MARKERS.en.has(w)).length;
  if (pt === en) return fallback;
  return pt > en ? 'pt' : 'en';
}
