import { memo, useMemo, useRef } from 'react';
import { createTwoFilesPatch } from 'diff';
import { alignHunk, hunkPrompt, parseDiffHunks, type DiffCell, type DiffHunk } from '../../shared/diff';
import '../styles/diff-view.css';

export interface DiffViewProps {
  patch: string;
  path?: string;
  before?: string;
  after?: string;
  split?: boolean;
  full?: boolean;
  className?: string;
  onAskHunk?: (attachment: string | undefined, prompt: string) => void;
}

function Cell({ cell, side }: { cell?: DiffCell; side: 'left' | 'right' }) {
  return (
    <div className={`diff-row ${cell?.kind ?? 'placeholder'}`}>
      <span className="diff-number">{cell?.line ?? ''}</span>
      <code>
        {cell?.segments
          ? cell.segments.map((part, i) => (
              <span
                key={i}
                className={part.changed ? `diff-word-${side === 'left' ? 'del' : 'add'}` : undefined}
              >
                {part.text}
              </span>
            ))
          : cell?.text || ' '}
      </code>
    </div>
  );
}

export const DiffView = memo(function DiffView({
  patch,
  path,
  before,
  after,
  split = false,
  full = false,
  className = '',
  onAskHunk,
}: DiffViewProps) {
  const hunks = useMemo(
    () =>
      parseDiffHunks(
        full && before !== undefined && after !== undefined
          ? createTwoFilesPatch(path ?? '', path ?? '', before, after, '', '', {
              context: Number.MAX_SAFE_INTEGER,
            })
          : patch,
      ),
    [patch, path, before, after, full],
  );
  const aligned = useMemo(() => hunks.map((hunk) => ({ hunk, rows: alignHunk(hunk) })), [hunks]);
  const left = useRef<HTMLDivElement>(null),
    right = useRef<HTMLDivElement>(null);
  const header = (hunk: DiffHunk, key: number, allowAsk = true) => (
    <div className="diff-hunk" key={`h-${key}`}>
      <code>{hunk.header}</code>
      {allowAsk && path && onAskHunk && (
        <button
          onClick={() => {
            const prompt = hunkPrompt(path, hunk);
            onAskHunk(prompt.attachment, prompt.text);
          }}
        >
          追问此段
        </button>
      )}
    </div>
  );
  if (!hunks.length) return <pre className={`diff-view diff-raw ${className}`}>{patch}</pre>;
  if (split)
    return (
      <div className={`diff-view aligned-diff ${className}`}>
        {(['left', 'right'] as const).map((side) => (
          <div
            className="diff-pane"
            key={side}
            ref={side === 'left' ? left : right}
            onScroll={(event) => {
              const other = side === 'left' ? right.current : left.current;
              if (other && other.scrollTop !== event.currentTarget.scrollTop)
                other.scrollTop = event.currentTarget.scrollTop;
            }}
          >
            {aligned.map(({ hunk, rows }, i) => (
              <div key={i}>
                {header(hunk, i, side === 'right')}
                {rows.map((row, j) => (
                  <Cell key={j} cell={row[side]} side={side} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  return (
    <div className={`diff-view unified-diff ${className}`}>
      {aligned.map(({ hunk, rows }, i) => (
        <div key={i}>
          {header(hunk, i)}
          {rows.map((row, j) =>
            row.left?.kind === 'context' ? (
              <Cell key={j} cell={row.right} side="right" />
            ) : (
              <div key={j}>
                {row.left && <Cell cell={row.left} side="left" />}
                {row.right && <Cell cell={row.right} side="right" />}
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
});
