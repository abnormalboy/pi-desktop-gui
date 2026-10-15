const api = window.desktop;
import type { FeatureModel } from './usePiFeatures';
export function McpTab({
  session,
  runtime,
  setNotice,
  document,
  setDocument,
  setDirty,
  serverName,
  setServerName,
  serverType,
  setServerType,
  serverTarget,
  setServerTarget,
  serverArgs,
  setServerArgs,
  disabled,
  run,
  addJson,
  configEditor,
}: Pick<
  FeatureModel,
  | 'session'
  | 'runtime'
  | 'setNotice'
  | 'document'
  | 'setDocument'
  | 'setDirty'
  | 'serverName'
  | 'setServerName'
  | 'serverType'
  | 'setServerType'
  | 'serverTarget'
  | 'setServerTarget'
  | 'serverArgs'
  | 'setServerArgs'
  | 'disabled'
  | 'run'
  | 'addJson'
  | 'configEditor'
>) {
  return (
    <>
      <div className="mcp-status">
        <strong>最近的连接状态</strong>
        {runtime.notices.slice(-5).map((n, i) => (
          <pre key={i}>{n}</pre>
        ))}
      </div>
      <div className="mcp-servers">
        {(() => {
          try {
            return Object.entries(JSON.parse(document?.text ?? '{}').mcpServers ?? {}).map(
              ([name, value]) => {
                const v = value as any;
                const change = (update: object) => {
                  const json = JSON.parse(document!.text);
                  json.mcpServers[name] = { ...v, ...update };
                  setDocument({ ...document!, text: JSON.stringify(json, null, 2) });
                  setDirty(true);
                };
                return (
                  <div className="mcp-server" key={name}>
                    <strong>{name}</strong>
                    <small>{v.url || v.command || '项目覆盖配置'}</small>
                    <label>
                      启用{' '}
                      <input
                        aria-label={'启用 MCP ' + name}
                        type="checkbox"
                        checked={v.enabled !== false}
                        disabled={disabled}
                        onChange={(e) => change({ enabled: e.target.checked })}
                      />
                    </label>
                    <label>
                      工具暴露{' '}
                      <select
                        aria-label={'MCP 工具暴露 ' + name}
                        disabled={disabled}
                        value={v.exposure ?? 'codemode'}
                        onChange={(e) => change({ exposure: e.target.value })}
                      >
                        <option value="codemode">代码模式</option>
                        <option value="direct">直接提供</option>
                        <option value="deferred">按需发现</option>
                        <option value="hidden">隐藏</option>
                      </select>
                    </label>
                  </div>
                );
              },
            );
          } catch {
            return null;
          }
        })()}
      </div>
      <h3>MCP 服务器</h3>
      <div className="button-row">
        <button
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              await api.invoke('send', session.id, '/mcp', [], 'steer');
            })
          }
        >
          查看连接状态
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              await api.invoke('reloadPi', session.id);
              setNotice('已重新加载 MCP');
            })
          }
        >
          重新连接
        </button>
      </div>
      <details>
        <summary>添加服务器</summary>
        <label className="field-label">服务器名称</label>
        <input
          className="input"
          aria-label="MCP 名称"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
        />
        <select
          className="input"
          aria-label="MCP 传输"
          value={serverType}
          onChange={(e) => setServerType(e.target.value)}
        >
          <option value="http">HTTP</option>
          <option value="stdio">本地 stdio</option>
        </select>
        <input
          className="input"
          aria-label="MCP 地址或程序"
          placeholder={serverType === 'http' ? 'https://example.com/mcp' : '程序路径，例如 npx'}
          value={serverTarget}
          onChange={(e) => setServerTarget(e.target.value)}
        />
        {serverType === 'stdio' && (
          <input
            className="input"
            aria-label="MCP 参数"
            placeholder='["-y", "包名"]'
            value={serverArgs}
            onChange={(e) => setServerArgs(e.target.value)}
          />
        )}
        <button
          disabled={disabled || !document}
          onClick={() =>
            void run(async () => {
              if (!/^[\w-]+$/.test(serverName) || !serverTarget) throw new Error('请输入名称和地址');
              const args = JSON.parse(serverArgs);
              if (!Array.isArray(args) || !args.every((v) => typeof v === 'string'))
                throw new Error('参数必须是字符串数组');
              addJson(
                'mcpServers',
                serverName,
                serverType === 'http'
                  ? { url: serverTarget, enabled: true }
                  : { command: serverTarget, args, enabled: true },
              );
            })
          }
        >
          添加到配置
        </button>
      </details>
      <p className="settings-copy">
        在配置中设置 enabled、exposure、toolExposure、env 和 headers。保存后自动应用。
      </p>
      {configEditor('mcp')}
      <label className="field-label">服务器名称（用于登录、退出或重连）</label>
      <input
        className="input"
        aria-label="操作 MCP 服务器"
        value={serverName}
        onChange={(e) => setServerName(e.target.value)}
      />
      <div className="button-row">
        {[
          ['login', '登录'],
          ['logout', '退出登录'],
          ['reconnect', '重新连接'],
        ].map(([cmd, label]) => (
          <button
            key={cmd}
            disabled={disabled || !/^[\w-]+$/.test(serverName)}
            onClick={() =>
              void run(async () => {
                await api.invoke('send', session.id, `/mcp ${cmd} ${serverName}`, [], 'steer');
                setNotice('MCP 操作已完成，请查看会话中的状态。');
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
