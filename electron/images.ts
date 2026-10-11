import type { ImageAttachment } from '../shared/types';
export function validateImages(images: unknown): asserts images is ImageAttachment[] {
  if (!Array.isArray(images) || images.length > 8) throw new Error('每条消息最多添加 8 张图片');
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
    const detected = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'image/webp'
          : /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))
            ? 'image/gif'
            : '';
    if (detected !== img.mimeType || bytes.length > 8 * 1024 * 1024)
      throw new Error('图片内容与格式不匹配，或超过 8 MiB');
  }
  if (total > 16 * 1024 * 1024) throw new Error('附件总大小不能超过 16 MiB');
}
