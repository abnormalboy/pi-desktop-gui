import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Environment, Settings } from '../shared/types';
import type { CommandSpec } from './rpc';
const exec = promisify(execFile);
export async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function locate(name: string): Promise<string> {
  try {
    const { stdout } = await exec(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
      windowsHide: true,
      timeout: 3000,
    });
    return stdout.trim().split(/\r?\n/)[0] || '';
  } catch {
    return '';
  }
}
export const agentDirectory = (s: Settings) =>
  s.agentDir || process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
export async function resolvePi(
  settings: Settings,
  developmentRoot?: string,
): Promise<{ spec: CommandSpec; entry: string; node?: string }> {
  let entry = settings.piPath || (await locate('pi'));
  if (!entry && developmentRoot) {
    const local = path.join(
      developmentRoot,
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'bundle',
      'cli.js',
    );
    if (await exists(local)) entry = local;
  }
  if (!entry || !(await exists(entry))) throw new Error('未找到 Pi。请安装 Pi 1.1.0 或在设置中选择入口。');
  if (/\.(cmd|ps1|bat)$/i.test(entry) || (!path.extname(entry) && process.platform === 'win32')) {
    const base = path.dirname(entry);
    const candidates = [
      path.join(base, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'),
      path.join(base, 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js'),
    ];
    const found = await Promise.all(candidates.map(exists));
    entry = candidates.find((_, i) => found[i]) || '';
    if (!entry) throw new Error('无法安全解析此启动脚本。请选择 Pi 的 cli.js 或官方可执行文件。');
  }
  if (/\.(m?js|cjs)$/i.test(entry)) {
    const node = settings.nodePath || (await locate('node'));
    if (!node || !(await exists(node)))
      throw new Error(
        `运行此 Pi 入口需要 Node.js 22.19 或更高版本，请选择 ${process.platform === 'win32' ? 'node.exe' : 'node 可执行文件'}。`,
      );
    const { stdout } = await exec(node, ['--version'], { windowsHide: true, timeout: 5000 });
    const [major, minor] = stdout.trim().replace(/^v/, '').split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19))
      throw new Error('Pi 1.1.0 需要 Node.js 22.19 或更高版本。');
    return { entry, node, spec: { command: node, args: [entry] } };
  }
  return { entry, spec: { command: entry, args: [] } };
}
export async function detectEnvironment(settings: Settings, developmentRoot?: string): Promise<Environment> {
  const result: Environment = {
    piPath: '',
    supported: false,
    agentDir: agentDirectory(settings),
    authExists: false,
    modelsExist: false,
    errors: [],
  };
  [result.authExists, result.modelsExist] = await Promise.all([
    exists(path.join(result.agentDir, 'auth.json')),
    exists(path.join(result.agentDir, 'models.json')),
  ]);
  result.git = await locate('git');
  let shellPath: string | undefined;
  try {
    const config = JSON.parse(await fs.readFile(path.join(result.agentDir, 'settings.json'), 'utf8'));
    if (typeof config.shellPath === 'string' && (await exists(config.shellPath)))
      shellPath = config.shellPath;
  } catch {}
  const bashCandidates = (
    process.platform === 'win32'
      ? [
          shellPath || '',
          process.env['ProgramFiles']
            ? path.join(process.env['ProgramFiles']!, 'Git', 'bin', 'bash.exe')
            : '',
          result.git ? path.resolve(result.git, '..', '..', 'bin', 'bash.exe') : '',
          await locate('bash'),
        ]
      : [shellPath || '', await locate('bash'), '/bin/bash']
  ).filter(Boolean);
  for (const candidate of bashCandidates)
    if (await exists(candidate)) {
      result.bash = candidate;
      break;
    }
  try {
    const resolved = await resolvePi(settings, developmentRoot);
    result.piPath = resolved.entry;
    result.nodePath = resolved.node;
    const { stdout } = await exec(resolved.spec.command, [...resolved.spec.args, '--version'], {
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, PI_CODING_AGENT_DIR: result.agentDir },
    });
    result.version = stdout.trim().match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0];
    result.supported = result.version === '1.1.0';
    if (!result.supported)
      result.errors.push(`当前 Pi ${result.version || '未知版本'} 尚未验证，本版本支持 Pi 1.1.0。`);
  } catch (e) {
    result.errors.push((e as Error).message);
  }
  if (!result.bash)
    result.errors.push(
      process.platform === 'win32'
        ? '未检测到 Git Bash，命令执行可能失败。请安装 Git for Windows 或配置 shellPath。'
        : '未检测到 bash，命令执行可能失败。请安装 bash 或在 Pi 设置中配置 shellPath。',
    );
  return result;
}
