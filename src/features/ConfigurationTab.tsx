import type { FeatureModel } from './usePiFeatures';
export function ConfigurationTab({ configEditor }: Pick<FeatureModel, 'configEditor'>) {
  return (
    <>
      <h3>完整 Pi 配置</h3>
      <p className="settings-copy">
        可编辑 Pi settings.json 的全部选项，包括
        defaultTools、enabledModels、模型默认值、压缩阈值、重试策略、资源路径和 shellPath。终端显示设置在原生
        Pi 终端生效。
      </p>
      {configEditor('settings')}
    </>
  );
}
