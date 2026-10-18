export const MAX_IMAGE_COUNT = 8;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_BYTES = 16 * 1024 * 1024;
export const IMAGE_FORMAT_ERROR = '支持 PNG、JPEG、WebP、GIF，单张不超过 8 MiB';

export function detectImageMimeType(bytes: Uint8Array): string | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
}

/** Hints route unsupported or damaged images to an image error, never to text references. */
export function hasImageHint(file: { name: string; type: string }): boolean {
  return (
    file.type.toLowerCase().startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif|svg|ico|jxl)$/i.test(file.name)
  );
}

export const imageDataBytes = (data: string) =>
  Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
