import type { Change } from './types';

export interface CheckpointSummary {
  id: string;
  sessionId: string;
  turn: number;
  timestamp?: number;
  time: number;
  available: boolean;
  invalidReason?: string;
  includesCommitted: boolean;
}

export interface CheckpointPreview extends CheckpointSummary {
  files: (Change & { manual: boolean; selected: boolean })[];
  omitted: string[];
  revision: string;
}

export interface CheckpointContext {
  sessionId: string;
  checkpointId?: string;
  revision?: string;
}
