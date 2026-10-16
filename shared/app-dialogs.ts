export interface AppDialog {
  id: string;
  message: string;
  detail?: string;
  buttons: string[];
  cancelId: number;
}
export type AppMenuId = 'file' | 'edit' | 'view';
