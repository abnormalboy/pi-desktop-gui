import { randomUUID } from 'node:crypto';
import type { AppDialog } from '../shared/types';

export interface DialogOptions {
  message: string;
  detail?: string;
  buttons?: string[];
  cancelId?: number;
  defaultId?: number;
  type?: string;
}

/** Keeps confirmation authority in the main process and fails closed on renderer loss. */
export class AppDialogRequests {
  private pending = new Map<
    string,
    {
      resolve: (value: { response: number }) => void;
      cancelId: number;
      count: number;
    }
  >();

  constructor(private publish: (dialog: AppDialog) => void) {}

  show(options: DialogOptions) {
    const id = randomUUID();
    const buttons = options.buttons ?? ['确定'];
    const cancelId = options.cancelId ?? 0;
    return new Promise<{ response: number }>((resolve) => {
      this.pending.set(id, { resolve, cancelId, count: buttons.length });
      this.publish({ id, message: options.message, detail: options.detail, buttons, cancelId });
    });
  }

  respond(id: string, response: number) {
    const pending = this.pending.get(id);
    if (!pending) return;
    if (!Number.isInteger(response) || response < 0 || response >= pending.count)
      throw new Error('无效对话框回复');
    this.pending.delete(id);
    pending.resolve({ response });
  }

  cancelAll() {
    for (const pending of this.pending.values()) pending.resolve({ response: pending.cancelId });
    this.pending.clear();
  }
}
