import { type Runtime, type Message } from '../../../shared/types';
import { useEffect, useRef, useState } from 'react';

export function ReplyMeta({ message }: { message: Message }) {
  const usage = message.usage as
    | { input?: number; output?: number; cacheRead?: number; totalTokens?: number; cost?: { total?: number } }
    | undefined;
  const model = String(message.responseModel ?? message.model ?? '');
  if (!usage?.totalTokens && !model) return null;
  const cost = usage?.cost?.total;
  return (
    <span
      className="reply-meta"
      title={[
        model && `模型：${message.provider ? message.provider + ' / ' : ''}${model}`,
        message.thinkingLevel && `推理：${String(message.thinkingLevel)}`,
        usage?.input !== undefined && `输入 ${usage.input.toLocaleString()} tokens`,
        usage?.cacheRead ? `缓存命中 ${usage.cacheRead.toLocaleString()}` : '',
        usage?.output !== undefined && `输出 ${usage.output.toLocaleString()} tokens`,
        cost ? `费用 $${cost.toFixed(4)}` : '',
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {model && <span>{model}</span>}
      {!!usage?.totalTokens && <span>{usage.totalTokens.toLocaleString()} tokens</span>}
      {!!cost && <span>${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}</span>}
    </span>
  );
}
export function ContextMeter({
  stats,
  open,
  compact,
  branch,
  disabled,
}: {
  stats: NonNullable<Runtime['stats']>;
  open: () => void;
  compact?: () => void;
  branch?: () => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) setExpanded(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, [expanded]);
  const percent = stats.contextPercent;
  const level = percent === undefined ? '' : percent >= 90 ? 'high' : percent >= 75 ? 'mid' : '';
  return (
    <span className="context-actions" ref={panel}>
      <button
        className={'context-meter ' + level}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        title={
          (percent !== undefined && stats.contextTokens && stats.contextWindow
            ? `上下文 ${stats.contextTokens.toLocaleString()} / ${stats.contextWindow.toLocaleString()} tokens\n`
            : '') +
          `累计 ${stats.tokens?.toLocaleString() ?? 0} tokens` +
          (stats.cost ? ` · $${stats.cost.toFixed(4)}` : '') +
          '\n点击查看会话与上下文'
        }
      >
        {percent !== undefined && (
          <>
            <span className="meter" aria-hidden="true">
              <i style={{ width: Math.min(100, percent) + '%' }} />
            </span>
            <span>上下文 {Math.round(percent)}%</span>
          </>
        )}
        <span>{(stats.tokens ?? 0).toLocaleString()} tokens</span>
        {!!stats.cost && <span>${stats.cost < 0.01 ? stats.cost.toFixed(4) : stats.cost.toFixed(2)}</span>}
      </button>
      {expanded && (
        <span className="context-popover">
          <strong>上下文 {percent === undefined ? '未知' : `${Math.round(percent)}%`}</strong>
          <span>累计 {(stats.tokens ?? 0).toLocaleString()} tokens</span>
          <button
            disabled={disabled || !compact}
            onClick={() => {
              setExpanded(false);
              compact?.();
            }}
          >
            立即压缩上下文
          </button>
          <button
            disabled={disabled || !branch}
            onClick={() => {
              setExpanded(false);
              branch?.();
            }}
          >
            从当前节点分支新会话
          </button>
          <button
            onClick={() => {
              setExpanded(false);
              open();
            }}
          >
            查看会话与本地用量
          </button>
        </span>
      )}
    </span>
  );
}
