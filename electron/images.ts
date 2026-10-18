import type { ImageAttachment } from '../shared/types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  detectImageMimeType,
  hasImageHint,
  IMAGE_FORMAT_ERROR,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_BYTES,
} from '../shared/images';

/** null means this is not an image; the caller can continue normal text-reference checks. */
export async function readImageAttachment(file: string): Promise<ImageAttachment | null> {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('只能添加普通文件');
  const handle = await fs.open(file, 'r');
  let mimeType: string | undefined;
  try {
    const prefix = Buffer.alloc(12);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    mimeType = detectImageMimeType(prefix.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
  if (!mimeType) {
    if (hasImageHint({ name: file, type: '' })) throw new Error(IMAGE_FORMAT_ERROR);
    return null;
  }
  if (stat.size > MAX_IMAGE_BYTES) throw new Error(IMAGE_FORMAT_ERROR);
  const image = {
    id: randomUUID(),
    name: path.basename(file),
    mimeType,
    data: (await fs.readFile(file)).toString('base64'),
  };
  validateImages([image]);
  return image;
}
export function validateImages(images: unknown): asserts images is ImageAttachment[] {
  if (!Array.isArray(images) || images.length > MAX_IMAGE_COUNT) throw new Error('每条消息最多添加 8 张图片');
  let total = 0;
  for (const img of images) {
    if (
      !img ||
      typeof img.id !== 'string' ||
      typeof img.name !== 'string' ||
      img.name.length > 512 ||
      typeof img.data !== 'string' ||
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(img.mimeType) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(img.data) ||
      img.data.length > 12 * 1024 * 1024
    )
      throw new Error('图片格式无效或超过 8 MiB');
    const bytes = Buffer.from(img.data, 'base64');
    total += bytes.length;
    const detected = detectImageMimeType(bytes);
    if (detected !== img.mimeType || bytes.length > MAX_IMAGE_BYTES)
      throw new Error('图片内容与格式不匹配，或超过 8 MiB');
  }
  if (total > MAX_IMAGES_BYTES) throw new Error('附件总大小不能超过 16 MiB');
}
