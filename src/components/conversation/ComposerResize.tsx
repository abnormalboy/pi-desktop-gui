import { useRef, type Dispatch, type SetStateAction } from 'react';
export function ComposerResize({
  maximum,
  change,
}: {
  maximum: number;
  change: Dispatch<SetStateAction<number>>;
}) {
  const drag = useRef<{ y: number; max: number } | null>(null);
  return (
    <div
      className="composer-resize"
      role="separator"
      aria-label="调整输入框高度"
      aria-orientation="horizontal"
      tabIndex={0}
      aria-valuemin={20}
      aria-valuemax={55}
      aria-valuenow={Math.round(maximum)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          change((value) => Math.max(20, Math.min(55, value + (event.key === 'ArrowUp' ? 5 : -5))));
        }
      }}
      onPointerDown={(event) => {
        drag.current = { y: event.clientY, max: maximum };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          change(
            Math.max(
              20,
              Math.min(55, drag.current.max + ((drag.current.y - event.clientY) / window.innerHeight) * 100),
            ),
          );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}
