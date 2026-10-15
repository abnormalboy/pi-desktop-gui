import {
  busy,
  type ConfigSaveResult,
  type Environment,
  type Runtime,
  type StorageStatus,
} from '../../shared/types';

export function piFeatureAvailability({
  runtime,
  pending,
  environment,
  storage,
  projectEnabled,
}: {
  runtime: Runtime;
  pending: boolean;
  environment?: Environment;
  storage: StorageStatus;
  projectEnabled: boolean;
}) {
  const operationReason = pending
    ? '正在处理上一项操作，请稍候。'
    : !storage.writable
      ? '本机数据目录当前只读。请关闭窗口，在工作区的存储提示中修复后重试。'
      : runtime.crash && runtime.crash.cleanup !== 'confirmed'
        ? '尚未确认 Pi 启动的命令已结束。请先处理工作区中的进程恢复提示。'
        : busy(runtime.status)
          ? runtime.status === 'waiting'
            ? 'Pi 正在等待确认或登录。请先完成弹出的确认，或关闭此窗口后停止任务。'
            : 'Pi 正在运行或连接。可先编辑配置，等待任务完成或停止后再保存和应用。'
          : '';
  const prerequisiteReason = !projectEnabled
    ? '当前项目尚未信任。请关闭此窗口，在工作区选择“信任并启用”后使用 Pi 功能。'
    : !environment?.supported
      ? '尚未检测到可用的 Pi。请到“设置 → 运行环境”检查 Pi 入口并重新检测。'
      : '';
  return { operationReason, prerequisiteReason, engineReason: operationReason || prerequisiteReason };
}

export function configSaveNotice(result: ConfigSaveResult) {
  return result.applied
    ? '已保存并重新连接 Pi。原配置已备份。'
    : `配置已保存，原配置已备份；尚未应用到 Pi。${result.warning ?? '请修复运行环境后重新连接。'}`;
}
