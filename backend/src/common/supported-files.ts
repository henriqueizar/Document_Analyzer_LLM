import { extname } from 'path';

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'];
export const PDF_EXTENSIONS = ['.pdf'];

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/tiff',
];
export const PDF_MIME_TYPES = ['application/pdf'];

const ext = (filename: string) => extname(filename).toLowerCase();

export function isPdf(filename: string): boolean {
  return PDF_EXTENSIONS.includes(ext(filename));
}

export function isImage(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(ext(filename));
}

/**
 * A file is accepted only when both its extension and its declared MIME type
 * belong to the same supported family. Comparison is case-insensitive, so
 * "SCAN.PDF" is treated as a PDF.
 */
export function isSupportedUpload(filename: string, mimetype: string): boolean {
  const mime = (mimetype || '').toLowerCase();
  return (
    (isPdf(filename) && PDF_MIME_TYPES.includes(mime)) ||
    (isImage(filename) && IMAGE_MIME_TYPES.includes(mime))
  );
}
