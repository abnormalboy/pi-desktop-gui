import type { ImageAttachment } from '../../shared/types';
import { detectImageMimeType, hasImageHint, IMAGE_FORMAT_ERROR, MAX_IMAGE_BYTES } from '../../shared/images';

export async function isImageFile(file: File): Promise<boolean> {
  return (
    hasImageHint(file) || Boolean(detectImageMimeType(new Uint8Array(await file.slice(0, 12).arrayBuffer())))
  );
}

export async function readImageFile(file: File): Promise<ImageAttachment> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error(IMAGE_FORMAT_ERROR);
  const mimeType = detectImageMimeType(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mimeType) throw new Error(IMAGE_FORMAT_ERROR);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(`无法读取图片 ${file.name}`));
    reader.readAsDataURL(file);
  });
  return { id: crypto.randomUUID(), name: file.name || '粘贴的图片', mimeType, data };
}
