import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { SessionMatch } from '../../lib/session-search';
import { SearchHighlight } from './SearchHighlight';

export function ThinkingBlock({
  text,
  streaming,
  match,
}: {
  text: string;
  streaming: boolean;
  match?: SessionMatch;
}) {
  const output = useRef<HTMLPreElement>(null);
  const following = useRef(streaming && !match);
  const viewport = useRef({ width: 0, height: 0 });
  const [paused, setPaused] = useState(false);

  useLayoutEffect(() => {
    if (match) {
      following.current = false;
      setPaused(true);
    }
    if (following.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [text, match]);

  useEffect(() => {
    const element = output.current;
    if (!element) return;
    // Opening the details or changing the available width can reveal more lines.
    const observer = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight;
      viewport.current = { width: element.clientWidth, height: element.clientHeight };
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <details className="thinking" open={match ? true : undefined}>
      <summary>思考过程</summary>
      <pre
        ref={output}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (!element.clientHeight) return;
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
          const sameViewport =
            element.clientWidth === viewport.current.width &&
            element.clientHeight === viewport.current.height;
          if (atBottom || sameViewport) following.current = atBottom;
          setPaused(!following.current);
        }}
      >
        <SearchHighlight text={text} activeStart={match?.start} query={match?.query} />
      </pre>
      {streaming && paused && !match && (
        <button
          className="thinking-latest"
          title="滚到底部并继续跟随思考输出"
          onClick={() => {
            following.current = true;
            if (output.current) output.current.scrollTop = output.current.scrollHeight;
            setPaused(false);
          }}
        >
          <ArrowDown size={12} />
          最新思考
        </button>
      )}
    </details>
  );
}
