import { modKey, shortcut } from '../lib/platform';
import { Modal } from './Modal';

export const shortcutGroups: [string, [string[], string][]][] = [
  [
    '输入',
    [
      [['Enter'], '发送'],
      [['Shift', 'Enter'], '换行'],
      [['↑', '↓'], '输入框为空时翻看本会话发送过的提问'],
      [['/'], '命令菜单；Tab 补全'],
      [['@'], '引用项目文件；也可把文件拖进输入框'],
      [[modKey, 'V'], '粘贴图片'],
      [[modKey, 'G'], '在外部编辑器中编辑草稿'],
    ],
  ],
  [
    '运行',
    [
      [['Esc', 'Esc'], '执行中连按两次，停止全部并把队列恢复到草稿'],
      [['!命令'], '执行终端命令，输出加入上下文'],
      [['!!命令'], '执行终端命令，输出不进入上下文'],
    ],
  ],
  [
    '导航',
    [
      [[modKey, 'N'], '新建独立对话'],
      [[modKey, 'K'], '搜索会话标题与内容'],
      [[modKey, 'F'], '查找当前会话，Enter / Shift+Enter 切换匹配'],
      [[modKey, 'B'], '收起或展开侧栏'],
      [[modKey, 'J'], '收起或展开工作区面板'],
      [['Alt', '1 / 2 / 3'], '切换工作区变更、文件、输出'],
      [[modKey, ','], '打开设置'],
      [[modKey, '/'], '显示本页'],
      [['Esc'], '关闭弹窗或工作区面板'],
    ],
  ],
];
export function ShortcutsHelp({ close }: { close: () => void }) {
  return (
    <Modal title="键盘快捷键" subtitle={`${shortcut('/')} 随时打开`} close={close}>
      <div className="modal-body shortcut-help">
        {shortcutGroups.map(([group, rows]) => (
          <section key={group}>
            <h3>{group}</h3>
            {rows.map(([keys, label]) => (
              <div key={label}>
                <span>
                  {keys.map((k, i) => (
                    <kbd key={i}>{k}</kbd>
                  ))}
                </span>
                <p>{label}</p>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
