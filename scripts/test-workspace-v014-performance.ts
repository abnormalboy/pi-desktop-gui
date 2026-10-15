import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Workspace, snapshotStorageBytes } from '../electron/workspace';
import type { Project } from '../shared/types';

const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-checkpoint-perf-'));
try {
  const directory = path.join(root, 'project'),
    data = path.join(root, 'data');
  await fs.mkdir(directory);
  const git = (args: string[]) =>
    exec('git', args, { cwd: directory, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'Checkpoint Performance']);
  await git(['config', 'user.email', 'performance@example.invalid']);
  for (let folder = 0; folder < 100; folder++) {
    const folderPath = path.join(directory, `src-${folder}`);
    await fs.mkdir(folderPath);
    await Promise.all(
      Array.from({ length: 100 }, (_, file) =>
        fs.writeFile(
          path.join(folderPath, `file-${file}.ts`),
          `export const value = ${folder * 100 + file};\n${'// source\n'.repeat(20)}`,
        ),
      ),
    );
  }
  await git(['add', '.']);
  await git(['commit', '-qm', 'baseline']);
  const project: Project = {
    id: randomUUID(),
    path: directory,
    name: 'performance',
    trusted: true,
    createdAt: Date.now(),
  };
  const sessionId = randomUUID(),
    workspace = new Workspace(data),
    durations: number[] = [];
  let modifiedBytes = 0,
    firstBytes = 0;
  for (let turn = 1; turn <= 20; turn++) {
    if (turn > 1) {
      const content = randomBytes(256 * 1024).toString('base64');
      modifiedBytes += Buffer.byteLength(content);
      await fs.writeFile(path.join(directory, `src-${turn}`, 'file-0.ts'), content);
    }
    const start = performance.now();
    await workspace.captureCheckpoint(project, sessionId, turn, turn);
    durations.push(Math.round((performance.now() - start) * 10) / 10);
    if (turn === 1) firstBytes = await snapshotStorageBytes(data);
  }
  const totalBytes = await snapshotStorageBytes(data);
  const sorted = durations.slice().sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        files: 10_000,
        turns: 20,
        durationsMs: durations,
        medianMs: sorted[10],
        firstBytes,
        totalBytes,
        modifiedBytes,
        incrementalRatio: (totalBytes - firstBytes) / modifiedBytes,
        totalRatio: totalBytes / modifiedBytes,
      },
      null,
      2,
    ),
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
