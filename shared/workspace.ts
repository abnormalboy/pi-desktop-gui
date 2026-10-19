export interface AgentRulesFile {
  relativePath: string;
  size: number;
}

export interface WorkspaceChangedEvent {
  type: 'workspaceChanged';
  projectId: string;
  changedPaths?: string[];
}
import { busy, type AppState, type Project } from './types';

export function directoryTaskReason(state: AppState, project: Project, insensitive: boolean) {
  const key = (value: string) => {
    const normalized = value.replaceAll('\\', '/').replace(/\/$/, '');
    return insensitive ? normalized.toLowerCase() : normalized;
  };
  const root = key(project.path);
  const session = state.sessions.find((candidate) => {
    if (!busy(candidate.lastStatus)) return false;
    const cwd = candidate.projectId
      ? state.projects.find((item) => item.id === candidate.projectId)?.path
      : candidate.cwd;
    if (!cwd) return false;
    const other = key(cwd);
    return root === other || root.startsWith(other + '/') || other.startsWith(root + '/');
  });
  return session ? `会话“${session.title}”正在使用此目录，请停止相关任务后执行` : '';
}
