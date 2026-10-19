import { AlertCircle, LoaderCircle } from 'lucide-react';
import { busy } from '../../shared/types';
import { statusNames } from '../lib/status';

export function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={'status ' + status}>
      {busy(status) ? (
        <LoaderCircle className={status === 'waiting' ? '' : 'spin'} size={13} />
      ) : status === 'error' || status === 'interrupted' ? (
        <AlertCircle size={13} />
      ) : (
        <span className="status-dot" />
      )}
      {label || statusNames[status] || status}
    </span>
  );
}
