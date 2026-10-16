import { useEffect, useRef, type RefObject } from 'react';

export function useFocusScope(
  ref: RefObject<HTMLDivElement | HTMLElement | null>,
  active: boolean,
  close: () => void,
) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active || !ref.current) return;
    const old = document.activeElement as HTMLElement;
    const selector =
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary';
    (
      ref.current.querySelector<HTMLElement>('[data-autofocus]') ??
      ref.current.querySelector<HTMLElement>(selector)
    )?.focus();
    const key = (e: KeyboardEvent) => {
      if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== ref.current) return;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const items = [...ref.current!.querySelectorAll<HTMLElement>(selector)].filter(
          (e) => e.getClientRects().length,
        );
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && (i < 0 || i === items.length - 1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (old?.isConnected) old.focus();
    };
  }, [active, ref]);
}
