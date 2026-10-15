import { useEffect, useState } from 'react';
import type { AppDialog } from '../../shared/types';
import { Modal } from './Modal';

/** Main-process requests stay pending until explicitly answered; dismissal always cancels. */
export function AppDialogs() {
  const [queue, setQueue] = useState<AppDialog[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const unsubscribe = window.desktop.onEvent((event) => {
      if (event.type === 'appDialog') setQueue((items) => [...items, event.dialog]);
    });
    // Subscribe before the handshake so main never sends a confirmation into a loading renderer.
    void window.desktop.invoke('appDialogsReady').catch(() => {});
    return unsubscribe;
  }, []);
  const dialog = queue[0];
  if (!dialog) return null;
  const respond = async (response: number) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await window.desktop.invoke('respondAppDialog', dialog.id, response);
      setQueue((items) => items.filter((item) => item.id !== dialog.id));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <div data-app-dialog="true">
      <Modal key={dialog.id} title={dialog.message} close={() => void respond(dialog.cancelId)}>
        <div className="modal-body">
          {dialog.detail && <p style={{ whiteSpace: 'pre-wrap' }}>{dialog.detail}</p>}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          {dialog.buttons.map((label, index) => (
            <button
              key={index}
              disabled={pending}
              className={index === dialog.cancelId ? '' : 'primary'}
              onClick={() => void respond(index)}
            >
              {label}
            </button>
          ))}
        </footer>
      </Modal>
    </div>
  );
}
