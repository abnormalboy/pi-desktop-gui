// Exercise version detection through a real executable entry, without replacing user installations.
import fs from 'node:fs';
import path from 'node:path';
if (process.argv.includes('--version')) {
  console.log(fs.readFileSync(path.join(process.env.PI_CODING_AGENT_DIR, 'fixture-version.txt'), 'utf8'));
} else {
  await import('./fixture-pi.mjs');
}
