import { shortcut } from '../lib/platform';
import { builtinCommands } from '../lib/commands';
import type { FeatureModel } from './usePiFeatures';
export function HelpTab({ runtime, source }: Pick<FeatureModel, 'runtime' | 'source'>) {
  return (
    <>
      <h3>当前支持情况</h3>
      <p className="settings-copy">
        常用设置、完整 Pi 配置、供应商与 MCP 配置已支持编辑和保存。会话操作、登录和资源管理需要可用的 Pi
        运行环境；运行中的任务结束后可操作。
      </p>
      <p className="settings-copy">
        终端主题、终端渲染选项和扩展自定义终端界面尚未在桌面实现。可在“会话与上下文 → 在 Pi
        终端继续”中使用；Pi 的终端主题不会更改桌面外观。
      </p>
      <h3>快捷键</h3>
      <p>
        Enter 发送 · Shift+Enter 换行 · ↑↓ 翻看发送过的提问 · Esc 连按两次停止 · {shortcut('N')} 新建独立对话
        ·{shortcut('K')} 搜索历史 · {shortcut(',')} 设置 · {shortcut('G')} 外部编辑器 · {shortcut('/')}{' '}
        全部快捷键 · / 命令菜单 · @ 项目文件（也可拖入）
      </p>
      <p>
        <code>!命令</code> 执行并将输出加入上下文；<code>!!命令</code> 执行并保留记录，输出不进入模型上下文。
      </p>
      <h3>桌面命令</h3>
      {builtinCommands.map((c) => (
        <p key={c.name}>
          <code>/{c.name}</code> {c.description}
        </p>
      ))}
      <h3>已加载的 Pi 命令</h3>
      {!runtime.connected && (
        <p className="settings-copy">连接 Pi 后显示当前会话加载的命令；上方桌面命令无需连接即可查看。</p>
      )}
      {runtime.commands.map((c) => (
        <p key={c.name}>
          <code>/{c.name}</code> {c.description} <small>· {c.source}</small>
        </p>
      ))}
    </>
  );
}
