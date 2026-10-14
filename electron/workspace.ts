import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import ignore from 'ignore';
import type { Changes, Change, FileDiff, FileItem, FilePreview, Project } from '../shared/types';
import { createSnapshotRepo, hashBlobs, readBlob, storeBlobs } from './snapshot';
const exec = promisify(execFile);
const MiB = 1024 * 1024;
const excluded = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'dist-electron',
  'release',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
]);
export const sensitive = (name: string) =>
  /(^|[\\/])(\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|id_rsa|id_ed25519|[^/\\]+\.(?:pem|key|p12|pfx))$/i.test(
    name,
  );
export function contained(root: string, target: string) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export async function safePath(root: string, relative: string, allowRoot = false) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative))
    throw new Error('文件路径必须位于项目内');
  const canonical = await fs.realpath(root),
    resolved = path.resolve(root, relative);
  if (
    !contained(canonical, resolved) ||
    (!allowRoot && resolved === canonical) ||
    relative.split(/[\\/]/).includes('.git')
  )
    throw new Error('不能访问项目以外的文件或 Git 内部数据');
  const real = await fs.realpath(resolved);
  if (!contained(canonical, real)) throw new Error('符号链接指向项目外，无法访问');
  return real;
}
async function git(root: string, args: string[], maxBuffer = 4 * MiB) {
  return (
    await exec('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', ...args], {
      cwd: root,
      windowsHide: true,
      maxBuffer,
      timeout: 15000,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    })
  ).stdout;
}
async function info(root: string) {
  const gitRoot = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();
  let head = '';
  try {
    head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch {}
  let branch = '';
  try {
    branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).trim();
  } catch {
    branch = head ? head.slice(0, 8) : '尚无提交';
  }
  return { gitRoot, prefix, head, branch, fingerprint: `${head}:${branch}` };
}
export async function previewFile(project: Project, relative: string, limit = MiB): Promise<FilePreview> {
  if (sensitive(relative)) throw new Error('凭据文件不在文件预览和引用范围内');
  const file = await safePath(project.path, relative);
  if (sensitive(path.relative(project.path, file))) throw new Error('凭据文件不在文件预览和引用范围内');
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('只能读取普通文件');
  const handle = await fs.open(file, 'r');
  try {
    const bytes = Buffer.alloc(Math.min(stat.size, limit));
    await handle.read(bytes, 0, bytes.length, 0);
    const binary = bytes.subarray(0, 8192).includes(0);
    return {
      path: relative,
      size: stat.size,
      text: binary ? '' : bytes.toString('utf8'),
      binary,
      truncated: stat.size > limit,
    };
  } finally {
    await handle.close();
  }
}
export async function attachmentPrompt(project: Project, text: string, names: string[]) {
  if (Buffer.byteLength(text, 'utf8') > MiB) throw new Error('消息超过 1 MiB，请缩小内容');
  let bytes = Buffer.byteLength(text, 'utf8');
  const parts: string[] = [];
  if (names.length > 20) throw new Error('单条消息最多引用 20 个文件');
  for (const name of [...new Set(names)]) {
    const file = await previewFile(project, name, 256 * 1024);
    if (file.binary || file.truncated) throw new Error(`${name} 不是可引用文本或超过 256 KiB`);
    const part = `\n\n<project_file path=${JSON.stringify(name)}>\n${file.text}\n</project_file>`;
    bytes += Buffer.byteLength(part, 'utf8');
    if (bytes > MiB) throw new Error('消息与附件总计超过 1 MiB');
    parts.push(part);
  }
  return text + parts.join('');
}
async function matcher(root: string) {
  const ig = ignore();
  try {
    ig.add(await fs.readFile(path.join(root, '.gitignore'), 'utf8'));
  } catch {}
  return ig;
}
export async function listDirectory(project: Project, directory: string): Promise<FileItem[]> {
  const real = await safePath(project.path, directory, true);
  const ig = await matcher(project.path);
  const entries = await fs.readdir(real, { withFileTypes: true });
  const result: FileItem[] = [];
  for (const e of entries) {
    const rel = path.relative(project.path, path.join(real, e.name)).replaceAll('\\', '/');
    if (
      excluded.has(e.name) ||
      sensitive(rel) ||
      e.isSymbolicLink() ||
      ig.ignores(rel + (e.isDirectory() ? '/' : ''))
    )
      continue;
    result.push({ name: e.name, path: rel, directory: e.isDirectory() });
  }
  return result
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    .slice(0, 1000);
}
export async function allFiles(project: Project): Promise<string[]> {
  try {
    const raw = await git(project.path, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      '.',
    ]);
    return [...new Set(raw.split('\0').filter(Boolean))]
      .filter((n) => !sensitive(n) && !n.split('/').some((p) => excluded.has(p)))
      .slice(0, 20000);
  } catch {
    const files: string[] = [];
    async function walk(rel: string, depth: number) {
      if (depth > 15 || files.length >= 10000) return;
      for (const item of await listDirectory(project, rel)) {
        if (item.directory) await walk(item.path, depth + 1);
        else files.push(item.path);
        if (files.length >= 10000) break;
      }
    }
    await walk('', 0);
    return files;
  }
}
// Snapshot and restore ordinary files only. Resolving a link is safe for a preview,
// but would make an undo operate on the link's target instead of the named file.
async function snapshotPath(root: string, relative: string, allowMissing = false) {
  const canonical = await fs.realpath(root);
  const absolute = path.resolve(canonical, relative);
  if (
    path.isAbsolute(relative) ||
    relative.includes('\0') ||
    !contained(canonical, absolute) ||
    absolute === canonical ||
    relative.split(/[\\/]/).includes('.git') ||
    sensitive(relative)
  )
    throw new Error('该文件不能自动撤销，请在编辑器中处理');
  let current = canonical;
  for (const part of path.relative(canonical, absolute).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error('路径包含符号链接或目录链接，不能自动撤销，请在编辑器中处理');
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return absolute;
      throw error;
    }
  }
  return absolute;
}
const SNAPSHOT_FILE_LIMIT = 50 * MiB;
async function snapshotStorageBytes(directory: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return snapshotStorageBytes(file);
      return entry.isFile() ? (await fs.stat(file)).size : 0;
    }),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}
/**
 * Classify files for snapshotting with one lstat per path component. Symbolic links, non-regular
 * files and very large files are reported as omitted; names Git cannot take on stdin are too.
 */
async function snapshotCandidates(root: string, names: string[]) {
  const canonical = await fs.realpath(root);
  const linkCache = new Map<string, Promise<boolean>>();
  const isLink = (absolute: string) => {
    let v = linkCache.get(absolute);
    if (!v) {
      v = fs.lstat(absolute).then(
        (s) => s.isSymbolicLink(),
        () => false,
      );
      linkCache.set(absolute, v);
    }
    return v;
  };
  const files: { name: string; mode: number }[] = [],
    omitted: string[] = [],
    missing: string[] = [];
  const check = async (name: string) => {
    if (/[\r\n]/.test(name) || sensitive(name) || name.split('/').includes('.git')) return omitted.push(name);
    const absolute = path.resolve(canonical, name);
    if (!contained(canonical, absolute) || absolute === canonical) return omitted.push(name);
    const parts = path.relative(canonical, absolute).split(path.sep);
    let current = canonical;
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      if (await isLink(current)) return omitted.push(name);
    }
    try {
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.size > SNAPSHOT_FILE_LIMIT) return omitted.push(name);
      files.push({ name, mode: stat.mode & 0o777 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') missing.push(name);
      else omitted.push(name);
    }
  };
  for (let i = 0; i < names.length; i += 128) await Promise.all(names.slice(i, i + 128).map(check));
  return { files, omitted, missing };
}
interface Baseline {
  version: 3;
  projectId: string;
  fingerprint: string;
  time: number;
  /** Private bare repository (under baselines/) that holds the blobs. */
  repo: string;
  /** relative path -> blob id of the bytes on disk */
  files: Record<string, string>;
  modes: Record<string, number>;
  dirty: string[];
  omitted: string[];
}
export class Workspace {
  private baselines = new Map<string, Baseline>();
  constructor(private dataDir: string) {}
  async capture(project: Project) {
    let meta;
    try {
      meta = await info(project.path);
    } catch {
      return;
    }
    const changes = await this.changes(project);
    const { files, omitted } = await snapshotCandidates(project.path, await allFiles(project));
    const time = Date.now();
    const dir = path.join(this.dataDir, 'baselines');
    const repo = `${project.id}-${time}.git`;
    await createSnapshotRepo(path.join(dir, repo), project.path);
    const ids = await storeBlobs(
      path.join(dir, repo),
      project.path,
      files.map((f) => f.name),
    );
    const baseline: Baseline = {
      version: 3,
      projectId: project.id,
      fingerprint: meta.fingerprint,
      time,
      repo,
      files: Object.fromEntries(files.map((f, i) => [f.name, ids[i]])),
      modes: Object.fromEntries(files.map((f) => [f.name, f.mode])),
      dirty: changes.files.map((f) => f.path),
      omitted,
    };
    this.baselines.set(project.id, baseline);
    await fs.writeFile(path.join(dir, `${project.id}.json`), JSON.stringify(baseline), { mode: 0o600 });
    await this.cleanup();
    if (!this.baselines.has(project.id))
      throw new Error('本轮快照超过 200 MiB 的保留上限，请缩小项目范围或减少需保存的文件后重试');
  }
  async cleanup() {
    const dir = path.join(this.dataDir, 'baselines');
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir);
    const files = [];
    for (const name of entries) {
      if (!/^[\w-]+\.json$/.test(name)) continue;
      const file = path.join(dir, name);
      const stat = await fs.stat(file);
      if (stat.isFile()) files.push({ file, stat });
    }
    files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    let total = 0;
    const live = new Set<string>();
    for (const entry of files) {
      let repo: string | undefined;
      try {
        const name = JSON.parse(await fs.readFile(entry.file, 'utf8')).repo;
        if (typeof name === 'string' && /^[\w-]+-\d+\.git$/.test(name)) repo = name;
      } catch {}
      total += entry.stat.size + (repo ? await snapshotStorageBytes(path.join(dir, repo)) : 0);
      if (Date.now() - entry.stat.mtimeMs > 7 * 86400000 || total > 200 * MiB) {
        await fs.unlink(entry.file);
        this.baselines.delete(path.basename(entry.file, '.json'));
      } else if (repo) {
        live.add(repo);
      }
    }
    // Snapshot repositories that no current baseline points to.
    for (const name of entries)
      if (/^[\w-]+-\d+\.git$/.test(name) && !live.has(name))
        await fs.rm(path.join(dir, name), { recursive: true, force: true });
  }
  private repoPath(b: Baseline) {
    return path.join(this.dataDir, 'baselines', b.repo);
  }
  /** Blob id of each named file as it is on disk now; undefined when missing. Unsafe paths throw. */
  private async current(project: Project, names: string[]) {
    const { files, omitted, missing } = await snapshotCandidates(project.path, names);
    const ids = await hashBlobs(
      project.path,
      files.map((f) => f.name),
    );
    const now = new Map<string, string | undefined>(files.map((f, i) => [f.name, ids[i]]));
    for (const m of missing) now.set(m, undefined);
    return { now, omitted, modes: new Map(files.map((f) => [f.name, f.mode])) };
  }
  private async baseline(projectId: string) {
    if (this.baselines.has(projectId)) return this.baselines.get(projectId);
    try {
      const b: Baseline = JSON.parse(
        await fs.readFile(path.join(this.dataDir, 'baselines', `${projectId}.json`), 'utf8'),
      );
      // Older text and inline snapshots are not restorable by this version.
      if (b.version === 3 && Date.now() - b.time <= 7 * 86400000 && b.projectId === projectId) {
        this.baselines.set(projectId, b);
        return b;
      }
    } catch {}
    return undefined;
  }
  async changes(project: Project, mode: 'all' | 'run' = 'all'): Promise<Changes> {
    let meta;
    try {
      meta = await info(project.path);
    } catch {
      return { git: false, files: [], baselineAvailable: false, omitted: [] };
    }
    const baseline = await this.baseline(project.id);
    const valid = !!baseline && baseline.fingerprint === meta.fingerprint;
    const result: Changes = {
      git: true,
      branch: meta.branch,
      head: meta.head,
      files: [],
      baselineAvailable: valid,
      baselineInvalid: !!baseline && !valid,
      omitted: [...(baseline?.omitted ?? [])],
    };
    try {
      const raw = await git(project.path, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        '.',
      ]);
      const items = raw.split('\0');
      for (let i = 0; i < items.length; i++) {
        const record = items[i];
        if (!record) continue;
        const xy = record.slice(0, 2);
        const file = record.slice(3);
        let old: string | undefined;
        if (/[RC]/.test(xy)) old = items[++i];
        const absolute = path.resolve(meta.gitRoot, file);
        if (!contained(project.path, absolute)) continue;
        const relative = path.relative(project.path, absolute).replaceAll('\\', '/');
        result.files.push({
          path: relative,
          oldPath: old
            ? path.relative(project.path, path.resolve(meta.gitRoot, old)).replaceAll('\\', '/')
            : undefined,
          status:
            xy === '??'
              ? '新增'
              : xy.includes('D')
                ? '删除'
                : xy.includes('R')
                  ? '重命名'
                  : xy.includes('A')
                    ? '新增'
                    : '修改',
          staged: xy[0] !== ' ' && xy[0] !== '?',
          unstaged: xy[1] !== ' ',
          existedBeforeRun: baseline?.dirty.includes(relative) ?? false,
        });
      }
      if (mode === 'run' && valid) {
        const skip = new Set(baseline!.omitted);
        const names = [...new Set([...(await allFiles(project)), ...Object.keys(baseline!.files)])].filter(
          (n) => !skip.has(n),
        );
        const { now, omitted, modes } = await this.current(project, names);
        result.omitted.push(...omitted.filter((n) => !result.omitted.includes(n)));
        const files: Change[] = [];
        for (const name of names) {
          if (!now.has(name)) continue;
          const after = now.get(name),
            before = baseline!.files[name];
          const existed = before !== undefined,
            present = after !== undefined;
          const modeChanged =
            process.platform !== 'win32' && existed && present && baseline!.modes[name] !== modes.get(name);
          if (before === after && !modeChanged) continue;
          files.push({
            path: name,
            status: !present ? '删除' : !existed ? '新增' : '修改',
            staged: false,
            unstaged: true,
            existedBeforeRun: baseline!.dirty.includes(name),
          });
        }
        result.files = files;
      }
    } catch (e) {
      result.error = (e as Error).message;
    }
    return result;
  }
  async revert(
    project: Project,
    only: string[] | null,
    remove: (file: string) => Promise<void> = (file) => fs.rm(file),
  ): Promise<string[]> {
    const meta = await info(project.path);
    const baseline = await this.baseline(project.id);
    if (!baseline || baseline.fingerprint !== meta.fingerprint)
      throw new Error('运行基线不可用或 Git 分支已经变化，无法撤销');
    const changes = await this.changes(project, 'run');
    if (changes.error) throw new Error(`无法确认本轮文件变化，未执行撤销：${changes.error}`);
    const changed = changes.files.map((f) => f.path);
    const targets = only ? changed.filter((p) => only.includes(p)) : changed;
    if (only && targets.length !== new Set(only).size)
      throw new Error('部分文件已不在本轮变更中，请刷新后再试');
    // Read every original first so a missing blob cannot leave a half-reverted run.
    const originals = new Map<string, Buffer>();
    for (const name of targets)
      if (name in baseline.files)
        originals.set(name, await readBlob(this.repoPath(baseline), project.path, baseline.files[name]));
    const reverted: string[] = [];
    for (const name of targets) {
      if (baseline.omitted.includes(name) || sensitive(name)) continue;
      const absolute = await snapshotPath(project.path, name, name in baseline.files);
      const original = originals.get(name);
      if (original) {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await snapshotPath(project.path, name, true);
        await fs.writeFile(absolute, original);
        if (process.platform !== 'win32' && baseline.modes[name] !== undefined)
          await fs.chmod(absolute, baseline.modes[name]);
      } else {
        await remove(absolute);
      }
      reverted.push(name);
    }
    return reverted;
  }
  async diff(project: Project, relative: string, mode: 'all' | 'run'): Promise<FileDiff> {
    const result: FileDiff = { path: relative, patch: '', before: '', after: '' };
    if (
      path.isAbsolute(relative) ||
      !contained(project.path, path.resolve(project.path, relative)) ||
      sensitive(relative) ||
      relative.includes('\0')
    )
      return { ...result, unavailable: '该文件不能在差异面板中预览' };
    const meta = await info(project.path);
    const baseline = await this.baseline(project.id);
    if (mode === 'run' && (!baseline || baseline.fingerprint !== meta.fingerprint))
      return { ...result, unavailable: '运行基线不可用或 Git 分支已经变化' };
    if (mode === 'run' && baseline!.omitted.includes(relative))
      return { ...result, unavailable: '该文件未包含在运行基线中' };
    try {
      const f = await previewFile(project, relative);
      if (f.binary || f.truncated)
        return { ...result, unavailable: '二进制文件或文件超过 1 MiB，请在编辑器中查看' };
      result.after = f.text;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (mode === 'run') {
      const id = baseline!.files[relative];
      if (id) {
        const original = await readBlob(this.repoPath(baseline!), project.path, id);
        if (original.length > MiB || original.subarray(0, 8192).includes(0))
          return { ...result, unavailable: '二进制文件或原内容超过 1 MiB，可撤销但无法预览差异' };
        result.before = original.toString('utf8');
      }
    } else if (meta.head) {
      try {
        result.before = await git(
          project.path,
          ['show', `${meta.head}:${meta.prefix}${relative.replaceAll('\\', '/')}`],
          MiB,
        );
        if (result.before.includes('\0')) return { ...result, before: '', unavailable: '二进制文件' };
      } catch (e) {
        if (String(e).includes('maxBuffer')) return { ...result, unavailable: '历史版本超过 1 MiB' };
      }
    }
    result.patch = createTwoFilesPatch(
      relative,
      relative,
      result.before,
      result.after,
      '原内容',
      '当前内容',
      { context: 4 },
    );
    if (result.patch.length > 256 * 1024)
      result.patch = result.patch.slice(0, 256 * 1024) + '\n… 差异已截断，请在编辑器中查看完整内容';
    return result;
  }
}
