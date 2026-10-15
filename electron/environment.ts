import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Environment, Settings } from '../shared/types';
import type { CommandSpec } from './rpc';
import {
  COMPATIBLE,
  PI_INSTALL_COMMAND,
  classifyPiVersion,
  compatibilityMessage,
} from '../shared/pi-version';
export { VERIFIED, COMPATIBLE, classifyPiVersion } from '../shared/pi-version';
import { isWindows, locateExecutable, shellCandidates, nodeExecutableName } from './platform';
const exec = promisify(execFile);
export async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
export const agentDirectory = (s: Settings) =>
  s.agentDir || process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
export async function resolvePi(
  settings: Settings,
  developmentRoot?: string,
): Promise<{ spec: CommandSpec; entry: string; node?: string }> {
  let entry = settings.piPath || (await locateExecutable('pi'));
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
  if (!entry || !(await exists(entry)))
    throw new Error(`未找到 Pi。请安装 Pi ${COMPATIBLE} 系列或在设置中选择入口。`);
  if (/\.(cmd|ps1|bat)$/i.test(entry) || (!path.extname(entry) && isWindows)) {
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
    const node = settings.nodePath || (await locateExecutable('node'));
    if (!node || !(await exists(node)))
      throw new Error(`运行此 Pi 入口需要 Node.js 22.19 或更高版本，请选择 ${nodeExecutableName}。`);
    const { stdout } = await exec(node, ['--version'], { windowsHide: true, timeout: 5000 });
    const [major, minor] = stdout.trim().replace(/^v/, '').split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19))
      throw new Error(`Pi ${COMPATIBLE} 系列需要 Node.js 22.19 或更高版本。`);
    return { entry, node, spec: { command: node, args: [entry] } };
  }
  return { entry, spec: { command: entry, args: [] } };
}
export async function detectEnvironment(settings: Settings, developmentRoot?: string): Promise<Environment> {
  const result: Environment = {
    piPath: '',
    supported: false,
    compatibility: 'unknown',
    agentDir: agentDirectory(settings),
    authExists: false,
    modelsExist: false,
    errors: [],
  };
  [result.authExists, result.modelsExist] = await Promise.all([
    exists(path.join(result.agentDir, 'auth.json')),
    exists(path.join(result.agentDir, 'models.json')),
  ]);
  result.git = await locateExecutable('git');
  let shellPath: string | undefined;
  try {
    const config = JSON.parse(await fs.readFile(path.join(result.agentDir, 'settings.json'), 'utf8'));
    if (typeof config.shellPath === 'string' && (await exists(config.shellPath)))
      shellPath = config.shellPath;
  } catch {}
  const bashCandidates = await shellCandidates(result.git, shellPath);
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
    result.version = stdout.trim().match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)(?=\s|$)/)?.[1];
    result.compatibility = classifyPiVersion(result.version);
    result.supported = ['verified', 'compatible'].includes(result.compatibility);
    if (!result.supported)
      result.errors.push(
        `${compatibilityMessage(result.version, result.compatibility)}\n${PI_INSTALL_COMMAND}`,
      );
  } catch (e) {
    result.errors.push((e as Error).message);
  }
  if (!result.bash)
    result.errors.push(
      isWindows
        ? '未检测到 Git Bash，命令执行可能失败。请安装 Git for Windows 或配置 shellPath。'
        : '未检测到 bash，命令执行可能失败。请安装 bash 或在 Pi 设置中配置 shellPath。',
    );
  return result;
}

export async function requireSupportedPi(settings: Settings, developmentRoot?: string) {
  const environment = await detectEnvironment(settings, developmentRoot);
  if (!environment.supported) throw new Error(environment.errors.join('\n'));
  return environment;
}
