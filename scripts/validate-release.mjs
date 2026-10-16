import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function validateRelease({
  version,
  lockVersion,
  lockPackageVersion,
  notesExist,
  tag,
  event,
  ref,
  sha,
  head,
}) {
  if (tag !== `v${version}`) throw new Error(`Release tag must match v${version}`);
  if (lockVersion !== version || lockPackageVersion !== version)
    throw new Error('Release package and lock versions must match');
  if (!notesExist) throw new Error('Release notes must exist before publishing');
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || head !== sha)
    throw new Error('Release checkout must match the exact workflow commit');
  if (event === 'workflow_dispatch') {
    if (ref !== 'refs/heads/main') throw new Error('Manual releases must run from main');
  } else if (event !== 'push' || ref !== `refs/tags/${tag}`) {
    throw new Error('Release must be a tag push or an explicit main workflow dispatch');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  validateRelease({
    version,
    lockVersion: lock.version,
    lockPackageVersion: lock.packages?.['']?.version,
    notesExist: fs.existsSync(`docs/releases/v${version}.md`),
    tag: process.env.RELEASE_TAG,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  });
  console.log(`PASS release context ${process.env.RELEASE_TAG} at ${process.env.GITHUB_SHA}`);
}
