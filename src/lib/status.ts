export const statusNames: Record<string, string> = {
  idle: '就绪',
  starting: '启动中',
  running: '执行中',
  waiting: '等待你的回复',
  retrying: '正在重试',
  compacting: '整理上下文',
  stopping: '停止中',
  completed: '本轮已结束',
  stopped: '已停止',
  error: '执行失败',
  interrupted: '已中断',
};
