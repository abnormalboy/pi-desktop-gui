import type { Store } from './store';
import type { Workspace } from './workspace';

export interface WorkspaceRequest {
  phase: 'turn' | 'tool-start' | 'tool-end';
  timestamp?: number;
  toolId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
}

/** The Pi extension awaits each request before continuing the user turn or tool. */
export class CheckpointRecorder {
  private prepared?: { sessionId: string; checkpointId: string };
  constructor(
    private store: Store,
    private workspace: Workspace,
  ) {}
  reset() {
    this.prepared = undefined;
  }
  async finish(sessionId: string) {
    const session = this.store.session(sessionId);
    if (session.projectId)
      await this.workspace.endSessionTools(this.store.project(session.projectId), sessionId);
  }
  async prepare(sessionId: string) {
    this.reset();
    const session = this.store.session(sessionId);
    if (!session.projectId) return;
    const turn = await this.workspace.nextCheckpointTurn(sessionId);
    const checkpoint = await this.workspace.captureCheckpoint(
      this.store.project(session.projectId),
      sessionId,
      turn,
    );
    if (checkpoint) this.prepared = { sessionId, checkpointId: checkpoint.id };
  }
  async handle(sessionId: string, request: WorkspaceRequest) {
    this.store.assertWritable();
    const session = this.store.session(sessionId);
    if (!session.projectId) return;
    const project = this.store.project(session.projectId);
    if (!project.trusted) throw new Error('请先确认此项目可以由 Pi 读取、修改和执行命令');
    if (request.phase === 'turn') {
      if (!Number.isSafeInteger(request.timestamp) || request.timestamp! < 0)
        throw new Error('Pi 用户消息缺少有效时间戳，无法建立检查点');
      if (this.prepared?.sessionId !== sessionId) await this.prepare(sessionId);
      const checkpoint = this.prepared;
      this.reset();
      if (checkpoint)
        await this.workspace.bindCheckpoint(project, sessionId, checkpoint.checkpointId, request.timestamp!);
      return;
    }
    if (typeof request.toolId !== 'string' || request.toolId.length > 200) throw new Error('Pi 工具标识无效');
    if (request.phase === 'tool-start') {
      if (typeof request.toolName !== 'string' || request.toolName.length > 100)
        throw new Error('Pi 工具名称无效');
      await this.workspace.beginTool(
        project,
        sessionId,
        request.toolId,
        request.toolName,
        request.args ?? {},
      );
    } else if (request.phase === 'tool-end') {
      await this.workspace.endTool(project, sessionId, request.toolId);
    } else throw new Error('无法识别 Pi 的检查点请求');
  }
}
