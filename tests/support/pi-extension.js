import fs from 'node:fs';
import path from 'node:path';
export default function (pi) {
  pi.registerCommand('gui-pid', {
    description: 'Return the isolated test process identifier',
    handler: async (_args, ctx) => ctx.ui.notify('GUI_PID:' + process.pid, 'info'),
  });
  pi.on('session_before_switch', async (_event, ctx) => {
    if (fs.existsSync(path.join(process.env.PI_CODING_AGENT_DIR, 'switch-events')))
      ctx.ui.setEditorText('OUTGOING_DRAFT');
    if (fs.existsSync(path.join(process.env.PI_CODING_AGENT_DIR, 'slow-switch'))) {
      ctx.ui.notify('SWITCH_WAITING');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (fs.existsSync(path.join(process.env.PI_CODING_AGENT_DIR, 'confirm-switch')))
      if (!(await ctx.ui.confirm('切换确认', '允许切换到目标会话？'))) return { cancel: true };
    if (fs.existsSync(path.join(process.env.PI_CODING_AGENT_DIR, 'cancel-switch'))) return { cancel: true };
  });
  pi.on('session_start', (_event, ctx) => {
    if (fs.existsSync(path.join(process.env.PI_CODING_AGENT_DIR, 'switch-events')))
      ctx.ui.setWidget('target-widget', ['TARGET_WIDGET']);
  });
  for (const method of ['select', 'confirm', 'input', 'editor', 'timeout']) {
    pi.registerCommand('gui-' + method, {
      description: 'Desktop integration test',
      handler: async (_args, ctx) => {
        let answer;
        if (method === 'select') answer = await ctx.ui.select('测试选择', ['A', 'B']);
        if (method === 'confirm') answer = await ctx.ui.confirm('测试确认', '是否继续测试？');
        if (method === 'input') answer = await ctx.ui.input('测试输入', '输入内容');
        if (method === 'editor') answer = await ctx.ui.editor('测试编辑', '初始内容');
        if (method === 'timeout') answer = await ctx.ui.input('测试超时', '等待自动取消', { timeout: 180 });
        ctx.ui.notify('GUI_REPLY:' + method + ':' + String(answer), 'info');
      },
    });
  }
}
