import { useEffect, useRef, useState } from 'react';
import { FileText, Check, Terminal, ShieldCheck, Eye, Zap } from 'lucide-react';
import { APPROVAL_ALLOW, APPROVAL_ALWAYS, APPROVAL_DENY } from '../../shared/approval';
import { type ExtensionDialog, type ApprovalMode } from '../../shared/types';

export const approvalModes: [ApprovalMode, string, string][] = [
  ['auto', '全自动', 'Pi 直接修改文件、执行命令'],
  ['confirm', '确认修改', '写文件、执行命令和调用外部工具前先询问'],
  ['readonly', '只读', '只允许读取和搜索，拒绝所有修改和命令'],
];
export function ApprovalSwitch({
  mode,
  disabled,
  change,
}: {
  mode: ApprovalMode;
  disabled: boolean;
  change: (mode: ApprovalMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const Icon = mode === 'readonly' ? Eye : mode === 'confirm' ? ShieldCheck : Zap;
  return (
    <div className={'approval-switch ' + mode} ref={ref}>
      <button
        className="approval-pill"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="审批模式"
        title={approvalModes.find((m) => m[0] === mode)?.[2]}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={14} />
        <span>{approvalModes.find((m) => m[0] === mode)?.[1]}</span>
      </button>
      {open && (
        <div className="approval-menu" role="menu">
          {approvalModes.map(([id, label, hint]) => {
            const ItemIcon = id === 'readonly' ? Eye : id === 'confirm' ? ShieldCheck : Zap;
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={mode === id}
                onClick={() => {
                  setOpen(false);
                  if (id !== mode) change(id);
                }}
              >
                <ItemIcon size={15} />
                <span>
                  {label}
                  <small>{hint}</small>
                </span>
                {mode === id && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
export function ApprovalCard({
  dialog,
  first,
  respond,
}: {
  dialog: ExtensionDialog;
  first: boolean;
  respond: (value: string) => void;
}) {
  const a = dialog.approval!;
  const [reason, setReason] = useState<string | null>(null);
  const allow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (first && document.activeElement === document.body) allow.current?.focus({ preventScroll: false });
  }, [first]);
  const lines = a.detail?.split('\n') ?? [];
  return (
    <section className={'approval-card ' + a.kind} aria-label={`等待批准：${a.toolName}`}>
      <header>
        {a.kind === 'shell' ? <Terminal size={15} /> : <FileText size={15} />}
        <strong>
          {a.kind === 'shell'
            ? 'Pi 想执行命令'
            : a.kind === 'write'
              ? `Pi 想${a.toolName === 'edit' ? '修改' : '写入'}文件`
              : `Pi 想调用 ${a.toolName}`}
        </strong>
        {a.path && <code>{a.path}</code>}
      </header>
      {a.kind === 'shell' ? (
        <pre className="approval-command">{a.summary}</pre>
      ) : a.detail ? (
        <pre className="diff-lines approval-diff">
          {lines.map((l, i) => (
            <div
              key={i}
              className={
                l.startsWith('+') ? 'added' : l.startsWith('-') ? 'removed' : l.startsWith('@@') ? 'hunk' : ''
              }
            >
              {l || ' '}
            </div>
          ))}
        </pre>
      ) : (
        <pre className="approval-command">{a.summary}</pre>
      )}
      {reason === null ? (
        <div className="approval-actions">
          <button ref={allow} className="primary" onClick={() => respond(APPROVAL_ALLOW)}>
            <Check size={14} />
            允许
          </button>
          <button
            onClick={() => respond(APPROVAL_ALWAYS)}
            title={a.kind === 'shell' ? '仅对完全相同的命令生效' : `本会话内不再询问 ${a.toolName}`}
          >
            {a.kind === 'shell' ? '本会话总是允许此命令' : `本会话总是允许 ${a.toolName}`}
          </button>
          <button className="deny" onClick={() => setReason('')}>
            拒绝…
          </button>
        </div>
      ) : (
        <form
          className="approval-actions"
          onSubmit={(e) => {
            e.preventDefault();
            respond(reason.trim() ? `${APPROVAL_DENY}：${reason.trim()}` : APPROVAL_DENY);
          }}
        >
          <input
            className="input"
            autoFocus
            aria-label="拒绝原因"
            placeholder="告诉 Pi 为什么拒绝、应该怎么做（可选）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setReason(null))}
          />
          <button type="submit" className="deny">
            拒绝
          </button>
        </form>
      )}
    </section>
  );
}
