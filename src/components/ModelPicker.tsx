import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Check, LoaderCircle } from 'lucide-react';
import { type Runtime } from '../../shared/types';
import { contextLabel } from '../lib/format';
import { useFocusScope } from '../hooks/useFocusScope';

export function ModelPicker({
  runtime,
  fallback,
  locked,
  canConnect,
  connect,
  pick,
  setThinking,
  manage,
  open,
  setOpen,
}: {
  runtime: Runtime;
  fallback: string;
  locked: boolean;
  canConnect: boolean;
  connect: () => void;
  pick: (key: string) => void;
  setThinking: (level: string) => void;
  manage: (target: 'providers' | 'settings') => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useFocusScope(panel, open, close);
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(
        Math.max(
          0,
          runtime.models.findIndex(
            (model) => model.provider === runtime.model?.provider && model.id === runtime.model?.id,
          ),
        ),
      );
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!panel.current?.parentElement?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, index]);
  const current = runtime.model ? `${runtime.model.provider}::${runtime.model.id}` : '';
  const q = query.trim().toLowerCase();
  const models = runtime.models.filter((m) => `${m.provider} ${m.name} ${m.id}`.toLowerCase().includes(q));
  const providers = [...new Set(models.map((m) => m.provider))];
  const choose = (key: string) => {
    if (key !== current) pick(key);
    close();
  };
  return (
    <div className="model-picker-anchor">
      <button
        className={'model-pill' + (open ? ' open' : '')}
        onClick={() => {
          setQuery('');
          setIndex(
            Math.max(
              0,
              runtime.models.findIndex((m) => `${m.provider}::${m.id}` === current),
            ),
          );
          setOpen(!open);
          if (!open && canConnect && !runtime.connected) connect();
        }}
        title="选择模型"
        aria-label="选择模型"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{runtime.model?.name || fallback || '选择模型'}</span>
        {runtime.thinking && runtime.thinking !== 'off' && <em>{runtime.thinking}</em>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div ref={panel} className="model-picker" role="dialog" aria-label="模型与推理级别">
          <div className="model-search">
            <Search size={14} />
            <input
              aria-label="搜索模型"
              placeholder="搜索模型或供应商"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (models.length)
                    setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + models.length) % models.length);
                }
                if (e.key === 'Enter' && models[index] && !locked) {
                  e.preventDefault();
                  choose(`${models[index].provider}::${models[index].id}`);
                }
              }}
            />
          </div>
          <div className="model-list" role="listbox" aria-label="可用模型" ref={list}>
            {!runtime.models.length ? (
              <div className="model-empty">
                {runtime.status === 'starting' ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    正在连接 Pi 读取模型…
                  </>
                ) : !runtime.connected ? (
                  <>
                    <p>
                      {runtime.error ? `连接 Pi 失败：${runtime.error}` : '尚未连接 Pi，连接后可读取模型。'}
                    </p>
                    <button disabled={!canConnect} onClick={connect}>
                      重新连接 Pi
                    </button>
                  </>
                ) : (
                  <>
                    <p>还没有可用模型。登录供应商或配置自定义模型后再试。</p>
                    <button onClick={() => manage('providers')}>管理供应商与登录</button>
                  </>
                )}
              </div>
            ) : !models.length ? (
              <p className="model-empty">没有匹配“{query}”的模型</p>
            ) : (
              providers.map((provider) => (
                <div key={provider} role="group" aria-label={provider}>
                  {providers.length > 1 || q ? <div className="model-group">{provider}</div> : null}
                  {models
                    .filter((m) => m.provider === provider)
                    .map((m) => {
                      const key = `${m.provider}::${m.id}`,
                        i = models.indexOf(m);
                      return (
                        <button
                          key={key}
                          role="option"
                          aria-selected={i === index}
                          aria-current={key === current || undefined}
                          disabled={locked}
                          onMouseEnter={() => setIndex(i)}
                          onClick={() => choose(key)}
                        >
                          <span className="model-name">
                            {m.name || m.id}
                            {m.name && m.name !== m.id && <small>{m.id}</small>}
                          </span>
                          <span className="model-tags">
                            {m.reasoning && <i>推理</i>}
                            {m.input?.includes('image') && <i>图片</i>}
                            {m.contextWindow ? <i>{contextLabel(m.contextWindow)}</i> : null}
                          </span>
                          {key === current ? <Check size={15} /> : <span className="check-space" />}
                        </button>
                      );
                    })}
                </div>
              ))
            )}
          </div>
          {runtime.thinkingLevels.length > 0 && (
            <div className="thinking-row">
              <span>推理级别</span>
              <div role="radiogroup" aria-label="推理级别">
                {runtime.thinkingLevels.map((level) => (
                  <button
                    key={level}
                    role="radio"
                    aria-checked={runtime.thinking === level}
                    disabled={locked}
                    onClick={() => level !== runtime.thinking && setThinking(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="model-picker-foot">
            {locked ? <span>执行中，结束后可切换</span> : <span>切换后从下一条消息生效</span>}
            <button
              onClick={() => {
                close();
                manage('settings');
              }}
            >
              连接设置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
