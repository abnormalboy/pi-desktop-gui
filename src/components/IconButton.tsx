import { type ReactNode } from 'react';

export function IconButton({
  title,
  onClick,
  children,
  disabled = false,
  className = '',
  expanded,
  controls,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      className={'icon-button ' + className}
      title={title}
      aria-label={title}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
