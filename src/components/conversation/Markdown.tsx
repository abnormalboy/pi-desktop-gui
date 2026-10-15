import { memo, useRef, useState, type ReactNode } from 'react';
import { FileText, Copy } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type Message } from '../../../shared/types';
const api = window.desktop;

export function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <button
        className="code-copy"
        aria-label="复制代码"
        onClick={() => void api.invoke('copy', ref.current?.innerText ?? '')}
      >
        <Copy size={13} />
        复制
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
export const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <button className="inline-link" onClick={() => href && void api.invoke('openLink', href).catch(() => {})}>
      {children}
    </button>
  ),
  pre: ({ children }: { children?: ReactNode }) => <CodeBlock>{children}</CodeBlock>,
  img: ({ src, alt }: { src?: string; alt?: string }) => <MarkdownImage src={src} alt={alt} />,
};
export const remarkPlugins = [remarkGfm];
export const RichText = memo(function RichText({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={remarkPlugins} skipHtml components={markdownComponents}>
      {text}
    </Markdown>
  );
});
export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  if (src && /^data:image\/(png|jpeg|gif|webp);base64,/.test(src))
    return <img className="message-image" src={src} alt={alt || '图片'} />;
  if (src && /^https?:\/\//.test(src))
    return loaded ? (
      <img className="message-image" src={src} alt={alt || '图片'} />
    ) : (
      <button onClick={() => setLoaded(true)}>加载图片：{alt || src}</button>
    );
  return <span className="muted">[图片：{alt || '附件'}]</span>;
}
export function MessageImages({ message }: { message: Message }) {
  const images =
    typeof message.content === 'string'
      ? []
      : message.content.filter(
          (b) =>
            b.type === 'image' &&
            typeof b.data === 'string' &&
            ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(b.mimeType)),
        );
  if (!images.length) return null;
  return (
    <div className="message-images">
      {images.map((b, i) => (
        <button
          key={i}
          className="image-preview"
          onClick={(e) => e.currentTarget.classList.toggle('expanded-image')}
        >
          <img
            className="message-image"
            src={`data:${b.mimeType};base64,${b.data}`}
            alt={`附件图片 ${i + 1}`}
          />
        </button>
      ))}
    </div>
  );
}
export function UserMessage({ text }: { text: string }) {
  const start = text.indexOf('\n\n<project_file path=');
  if (start < 0) return <RichText text={text} />;
  const blocks = [
    ...text
      .slice(start)
      .matchAll(/\n\n<project_file path=("(?:[^"\\]|\\.)*")>\n([\s\S]*?)\n<\/project_file>/g),
  ];
  if (!blocks.length || blocks.map((b) => b[0]).join('') !== text.slice(start))
    return <RichText text={text} />;
  try {
    return (
      <>
        <RichText text={text.slice(0, start)} />
        {blocks.map((b, i) => (
          <details className="message-attachment" key={i}>
            <summary>
              <FileText size={13} />
              {JSON.parse(b[1])}
              <span>查看引用内容</span>
            </summary>
            <pre>{b[2]}</pre>
          </details>
        ))}
      </>
    );
  } catch {
    return <RichText text={text} />;
  }
}
