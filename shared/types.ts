export type RunStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'retrying'
  | 'compacting'
  | 'stopping'
  | 'completed'
  | 'stopped'
  | 'error'
  | 'interrupted';
export type SendMode = 'steer' | 'followUp';
export interface Project {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  createdAt: number;
}
export interface Session {
  id: string;
  projectId?: string;
  title: string;
  file?: string;
  draft: string;
  attachments: string[];
  updatedAt: number;
  lastStatus: RunStatus;
  scrollTop?: number;
  expandedTools?: string[];
  unread?: boolean;
}
export interface Settings {
  piPath: string;
  nodePath: string;
  agentDir: string;
  editorPath: string;
  provider: string;
  modelId: string;
  thinking: string;
  theme: 'light' | 'dark' | 'system';
  fontScale: number;
  sidebarWidth: number;
  inspectorWidth: number;
  onboardingDone: boolean;
}
export interface AppState {
  version: 1;
  projects: Project[];
  sessions: Session[];
  settings: Settings;
  selectedProjectId?: string;
  selectedSessionId?: string;
}
export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface Message {
  role: string;
  content: string | ContentBlock[];
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
  [key: string]: unknown;
}
export interface ToolActivity {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  output: string;
  startedAt: number;
  durationMs?: number;
}
export interface ExtensionDialog {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  expiresAt?: number;
}
export interface Model {
  id: string;
  provider: string;
  name: string;
  reasoning?: boolean;
  contextWindow?: number;
}
export interface Runtime {
  sessionId?: string;
  status: RunStatus;
  messages: Message[];
  tools: ToolActivity[];
  steering: string[];
  followUp: string[];
  dialogs: ExtensionDialog[];
  notices: string[];
  widgets: Record<string, string[]>;
  statuses: Record<string, string>;
  models: Model[];
  thinkingLevels: string[];
  model?: Model;
  thinking?: string;
  error?: string;
  startedAt?: number;
  connected: boolean;
  stats?: { tokens?: number; cost?: number; contextPercent?: number };
  diagnostic: string[];
  stopStartedAt?: number;
}
export interface Environment {
  piPath: string;
  version?: string;
  supported: boolean;
  nodePath?: string;
  git?: string;
  bash?: string;
  agentDir: string;
  authExists: boolean;
  modelsExist: boolean;
  errors: string[];
}
export interface FileItem {
  path: string;
  name: string;
  directory: boolean;
  size?: number;
}
export interface FilePreview {
  path: string;
  text: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}
export interface Change {
  path: string;
  oldPath?: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  existedBeforeRun: boolean;
}
export interface Changes {
  git: boolean;
  branch?: string;
  head?: string;
  files: Change[];
  baselineAvailable: boolean;
  baselineInvalid?: boolean;
  omitted: string[];
  error?: string;
}
export interface FileDiff {
  path: string;
  patch: string;
  before: string;
  after: string;
  unavailable?: string;
}
export type AppEvent = { type: 'state'; state: AppState } | { type: 'runtime'; runtime: Runtime };
export interface Bootstrap {
  state: AppState;
  runtime: Runtime;
  environment: Environment;
  dataDir: string;
}
export interface ApiMap {
  bootstrap: { args: []; result: Bootstrap };
  addProject: { args: []; result: Project | null };
  renameProject: { args: [string, string]; result: void };
  removeProject: { args: [string]; result: void };
  trustProject: { args: [string]; result: void };
  newSession: { args: [projectId?: string]; result: Session };
  importSession: { args: [string]; result: Session | null };
  selectSession: { args: [string]; result: Message[] };
  renameSession: { args: [string, string]; result: void };
  saveDraft: { args: [string, string, string[]]; result: void };
  saveView: { args: [string, number, string[]]; result: void };
  readHistory: { args: [string]; result: Message[] };
  detect: { args: []; result: Environment };
  choosePath: { args: ['pi' | 'node' | 'agent' | 'editor']; result: string | null };
  saveSettings: { args: [Partial<Settings>]; result: void };
  connect: { args: [string]; result: void };
  testConnection: { args: [string]; result: { elapsed: number; text: string } };
  send: { args: [string, string, string[], SendMode]; result: void };
  stop: { args: []; result: void };
  clearQueue: { args: []; result: void };
  forceStop: { args: []; result: boolean };
  respond: { args: [string, { value?: string; confirmed?: boolean; cancelled?: boolean }]; result: void };
  files: { args: [string, string]; result: FileItem[] };
  searchFiles: { args: [string, string]; result: string[] };
  preview: { args: [string, string]; result: FilePreview };
  changes: { args: [string, ('all' | 'run')?]; result: Changes };
  diff: { args: [string, string, 'all' | 'run']; result: FileDiff };
  openFile: { args: [string, string]; result: void };
  openLink: { args: [string]; result: void };
  copy: { args: [string]; result: void };
  exportOutput: { args: []; result: string | null };
  diagnostics: { args: []; result: string };
  exportDiagnostics: { args: []; result: string | null };
  revealData: { args: []; result: void };
}
export interface DesktopApi {
  invoke<K extends keyof ApiMap>(method: K, ...args: ApiMap[K]['args']): Promise<ApiMap[K]['result']>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}
export const busy = (status: string) =>
  ['starting', 'running', 'waiting', 'retrying', 'compacting', 'stopping'].includes(status);
export const emptyRuntime = (): Runtime => ({
  status: 'idle',
  messages: [],
  tools: [],
  steering: [],
  followUp: [],
  dialogs: [],
  notices: [],
  widgets: {},
  statuses: {},
  models: [],
  thinkingLevels: [],
  connected: false,
  diagnostic: [],
});
export function messageText(message: Pick<Message, 'content'>): string {
  return typeof message.content === 'string'
    ? message.content
    : (message.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n');
}
