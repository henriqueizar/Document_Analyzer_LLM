import { normalize } from './passages';

export type Language = 'pt' | 'en';

const MARKERS: Record<Language, Set<string>> = {
  pt: new Set(
    'o a os as um uma de do da dos das no na em por para com que qual quais quando onde como quem quanto e é nao não sao são esta está isso este essa ao à pelo pela seu sua prazo valor contrato documento clausula cláusula'
      .split(' ')
      .map(normalize),
  ),
  en: new Set(
    'the a an of to in on at by for with what which when where who how is are was were does do did this that it its not and or contract document clause'
      .split(' '),
  ),
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
