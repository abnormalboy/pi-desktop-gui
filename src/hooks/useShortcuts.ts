import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppState, Runtime, Session } from '../../shared/types';
import { mod } from '../lib/platform';
const api = window.desktop;
type Toggle = Dispatch<SetStateAction<boolean>>;
interface ShortcutsOptions {
  state: AppState | undefined;
  selected: Session | undefined;
  runtime: Runtime;
  compact: boolean;
  inspector: boolean;
  ownRunning: boolean;
  createSession: () => Promise<void>;
  openSettings: (tab?: string) => void;
  action: (fn: () => Promise<unknown>) => Promise<void>;
  attempt: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  setSearchOpen: Toggle;
  setSidebar: Toggle;
  setShortcutsOpen: Toggle;
  setInspector: Toggle;
  setTab: Dispatch<SetStateAction<'changes' | 'files' | 'output'>>;
}
export function useShortcuts({
  state,
  selected,
  runtime,
  compact,
  inspector,
  ownRunning,
  createSession,
  openSettings,
  action,
  attempt,
  setSearchOpen,
  setSidebar,
  setShortcutsOpen,
  setInspector,
  setTab,
}: ShortcutsOptions) {
  const [stopArmed, setStopArmed] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || document.querySelector('[data-app-dialog]')) return;
      if (mod(e) && e.key.toLowerCase() === 'f' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        if (compact && inspector) setInspector(false);
        window.dispatchEvent(new CustomEvent('pi:find'));
      }
      if (mod(e) && e.key.toLowerCase() === 'j' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        setInspector((value) => !value);
      }
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        ['1', '2', '3'].includes(e.key) &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        setTab(e.key === '1' ? 'changes' : e.key === '2' ? 'files' : 'output');
        setInspector(true);
      }
      if (
        mod(e) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'n' &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        if (!e.repeat) void createSession();
      }
      if (mod(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (mod(e) && e.key === ',') {
        e.preventDefault();
        openSettings();
      }
      if (mod(e) && e.key.toLowerCase() === 'g' && selected && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        void action(() => api.invoke('editDraft', selected.id));
      }
      if (mod(e) && e.key.toLowerCase() === 'b' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        setSidebar((v) => !v);
      }
      if (mod(e) && (e.key === '/' || e.code === 'Slash')) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [state, compact, inspector]);
  useEffect(() => {
    if (!stopArmed) return;
    const timer = setTimeout(() => setStopArmed(false), 2000);
    return () => clearTimeout(timer);
  }, [stopArmed]);
  useEffect(() => {
    if (!ownRunning) setStopArmed(false);
  }, [ownRunning]);
  useEffect(() => {
    if (!ownRunning || runtime.status === 'stopping') return;
    const key = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' ||
        e.repeat ||
        e.defaultPrevented ||
        e.isComposing ||
        document.querySelector('[role="dialog"], .context-menu') ||
        inspector
      )
        return;
      e.preventDefault();
      if (stopArmed) {
        setStopArmed(false);
        void attempt(() => api.invoke('stop'));
      } else setStopArmed(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ownRunning, runtime.status, stopArmed, inspector]);
  useEffect(() => {
    if (!inspector) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) {
        setInspector(false);
        document.querySelector<HTMLButtonElement>('.workspace-toggle')?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [inspector]);
  return stopArmed;
}
