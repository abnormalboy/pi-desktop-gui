import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Minus, Plus, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useFocusScope } from '../hooks/useFocusScope';
export interface LightboxImage {
  src: string;
  alt: string;
}
export function Lightbox({
  images,
  initialIndex = 0,
  close,
}: {
  images: LightboxImage[];
  initialIndex?: number;
  close: () => void;
}) {
  const [index, setIndex] = useState(initialIndex),
    [zoom, setZoom] = useState<number | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 }),
    [size, setSize] = useState({ width: 0, height: 0 });
  const [feedback, setFeedback] = useState('');
  const panel = useRef<HTMLDivElement>(null),
    picture = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  useFocusScope(panel, true, close);
  const move = (direction: number) =>
    setIndex((value) => (value + direction + images.length) % images.length);
  useEffect(() => {
    setZoom(null);
    setPosition({ x: 0, y: 0 });
    setFeedback('');
  }, [index]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [images.length]);
  const fit =
    size.width && size.height
      ? Math.min(1, (window.innerWidth - 64) / size.width, (window.innerHeight - 150) / size.height)
      : 1;
  const scale = zoom ?? fit;
  const adjustZoom = (value: number) => setZoom(Math.min(4, Math.max(0.5, value)));
  const copy = async () => {
    try {
      let src = images[index].src;
      if (!src.startsWith('data:')) {
        const canvas = document.createElement('canvas');
        canvas.width = picture.current!.naturalWidth;
        canvas.height = picture.current!.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法读取图片');
        context.drawImage(picture.current!, 0, 0);
        src = canvas.toDataURL('image/png');
      }
      await window.desktop.invoke('copyImage', src);
      setFeedback('图片已复制');
    } catch {
      setFeedback('无法复制这张图片，可能尚未加载完成，或来源网站不允许读取图片。');
    }
  };
  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片查看器"
      ref={panel}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="lightbox-toolbar">
        <span>
          {images[index]?.alt} · {index + 1} / {images.length}
        </span>
        <button title="缩小图片" onClick={() => adjustZoom(scale - 0.25)}>
          <Minus size={16} />
        </button>
        <button
          onClick={() => {
            setZoom(null);
            setPosition({ x: 0, y: 0 });
          }}
        >
          {zoom === null ? '适应窗口' : `${Math.round(scale * 100)}%`}
        </button>
        <button title="放大图片" onClick={() => adjustZoom(scale + 0.25)}>
          <Plus size={16} />
        </button>
        <button onClick={() => void copy()}>
          <Copy size={15} />
          复制图片
        </button>
        <button title="关闭图片查看器" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div
        className="lightbox-canvas"
        onWheel={(event) => adjustZoom(scale * (event.deltaY > 0 ? 0.9 : 1.1))}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <img
          ref={picture}
          src={images[index]?.src}
          alt={images[index]?.alt}
          draggable={false}
          onLoad={(event) =>
            setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
          }
          style={{
            width: size.width || undefined,
            height: size.height || undefined,
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          }}
          onDoubleClick={() => {
            setZoom(zoom === null ? 1 : null);
            setPosition({ x: 0, y: 0 });
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, originX: position.x, originY: position.y };
          }}
          onPointerMove={(event) => {
            if (drag.current)
              setPosition({
                x: drag.current.originX + event.clientX - drag.current.x,
                y: drag.current.originY + event.clientY - drag.current.y,
              });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      </div>
      {images.length > 1 && (
        <>
          <button className="lightbox-prev" title="上一张图片" onClick={() => move(-1)}>
            <ChevronLeft />
          </button>
          <button className="lightbox-next" title="下一张图片" onClick={() => move(1)}>
            <ChevronRight />
          </button>
        </>
      )}
      <div className="lightbox-help" role="status">
        {feedback || '滚轮缩放 · 拖动平移 · 双击切换原始大小 · Esc 关闭'}
      </div>
    </div>,
    document.body,
  );
}
