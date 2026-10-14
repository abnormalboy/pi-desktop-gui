// Tool approval policy shared by the Pi bridge (decides) and the desktop UI (renders).
export type ApprovalMode = 'auto' | 'confirm' | 'readonly';
export const APPROVAL_PREFIX = '__PI_DESKTOP_APPROVAL__';
export const APPROVAL_ALLOW = '允许一次';
export const APPROVAL_ALWAYS = '本会话总是允许';
export const APPROVAL_DENY = '拒绝';

export interface ApprovalRequest {
  toolName: string;
  kind: 'shell' | 'write' | 'other';
  /** Command line, file path or short JSON summary shown to the user. */
  summary: string;
  /** Unified diff for edit, or new file content for write (truncated). */
  detail?: string;
  path?: string;
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
