/**
 * Upload file names.
 *
 * Browsers send them as UTF-8, and macOS writes accents decomposed ("Ç" as
 * "C" + combining cedilla). Names are therefore read as UTF-8 (multer's
 * defParamCharset) and normalised to the composed form (NFC), so
 * "3ª EDIÇÃO.pdf" is stored as typed instead of "3Âª EDICÌ§AÌO.pdf".
 */
export function normalizeFileName(name: string): string {
  return name.normalize('NFC');
}

/**
 * Repairs a name that was decoded as Latin-1 although it was UTF-8 (how
 * names were stored before the fix). Returns null when the name does not
 * look like that: re-encoding a correct name such as "SÃO PAULO.pdf" gives
 * invalid UTF-8, so it is left alone.
 */
export function repairMisdecodedName(name: string): string | null {
  if (!/[À-ÿ]/.test(name)) return null;
  const bytes = Buffer.from(name, 'latin1');
  if ([...name].some((c) => c.charCodeAt(0) > 0xff)) return null;
  const decoded = bytes.toString('utf8');
  if (decoded.includes('�') || decoded === name) return null;
  return normalizeFileName(decoded);
}
