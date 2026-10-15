import { memo, useMemo } from 'react';
import { parseAnsi } from '../lib/ansi';
export const AnsiOutput = memo(function AnsiOutput({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const parts = useMemo(() => parseAnsi(text), [text]);
  return (
    <pre className={'ansi-output ' + className}>
      {parts.map((part, i) => (
        <span
          key={i}
          className={[part.color && 'ansi-' + part.color, part.bold && 'ansi-bold'].filter(Boolean).join(' ')}
        >
          {part.text}
        </span>
      ))}
    </pre>
  );
});
