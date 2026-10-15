const api = window.desktop;
import type { FeatureModel } from './usePiFeatures';
export function ProvidersTab({
  session,
  setNotice,
  filter,
  imageModel,
  setImageModel,
  reasoningModel,
  setReasoningModel,
  providers,
  provider,
  setProvider,
  providerQuery,
  setProviderQuery,
  document,
  providerId,
  setProviderId,
  baseUrl,
  setBaseUrl,
  apiType,
  setApiType,
  apiKey,
  setApiKey,
  modelIds,
  setModelIds,
  disabled,
  run,
  refresh,
  addJson,
  configEditor,
}: Pick<
  FeatureModel,
  | 'session'
  | 'setNotice'
  | 'filter'
  | 'imageModel'
  | 'setImageModel'
  | 'reasoningModel'
  | 'setReasoningModel'
  | 'providers'
  | 'provider'
  | 'setProvider'
  | 'providerQuery'
  | 'setProviderQuery'
  | 'document'
  | 'providerId'
  | 'setProviderId'
  | 'baseUrl'
  | 'setBaseUrl'
  | 'apiType'
  | 'setApiType'
  | 'apiKey'
  | 'setApiKey'
  | 'modelIds'
  | 'setModelIds'
  | 'disabled'
  | 'run'
  | 'refresh'
  | 'addJson'
  | 'configEditor'
>) {
  return (
    <>
      <h3>登录与凭据</h3>
      <input
        className="input"
        aria-label="筛选供应商"
        placeholder="筛选供应商"
        value={providerQuery}
        onChange={(e) => setProviderQuery(e.target.value)}
      />
      <select
        className="input"
        aria-label="登录供应商"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
      >
        <option value="">选择供应商</option>
        {providers
          .filter((p) => (p.name + p.id).toLowerCase().includes(providerQuery.toLowerCase()))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} {p.configured ? '· 已配置' : ''}
            </option>
          ))}
      </select>
      <div className="button-row">
        <button
          disabled={disabled || !providers.find((p) => p.id === provider)?.oauth}
          onClick={() =>
            void run(async () => {
              await api.invoke('login', session.id, provider, 'oauth');
              await refresh();
              setNotice('登录成功');
            })
          }
        >
          浏览器登录
        </button>
        <button
          disabled={disabled || !providers.find((p) => p.id === provider)?.apiKey}
          onClick={() =>
            void run(async () => {
              await api.invoke('login', session.id, provider, 'api_key');
              await refresh();
              setNotice('凭据已保存');
            })
          }
        >
          设置 API Key
        </button>
        <button
          disabled={disabled || !provider}
          onClick={() =>
            void run(async () => {
              await api.invoke('logout', session.id, provider);
              await refresh();
              setNotice('已移除登录凭据；环境变量和 models.json 中的配置仍独立生效。');
            })
          }
        >
          退出登录
        </button>
      </div>
      <details>
        <summary>添加自定义供应商</summary>
        <label className="field-label">供应商标识</label>
        <input
          className="input"
          aria-label="新供应商标识"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        />
        <label className="field-label">接口地址</label>
        <input
          className="input"
          aria-label="供应商接口地址"
          placeholder="https://example.com/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <label className="field-label">API 类型</label>
        <select
          className="input"
          aria-label="API 类型"
          value={apiType}
          onChange={(e) => setApiType(e.target.value)}
        >
          <option>openai-completions</option>
          <option>openai-responses</option>
          <option>anthropic-messages</option>
          <option>google-generative-ai</option>
        </select>
        <label className="field-label">API Key 或环境变量名</label>
        <input
          type="password"
          autoComplete="off"
          className="input"
          aria-label="新供应商密钥"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <label className="field-label">模型 ID（每行一个）</label>
        <textarea
          className="input"
          aria-label="新供应商模型"
          value={modelIds}
          onChange={(e) => setModelIds(e.target.value)}
        />
        <label className="option-row">
          这些模型支持图片
          <input type="checkbox" checked={imageModel} onChange={(e) => setImageModel(e.target.checked)} />
        </label>
        <label className="option-row">
          这些模型支持推理级别
          <input
            type="checkbox"
            checked={reasoningModel}
            onChange={(e) => setReasoningModel(e.target.checked)}
          />
        </label>
        <button
          disabled={disabled || !document}
          onClick={() =>
            void run(async () => {
              if (!/^https?:\/\//.test(baseUrl) || !modelIds.trim()) throw new Error('请填写接口地址和模型');
              addJson('providers', providerId, {
                baseUrl,
                api: apiType,
                ...(apiKey ? { apiKey } : {}),
                models: modelIds
                  .split(/\r?\n/)
                  .map((id) => id.trim())
                  .filter(Boolean)
                  .map((id) => ({
                    id,
                    input: imageModel ? ['text', 'image'] : ['text'],
                    reasoning: reasoningModel,
                    contextWindow: 128000,
                    maxTokens: 16384,
                  })),
              });
              setNotice('已加入下方配置，请核对模型能力与上下文大小后保存。');
            })
          }
        >
          添加到配置
        </button>
      </details>
      <h3>供应商配置</h3>
      {configEditor('models')}
    </>
  );
}
