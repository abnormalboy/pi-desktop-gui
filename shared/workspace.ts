export interface AgentRulesFile {
  relativePath: string;
  size: number;
}

export interface WorkspaceChangedEvent {
  type: 'workspaceChanged';
  projectId: string;
  changedPaths?: string[];
}
