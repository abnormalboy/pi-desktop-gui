import { memo } from 'react';
import { GitBranch, LoaderCircle, Copy, Terminal, RefreshCw, Pencil } from 'lucide-react';
import { messageText, type Message, type ToolActivity, type MessageAction } from '../../../shared/types';
import { time } from '../../lib/format';
import { IconButton } from '../IconButton';
import { CodeBlock, RichText, MessageImages, UserMessage } from './Markdown';
import { ToolCard } from './ToolCard';
import { ReplyMeta } from './Usage';

export interface MessageContext {
  running: boolean;
  locked: boolean;
  expanded: string[];
  liveToolIds: Set<string>;
  toolFor: (m: Message) => ToolActivity;
  toggleTool: (id: string, open: boolean) => void;
  openFile: (path: string) => void;
  copy: (text: string) => void;
  act: (m: Message, kind: MessageAction) => void;
}
export const ChatMessage = memo(
  function ChatMessage({ m, last, ctx }: { m: Message; last: boolean; ctx: MessageContext }) {
    if (m.role === 'toolResult') {
      const tool = ctx.toolFor(m);
      return (
        <div>
          <ToolCard
            tool={tool}
            expanded={ctx.expanded.includes(tool.id)}
            onToggle={(v) => ctx.toggleTool(tool.id, v)}
            openFile={(p) => ctx.openFile(p)}
          />
          <MessageImages message={m} />
        </div>
      );
    }
    if (m.role === 'bashExecution')
      return (
        <article className="message bash-message">
          <strong>
            <Terminal size={14} /> {String(m.command ?? '')}
          </strong>
          <CodeBlock>{String(m.output ?? '')}</CodeBlock>
          <small>
            {m.excludeFromContext ? '输出不进入模型上下文' : '输出已加入模型上下文'} · 退出码{' '}
            {String(m.exitCode ?? '')}
          </small>
        </article>
      );
    if (m.role === 'custom' || m.role === 'branchSummary' || m.role === 'compactionSummary')
      return (
        <article className="message">
          <RichText text={messageText(m) || String(m.summary ?? '')} />
        </article>
      );
    if (m.role !== 'user' && m.role !== 'assistant') return null;
    const content = messageText(m);
    if (
      m.role === 'assistant' &&
      !content &&
      !m.errorMessage &&
      typeof m.content !== 'string' &&
      !m.content.some(
        (b) => (b.type === 'thinking' && b.thinking) || (ctx.running && typeof b.partialJson === 'string'),
      )
    )
      return null;
    return (
      <article className={'message ' + m.role}>
        <div className="message-heading">
          {m.role === 'assistant' && (
            <span className="avatar assistant" aria-hidden="true">
              π
            </span>
          )}
          <strong>{m.role === 'user' ? '你' : 'Pi'}</strong>
          {m.timestamp && <time>{time(m.timestamp)}</time>}
          {m.role === 'assistant' && <ReplyMeta message={m} />}
          <span className="message-actions">
            <IconButton title="复制消息" onClick={() => ctx.copy(content)}>
              <Copy size={13} />
            </IconButton>
            {m.role === 'user' && m.timestamp && (
              <>
                <IconButton title="编辑后重新发送" disabled={ctx.locked} onClick={() => ctx.act(m, 'edit')}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton
                  title="从这里分支到新会话"
                  disabled={ctx.locked}
                  onClick={() => ctx.act(m, 'fork')}
                >
                  <GitBranch size={13} />
                </IconButton>
              </>
            )}
            {m.role === 'assistant' && m.timestamp && last && (
              <IconButton
                title="重新生成这条回复"
                disabled={ctx.locked}
                onClick={() => ctx.act(m, 'regenerate')}
              >
                <RefreshCw size={13} />
              </IconButton>
            )}
          </span>
        </div>
        <div className="message-content">
          {typeof m.content !== 'string' &&
            m.content
              .filter((b) => b.type === 'thinking' && b.thinking)
              .map((b, index) => (
                <details className="thinking" key={index}>
                  <summary>思考过程</summary>
                  <pre>{b.thinking}</pre>
                </details>
              ))}
          {content ? (
            m.role === 'user' ? (
              <UserMessage text={content} />
            ) : (
              <RichText text={content} />
            )
          ) : m.role === 'assistant' && ctx.running ? (
            <span className="stream-cursor" />
          ) : null}
          {m.errorMessage && <p className="inline-error">{m.errorMessage}</p>}
          <MessageImages message={m} />
          {ctx.running &&
            typeof m.content !== 'string' &&
            m.content
              .filter(
                (b) =>
                  b.type === 'toolCall' &&
                  typeof b.partialJson === 'string' &&
                  !ctx.liveToolIds.has(String(b.id)),
              )
              .map((b) => (
                <div className="tool-drafting" key={String(b.id)}>
                  <LoaderCircle size={13} className="spin" />
                  <strong>正在准备 {String(b.name ?? '工具')}</strong>
                  <code>{String(b.partialJson).slice(-160) || '…'}</code>
                </div>
              ))}
        </div>
      </article>
    );
  },
  (a, b) =>
    a.m === b.m &&
    a.last === b.last &&
    a.ctx.running === b.ctx.running &&
    a.ctx.locked === b.ctx.locked &&
    (a.m.role !== 'toolResult' ||
      (a.ctx.expanded === b.ctx.expanded && a.ctx.toolFor(a.m) === b.ctx.toolFor(b.m))) &&
    (!b.ctx.running || a.ctx.liveToolIds === b.ctx.liveToolIds),
);
