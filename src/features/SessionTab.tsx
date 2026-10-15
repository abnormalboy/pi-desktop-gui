import { Copy, Download, Share2, Terminal, FolderOpen } from 'lucide-react';
const api = window.desktop;
import type { FeatureModel } from './usePiFeatures';
export function SessionTab({
  session,
  runtime,
  close,
  setNotice,
  instructions,
  setInstructions,
  disabled,
  run,
  exportFile,
}: Pick<
  FeatureModel,
  | 'session'
  | 'runtime'
  | 'close'
  | 'setNotice'
  | 'instructions'
  | 'setInstructions'
  | 'disabled'
  | 'run'
  | 'exportFile'
>) {
  return (
    <>
      <h3>当前会话</h3>
      <p>{session.title}</p>
      <p className="settings-copy">{runtime.cwd || session.cwd || '连接后显示工作目录'}</p>
      <div className="button-row">
        <button
          onClick={() =>
            void run(async () => {
              await api.invoke('revealSessionDirectory', session.id);
            })
          }
        >
          <FolderOpen size={14} />
          打开工作目录
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              await api.invoke('branchSession', session.id, 'clone');
              close();
            })
          }
        >
          <Copy size={14} />
          克隆会话
        </button>
      </div>
      <div className="feature-stats">
        <span>
          累计用量 <strong>{runtime.stats?.tokens?.toLocaleString() ?? '—'} tokens</strong>
        </span>
        <span>
          累计费用 <strong>${runtime.stats?.cost?.toFixed(4) ?? '—'}</strong>
        </span>
        <span>
          上下文占用 <strong>{runtime.stats?.contextPercent?.toFixed(1) ?? '—'}%</strong>
        </span>
      </div>
      <h3>上下文与队列</h3>
      {[
        ['autoCompaction', '自动压缩上下文'],
        ['autoRetry', '临时错误自动重试'],
      ].map(([key, label]) => (
        <label className="option-row" key={key}>
          <span>{label}</span>
          <input
            type="checkbox"
            aria-label={label}
            checked={Boolean(runtime[key as 'autoCompaction'])}
            disabled={disabled}
            onChange={(e) =>
              void run(async () => {
                await api.invoke('piOption', session.id, key as 'autoCompaction', e.target.checked);
              })
            }
          />
        </label>
      ))}
      {[
        ['steeringMode', '补充指令发送方式'],
        ['followUpMode', '后续消息发送方式'],
      ].map(([key, label]) => (
        <label className="option-row" key={key}>
          {label}
          <select
            aria-label={label}
            disabled={disabled}
            value={runtime[key as 'steeringMode'] || 'one-at-a-time'}
            onChange={(e) =>
              void run(async () => {
                await api.invoke('piOption', session.id, key as 'steeringMode', e.target.value);
              })
            }
          >
            <option value="one-at-a-time">逐条发送</option>
            <option value="all">一起发送</option>
          </select>
        </label>
      ))}
      <label className="field-label">压缩要求（可选）</label>
      <textarea
        className="input"
        aria-label="压缩要求"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="例如：保留文件修改和待办事项"
      />
      <button
        disabled={disabled}
        onClick={() =>
          void run(async () => {
            const result = await api.invoke('compact', session.id, instructions);
            setNotice(`压缩完成，原上下文 ${result.tokensBefore} tokens。\n${result.summary}`);
          })
        }
      >
        立即压缩
      </button>
      <h3>导出与分享</h3>
      <div className="button-row">
        <button disabled={disabled} onClick={() => void exportFile('html')}>
          <Download size={14} />
          导出 HTML
        </button>
        <button disabled={disabled} onClick={() => void exportFile('jsonl')}>
          导出 JSONL
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              const url = await api.invoke('shareSession', session.id);
              if (url) setNotice('分享链接已复制：' + url);
            })
          }
        >
          <Share2 size={14} />
          分享会话
        </button>
      </div>
      <p className="settings-copy">分享会生成 GitHub Gist 链接；上传前会再次确认。建议先导出检查完整内容。</p>
      <h3>Pi 原生终端</h3>
      <p className="settings-copy">
        依赖终端自定义界面的扩展、终端主题和渲染设置，可在同一会话的原生终端使用。关闭终端后回到桌面重新连接。
      </p>
      <button
        disabled={disabled}
        onClick={() =>
          void run(async () => {
            await api.invoke('openPiTerminal', session.id);
            close();
          })
        }
      >
        <Terminal size={14} />在 Pi 终端继续
      </button>
    </>
  );
}
