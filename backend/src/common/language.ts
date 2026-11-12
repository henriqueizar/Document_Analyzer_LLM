export type AppLanguage = 'pt' | 'en';
export const LANGUAGES: AppLanguage[] = ['pt', 'en'];

/** Language of new accounts and of the screens shown before signing in. */
export function defaultLanguage(env: NodeJS.ProcessEnv = process.env): AppLanguage {
  return env.DEFAULT_LANGUAGE === 'en' ? 'en' : 'pt';
}

export function isLanguage(value: unknown): value is AppLanguage {
  return value === 'pt' || value === 'en';
}
