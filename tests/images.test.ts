import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectImageMimeType, hasImageHint, imageDataBytes, MAX_IMAGE_BYTES } from '../shared/images';
import { isImageFile } from '../src/lib/image-files';
import { readImageAttachment } from '../electron/images';

test('image signatures identify supported bytes independently of file metadata', () => {
  for (const [header, mime] of [
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
    [Buffer.from([255, 216, 255]), 'image/jpeg'],
    [Buffer.from('RIFF1234WEBP'), 'image/webp'],
    [Buffer.from('GIF89a'), 'image/gif'],
  ] as const)
    assert.equal(detectImageMimeType(header), mime);
  assert.equal(detectImageMimeType(Buffer.from('plain text')), undefined);
  assert.equal(detectImageMimeType(new Uint8Array()), undefined);
  assert.equal(hasImageHint({ name: 'photo.PNG', type: '' }), true);
  assert.equal(hasImageHint({ name: 'photo', type: 'image/tiff' }), true);
  assert.equal(hasImageHint({ name: 'photo.bmp', type: '' }), true);
  assert.equal(hasImageHint({ name: 'notes.txt', type: 'text/plain' }), false);
});

test('empty and generic MIME files use image content and plain text stays a text reference', async () => {
  const png = await fs.readFile('build/icon.png');
  for (const type of ['', 'application/octet-stream', 'text/plain']) {
    assert.equal(await isImageFile(new File([png], 'without-extension', { type })), true);
  }
  assert.equal(await isImageFile(new File(['notes'], 'notes.txt')), false);
  // Damaged/unsupported image hints must still take the image error path.
  assert.equal(await isImageFile(new File(['broken'], 'broken.png')), true);
});

test('file image reads preserve bytes, normalize MIME, reject unsupported images and enforce the byte cap', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-images-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bytes = await fs.readFile('build/icon-source-v2.png');
  assert.ok(bytes.length > 256 * 1024);
  const file = path.join(dir, 'image-without-extension');
  await fs.writeFile(file, bytes);
  const image = await readImageAttachment(file);
  assert.equal(image?.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(image!.data, 'base64'), bytes);
  assert.equal(imageDataBytes(image!.data), bytes.length);
  const text = path.join(dir, 'notes.txt');
  await fs.writeFile(text, 'plain text');
  assert.equal(await readImageAttachment(text), null);
  const broken = path.join(dir, 'broken.png');
  await fs.writeFile(broken, 'not an image');
  await assert.rejects(readImageAttachment(broken), /支持 PNG/);
  const large = path.join(dir, 'large.png');
  await fs.writeFile(large, bytes);
  await fs.truncate(large, MAX_IMAGE_BYTES + 1);
  await assert.rejects(readImageAttachment(large), /8 MiB/);
  for (const value of ['a', 'ab', 'abc', 'abcd'])
    assert.equal(imageDataBytes(Buffer.from(value).toString('base64')), Buffer.byteLength(value));
});
