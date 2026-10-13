import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import ignore from 'ignore';
import type { Changes, Change, FileDiff, FileItem, FilePreview, Project } from '../shared/types';
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
async function snapshotBytes(project: Project, relative: string) {
  const file = await snapshotPath(project.path, relative);
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MiB) throw new Error('文件不是普通文件或超过 1 MiB');
    const bytes = await handle.readFile();
    if (bytes.length > MiB || bytes.subarray(0, 8192).includes(0))
      throw new Error('二进制文件或文件超过 1 MiB');
    return bytes;
  } finally {
    await handle.close();
  }
}
interface Baseline {
  version: 2;
  projectId: string;
  fingerprint: string;
  time: number;
  files: Record<string, string>;
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
    const names = await allFiles(project);
    const baseline: Baseline = {
      version: 2,
      projectId: project.id,
      fingerprint: meta.fingerprint,
      time: Date.now(),
      files: {},
      dirty: changes.files.map((f) => f.path),
      omitted: [],
    };
    let size = 0;
    for (const name of names) {
      try {
        const bytes = await snapshotBytes(project, name);
        if (size + bytes.length > 20 * MiB) {
          baseline.omitted.push(name);
          continue;
        }
        size += bytes.length;
        baseline.files[name] = bytes.toString('base64');
      } catch {
        baseline.omitted.push(name);
      }
    }
    this.baselines.set(project.id, baseline);
    const dir = path.join(this.dataDir, 'baselines');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${project.id}.json`), JSON.stringify(baseline), { mode: 0o600 });
    await this.cleanup();
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
    for (const entry of files) {
      total += entry.stat.size;
      if (Date.now() - entry.stat.mtimeMs > 7 * 86400000 || total > 200 * MiB) await fs.unlink(entry.file);
    }
  }
  private async baseline(projectId: string) {
    if (this.baselines.has(projectId)) return this.baselines.get(projectId);
    try {
      const b: Baseline = JSON.parse(
        await fs.readFile(path.join(this.dataDir, 'baselines', `${projectId}.json`), 'utf8'),
      );
      // Text-only snapshots cannot guarantee a lossless restore.
      if (b.version === 2 && Date.now() - b.time <= 7 * 86400000 && b.projectId === projectId) {
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
        const current = await allFiles(project);
        const names = new Set([...current, ...Object.keys(baseline!.files)]);
        const files: Change[] = [];
        for (const name of names) {
          if (baseline!.omitted.includes(name)) continue;
          let after = '',
            present = true;
          try {
            after = (await snapshotBytes(project, name)).toString('base64');
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') present = false;
            else {
              result.omitted.push(name);
              continue;
            }
          }
          const existed = name in baseline!.files,
            before = baseline!.files[name] ?? '';
          if (existed === present && before === after) continue;
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
    const changed = (await this.changes(project, 'run')).files.map((f) => f.path);
    const targets = only ? changed.filter((p) => only.includes(p)) : changed;
    if (only && targets.length !== new Set(only).size)
      throw new Error('部分文件已不在本轮变更中，请刷新后再试');
    const reverted: string[] = [];
    for (const name of targets) {
      if (baseline.omitted.includes(name) || sensitive(name)) continue;
      const absolute = await snapshotPath(project.path, name, name in baseline.files);
      if (name in baseline.files) {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await snapshotPath(project.path, name, true);
        await fs.writeFile(absolute, Buffer.from(baseline.files[name], 'base64'));
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
    if (mode === 'run')
      result.before = Buffer.from(baseline!.files[relative] ?? '', 'base64').toString('utf8');
    else if (meta.head) {
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
