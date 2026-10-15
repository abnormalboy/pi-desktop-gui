// Tool approval policy shared by the Pi bridge (decides) and the desktop UI (renders).
export type ApprovalMode = 'auto' | 'confirm' | 'readonly';
export const APPROVAL_PREFIX = '__PI_DESKTOP_APPROVAL__';
export const APPROVAL_ALLOW = '允许一次';
export const APPROVAL_ALWAYS = '本会话总是允许';
export const APPROVAL_DENY = '拒绝';

export type WriteTarget = 'project' | 'outside' | 'sensitive';
export type ApprovalGrant =
  | { id: string; kind: 'shell-prefix' | 'shell-exact'; toolName: string; command: string }
  | { id: string; kind: 'write-project' }
  | { id: string; kind: 'tool'; toolName: string };

export interface ApprovalRequest {
  toolName: string;
  kind: 'shell' | 'write' | 'other';
  /** Command line, file path or short JSON summary shown to the user. */
  summary: string;
  /** Unified diff for edit, or new file content for write (truncated). */
  detail?: string;
  path?: string;
  writeTarget?: WriteTarget;
  /** Prepared by the bridge after resolving the write target, never by the renderer. */
  grant?: ApprovalGrant;
}

const readTools = new Set(['read', 'grep', 'find', 'ls', 'tool_search']);
const shellTools = new Set(['bash', 'powershell']);

/** 'allow' runs the tool, 'ask' needs the user, 'deny' blocks it without asking. */
export function decide(mode: ApprovalMode, toolName: string): 'allow' | 'ask' | 'deny' {
  if (mode === 'auto' || readTools.has(toolName)) return 'allow';
  // External annotations are hints, not a trusted grant to run without approval.
  return mode === 'readonly' ? 'deny' : 'ask';
}

export function describe(toolName: string, input: any): ApprovalRequest {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '\n…（已截断）' : s);
  if (shellTools.has(toolName)) return { toolName, kind: 'shell', summary: String(input?.command ?? '') };
  if (toolName === 'edit') {
    const edits: { oldText?: string; newText?: string }[] = Array.isArray(input?.edits) ? input.edits : [];
    const detail = edits
      .map((e) =>
        [
          ...String(e.oldText ?? '')
            .split('\n')
            .map((l) => '-' + l),
          ...String(e.newText ?? '')
            .split('\n')
            .map((l) => '+' + l),
        ].join('\n'),
      )
      .join('\n@@\n');
    return {
      toolName,
      kind: 'write',
      summary: String(input?.path ?? ''),
      path: String(input?.path ?? ''),
      detail: clip(detail, 20000),
    };
  }
  if (toolName === 'write')
    return {
      toolName,
      kind: 'write',
      summary: String(input?.path ?? ''),
      path: String(input?.path ?? ''),
      detail: clip(
        String(input?.content ?? '')
          .split('\n')
          .map((l) => '+' + l)
          .join('\n'),
        20000,
      ),
    };
  return { toolName, kind: 'other', summary: clip(JSON.stringify(input ?? {}), 2000) };
}

/** Key for "always allow in this session": the exact command, or the tool name for other tools. */
export const alwaysKey = (r: ApprovalRequest) =>
  r.kind === 'shell' ? `${r.toolName}\u0000${r.summary}` : r.toolName;

/** Only literal command words are eligible; unsupported shell syntax requires an exact grant. */
export function commandPrefix(command: string): string | null {
  if (!command.trim() || !/^[A-Za-z0-9_./:=+%,\- \t]+$/.test(command)) return null;
  // Percent expansion is executable syntax in cmd, and can be forwarded by other shells.
  if (command.includes('%')) return null;
  const words = command.trim().split(/[ \t]+/);
  const executable = words[0];
  if (!/^[A-Za-z0-9_-]+$/.test(executable)) return null;
  // Shell/interpreter wrappers have no useful boundary between an argument and executable code.
  if (
    /^(?:sh|bash|zsh|fish|cmd|powershell|pwsh|eval|exec|env|sudo|doas|source|node|python[\d.]*|ruby|perl|xargs|find|npx|pip|pip3|uv|command|nohup|timeout|watch|time|nice|stdbuf|chroot|su|busybox|ssh|Invoke-Expression|Invoke-Command|Start-Process)$/i.test(
      executable,
    )
  )
    return null;
  const subcommand = words[1];
  if (['npm', 'pnpm', 'yarn', 'bun', 'git', 'cargo', 'go', 'dotnet', 'docker'].includes(executable)) {
    if (!subcommand || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(subcommand)) return null;
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(executable) && subcommand === 'run') {
      const script = words[2];
      return script && /^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(script) ? `${executable} run ${script}` : null;
    }
    // These subcommands run a command/program supplied by subsequent arguments.
    if (['exec', 'dlx', 'x', 'run', 'alias', 'config'].includes(subcommand)) return null;
    return `${executable} ${subcommand}`;
  }
  return executable;
}

export const sensitiveWritePath = (name: string) =>
  /(^|[\\/])(\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|id_rsa|id_ed25519|[^/\\]+\.(?:pem|key|p12|pfx))$/i.test(
    name,
  );

export function grantForRequest(request: ApprovalRequest): ApprovalGrant | undefined {
  if (request.kind === 'write')
    return request.writeTarget === 'project' ? { id: 'write:project', kind: 'write-project' } : undefined;
  if (request.kind === 'shell') {
    const prefix = commandPrefix(request.summary);
    const kind = prefix ? 'shell-prefix' : 'shell-exact';
    const command = prefix ?? request.summary;
    return { id: `${kind}:${request.toolName}:${command}`, kind, toolName: request.toolName, command };
  }
  return { id: `tool:${request.toolName}`, kind: 'tool', toolName: request.toolName };
}

export function matchesGrant(grant: ApprovalGrant, request: ApprovalRequest): boolean {
  if (grant.kind === 'write-project') return request.kind === 'write' && request.writeTarget === 'project';
  if (grant.kind === 'tool') return request.kind === 'other' && request.toolName === grant.toolName;
  if (request.kind !== 'shell' || request.toolName !== grant.toolName) return false;
  return grant.kind === 'shell-exact'
    ? request.summary === grant.command
    : commandPrefix(request.summary) === grant.command;
}

export function grantLabel(grant: ApprovalGrant): string {
  if (grant.kind === 'write-project') return '项目内修改：edit / write';
  if (grant.kind === 'tool') return `工具：${grant.toolName}`;
  return `${grant.kind === 'shell-prefix' ? '命令前缀' : '完整命令'}：${grant.command}`;
}

export function grantActionLabel(grant: ApprovalGrant): string {
  if (grant.kind === 'write-project') return '本会话允许修改项目内文件';
  if (grant.kind === 'tool') return `本会话总是允许 ${grant.toolName}`;
  return grant.kind === 'shell-prefix' ? `本会话允许 ${grant.command} 开头` : '本会话总是允许此完整命令';
}

export function isApprovalGrant(value: unknown): value is ApprovalGrant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as ApprovalGrant;
  if (typeof grant.id !== 'string' || !grant.id) return false;
  if (grant.kind === 'write-project') return grant.id === 'write:project';
  if (typeof grant.toolName !== 'string' || !grant.toolName) return false;
  if (grant.kind === 'tool') return true;
  return (grant.kind === 'shell-prefix' || grant.kind === 'shell-exact') && typeof grant.command === 'string';
}
