import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

/** Validate the artifacts that the native updater will trust before publishing a release. */
export async function verifyUpdateMetadata(directory, version, required = []) {
  const entries = await fs.readdir(directory);
  for (const name of required)
    if (!entries.includes(name)) throw new Error(`Missing update metadata: ${name}`);
  const manifests = entries.filter((name) => /^latest(?:-linux|-mac)?\.yml$/.test(name));
  if (!manifests.length) throw new Error('No update metadata found');
  for (const name of manifests) {
    const manifest = yaml.load(await fs.readFile(path.join(directory, name), 'utf8'));
    if (manifest.version !== version)
      throw new Error(`${name}: expected version ${version}, got ${manifest.version}`);
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error(`${name}: missing files`);
    for (const file of manifest.files) {
      if (typeof file.url !== 'string' || file.url !== path.basename(file.url) || file.url.includes('\\'))
        throw new Error(`${name}: update file must be a release asset name`);
      const bytes = await fs.readFile(path.join(directory, file.url));
      if (file.size !== bytes.length || file.sha512 !== createHash('sha512').update(bytes).digest('base64'))
        throw new Error(`${name}: size or SHA-512 mismatch for ${file.url}`);
      if (name === 'latest.yml') {
        if (!file.url.endsWith('-setup.exe'))
          throw new Error('Windows update must point to the NSIS installer');
        await fs.access(path.join(directory, file.url + '.blockmap'));
      }
    }
    if (name === 'latest-linux.yml' && !manifest.files.some((file) => file.url.endsWith('.AppImage')))
      throw new Error('Linux update metadata must include the AppImage');
  }
  return manifests;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2] ?? 'release-assets');
  const version = (process.env.RELEASE_TAG ?? process.argv[3] ?? '').replace(/^v/, '');
  await verifyUpdateMetadata(directory, version, ['latest.yml', 'latest-linux.yml']);
  console.log(`PASS update metadata, version and hashes for ${version}`);
}
