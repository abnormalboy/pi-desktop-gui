import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function killPosixTree(pid: number) {
  const signal = (target: number, value: NodeJS.Signals) => {
    try {
      process.kill(target, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  // Pause Pi before inspecting its children so it cannot start the next tool while we stop this one.
  signal(-pid, 'SIGSTOP');
  try {
    const { stdout } = await exec('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { timeout: 5000 });
    const processes = stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [child, parent, group] = line.trim().split(/\s+/).map(Number);
        return { child, parent, group };
      });
    const descendants: typeof processes = [];
    const parents = new Set([pid]);
    for (const parent of parents) {
      for (const process of processes) {
        if (process.parent !== parent || parents.has(process.child)) continue;
        parents.add(process.child);
        descendants.push(process);
      }
    }
    // Pi's shell tools start their own groups. Killing only Pi's group leaves those commands running.
    for (const child of descendants.reverse()) {
      if (child.group === child.child) signal(-child.group, 'SIGKILL');
      signal(child.child, 'SIGKILL');
    }
    signal(-pid, 'SIGKILL');
  } catch (error) {
    signal(-pid, 'SIGCONT');
    throw new Error('无法确认所有命令已结束，请重试强制结束。', { cause: error });
  }
}

export interface CommandSpec {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}
export class LfJsonDecoder {
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  constructor(
    private emit: (value: any) => void,
    private invalid: (error: Error) => void,
  ) {}
  push(chunk: Buffer) {
    this.buffer += this.decoder.write(chunk);
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (!record || typeof record !== 'object' || typeof record.type !== 'string')
          throw new Error('缺少事件类型');
        this.emit(record);
      } catch (e) {
        this.invalid(new Error(`Pi 输出不是有效 JSONL：${(e as Error).message}`));
      }
    }
    if (this.buffer.length > 128 * 1024 * 1024) {
      this.buffer = '';
      this.invalid(new Error('Pi 单条协议记录超过 128 MiB'));
    }
  }
}
export class PiRpc extends EventEmitter {
  child?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private writes = Promise.resolve();
  closed = false;
  start(spec: CommandSpec, cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
    if (this.child) throw new Error('进程已启动');
    this.child = spawn(spec.command, [...spec.args, ...args], {
      cwd,
      windowsHide: true,
      // Own process group on POSIX so killTree can stop commands Pi spawned, not just Pi itself.
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...spec.env, ...env },
    });
    const decoder = new LfJsonDecoder(
      (record) => {
        if (
          record.type === 'extension_ui_request' &&
          record.method === 'notify' &&
          typeof record.message === 'string' &&
          record.message.startsWith('__PI_DESKTOP__')
        ) {
          try {
            this.emit('event', JSON.parse(record.message.slice('__PI_DESKTOP__'.length)));
          } catch {
            this.emit('protocolError', new Error('桌面适配返回了无效数据'));
          }
          return;
        }
        if (record.type === 'response' && typeof record.id === 'string') {
          const item = this.pending.get(record.id);
          if (item) {
            clearTimeout(item.timer);
            this.pending.delete(record.id);
            record.success
              ? item.resolve(record.data)
              : item.reject(new Error(record.error || 'Pi 拒绝了命令'));
          }
        } else this.emit('event', record);
      },
      (error) => {
        this.emit('protocolError', error);
      },
    );
    this.child.stdout.on('data', (chunk) => decoder.push(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (text) => this.emit('diagnostic', text));
    this.child.on('error', (error) => {
      this.rejectAll(error);
      this.emit('fault', error);
    });
    this.child.on('exit', (code, signal) => {
      this.closed = true;
      this.rejectAll(new Error(`Pi 进程已退出 (${code ?? signal})`));
      this.emit('exit', code, signal);
    });
    this.child.stdin.on('error', (e) => this.rejectAll(e));
  }
  private rejectAll(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  write(record: object) {
    this.writes = this.writes
      .catch(() => {})
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (!this.child || this.closed || this.child.stdin.destroyed)
              return reject(new Error('Pi 未连接'));
            this.child.stdin.write(JSON.stringify(record) + '\n', 'utf8', (error) =>
              error ? reject(error) : resolve(),
            );
          }),
      );
    return this.writes;
  }
  request(type: string, values: Record<string, unknown> = {}, timeout = 30_000): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} 超时，请检查 Pi 状态`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, type, ...values }).catch((e) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      });
    });
  }
  async bridge(method: string, params: unknown = {}) {
    const id = randomUUID();
    let result: any;
    let received = false;
    const listener = (event: any) => {
      if (event.type === 'desktop_result' && event.id === id) {
        result = event;
        received = true;
      }
    };
    this.on('event', listener);
    try {
      await this.request(
        'prompt',
        {
          message:
            '/desktop-internal ' + Buffer.from(JSON.stringify({ id, method, params })).toString('base64'),
        },
        600_000,
      );
      if (!received) throw new Error('Pi 桌面适配未响应，请重新连接');
      if (result.error) throw new Error(result.error);
      return result.data;
    } finally {
      this.off('event', listener);
    }
  }
  async close() {
    if (!this.child || this.closed) return;
    this.child.stdin.end();
    await this.waitExit(2000);
    if (!this.closed) await this.killTree();
  }
  private waitExit(ms: number) {
    if (this.closed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.off('exit', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.once('exit', done);
    });
  }
  async killTree() {
    const pid = this.child?.pid;
    if (!pid || this.closed) return;
    if (process.platform === 'win32')
      await new Promise<void>((resolve, reject) =>
        execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) =>
          error && !this.closed ? reject(error) : resolve(),
        ),
      );
    else await killPosixTree(pid);
    await this.waitExit(5000);
    if (!this.closed) throw new Error('进程未确认退出');
  }
}
