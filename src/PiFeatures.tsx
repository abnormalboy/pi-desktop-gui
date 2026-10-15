import type { Session, Runtime } from '../shared/types';
import { Modal } from './components/Modal';
import { usePiFeatures } from './features/usePiFeatures';
import { SessionTab } from './features/SessionTab';
import { TreeTab } from './features/TreeTab';
import { ResourcesTab } from './features/ResourcesTab';
import { McpTab } from './features/McpTab';
import { ProvidersTab } from './features/ProvidersTab';
import { PreferencesTab } from './features/PreferencesTab';
import { ConfigurationTab } from './features/ConfigurationTab';
import { HelpTab } from './features/HelpTab';
export function PiFeatures({
  session,
  runtime,
  initialTab,
  close,
}: {
  session: Session;
  runtime: Runtime;
  initialTab: string;
  close: () => void;
}) {
  const model = usePiFeatures({ session, runtime, initialTab, close });
  const { tab, setTab, pending, error, notice, setLocal, setKind, setDocument, dirty } = model;
  return (
    <Modal wide title="Pi 功能" subtitle="会话、工具与个人配置" close={close}>
      <div className="settings-layout feature-layout">
        <nav>
          {[
            ['session', '会话与上下文'],
            ['tree', '会话树与分支'],
            ['resources', 'Skills 与扩展'],
            ['mcp', 'MCP 服务器'],
            ['providers', '供应商与登录'],
            ['prefs', '常用设置'],
            ['settings', '完整 Pi 设置'],
            ['help', '命令与快捷键'],
          ].map(([id, title]) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              disabled={dirty || pending}
              onClick={() => {
                setLocal(false);
                setDocument(undefined);
                setKind(id === 'mcp' ? 'mcp' : id === 'providers' ? 'models' : 'settings');
                setTab(id);
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="settings-content feature-content">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <p className="feature-notice" role="status">
              {notice}
            </p>
          )}
          {tab === 'session' && <SessionTab {...model} />}
          {tab === 'tree' && <TreeTab {...model} />}
          {tab === 'resources' && <ResourcesTab {...model} />}
          {tab === 'providers' && <ProvidersTab {...model} />}
          {tab === 'mcp' && <McpTab {...model} />}
          {tab === 'prefs' && <PreferencesTab {...model} />}
          {tab === 'settings' && <ConfigurationTab {...model} />}
          {tab === 'help' && <HelpTab {...model} />}
        </div>
      </div>
      <footer>
        <span className="settings-footer-note">
          {pending ? '正在处理…' : dirty ? '有尚未保存的配置' : '配置保存在本机'}
        </span>
        <button onClick={close}>关闭</button>
      </footer>
    </Modal>
  );
}
