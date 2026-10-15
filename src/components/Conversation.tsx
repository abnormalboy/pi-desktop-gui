import { LoaderCircle, ArrowDown, CircleHelp } from 'lucide-react';
import { ToolCard } from './conversation/ToolCard';
import { ApprovalCard } from './Approval';
import { ChatMessage } from './conversation/ChatMessage';
import { ReadinessChecklist } from './ReadinessChecklist';
const api = window.desktop;
import type { Workbench } from '../hooks/useWorkbench';
import type { AppState } from '../../shared/types';
import type { ReactNode } from 'react';
export function Conversation(
  props: Pick<
    Workbench,
    | 'state'
    | 'runtime'
    | 'environment'
    | 'pending'
    | 'setFeatureTab'
    | 'compact'
    | 'inspector'
    | 'expanded'
    | 'messageLimit'
    | 'setMessageLimit'
    | 'newContent'
    | 'setNewContent'
    | 'thread'
    | 'input'
    | 'autoScroll'
    | 'selected'
    | 'project'
    | 'sessionEnabled'
    | 'ownRuntime'
    | 'running'
    | 'messages'
    | 'approvals'
    | 'lastAssistant'
    | 'visibleMessages'
    | 'attempt'
    | 'persistDraft'
    | 'focusComposer'
    | 'selectSession'
    | 'openSettings'
    | 'connect'
    | 'inspectFile'
    | 'toggleTool'
    | 'messageContext'
  > & { state: AppState; children: ReactNode },
) {
  const {
    state,
    runtime,
    environment,
    pending,
    setFeatureTab,
    compact,
    inspector,
    expanded,
    messageLimit,
    setMessageLimit,
    newContent,
    setNewContent,
    thread,
    input,
    autoScroll,
    selected,
    project,
    sessionEnabled,
    ownRuntime,
    running,
    messages,
    approvals,
    lastAssistant,
    visibleMessages,
    attempt,
    persistDraft,
    focusComposer,
    selectSession,
    openSettings,
    connect,
    inspectFile,
    toggleTool,
    messageContext,
  } = props;

  return (
    <section className="conversation" inert={inspector && compact}>
      {running && !ownRuntime && (
        <div className="banner">
          <LoaderCircle size={15} className="spin" />
          另一个会话正在执行
          <button
            onClick={() => {
              const s = state.sessions.find((s) => s.id === runtime.sessionId);
              if (s) void selectSession(s);
            }}
          >
            查看任务
          </button>
        </div>
      )}
      {project && !project.trusted && (
        <div className="trust-banner">
          <CircleHelp size={19} />
          <div>
            <strong>在这个项目中启用 Pi</strong>
            <p>Pi 可以读取、修改项目文件并执行本机命令。</p>
          </div>
          <button onClick={() => void attempt(() => api.invoke('trustProject', project.id))}>启用项目</button>
        </div>
      )}
      <div
        className="thread"
        ref={thread}
        onScroll={() => {
          const el = thread.current;
          if (!el) return;
          autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
          if (autoScroll.current) setNewContent(false);
        }}
        onMouseLeave={() => {
          if (selected && thread.current)
            void api.invoke('saveView', selected.id, thread.current.scrollTop, expanded);
        }}
      >
        {!messages.length && (
          <div className="welcome">
            <div className="welcome-symbol" aria-hidden="true">
              π
            </div>
            <h2>{project ? '想一起完成什么？' : '有什么想聊的？'}</h2>
            <p>{project ? '描述一个目标，或者从下面开始。' : '直接提问、整理思路，或一起打磨一个想法。'}</p>
            <ReadinessChecklist
              environment={environment}
              runtime={runtime}
              ownRuntime={ownRuntime}
              savedModel={selected?.model?.id || state.settings.modelId}
              canConnect={sessionEnabled && !running && !pending}
              checkEnvironment={() => openSettings('environment')}
              connect={() => void connect()}
              providers={() => setFeatureTab('providers')}
            />
            {!project ? (
              <div className="suggestions">
                {[
                  ['解释概念', '帮我解释一个概念：', '从直觉讲到细节，配上例子'],
                  ['整理思路', '帮我梳理一下这个想法：', '把零散的想法理成结构'],
                  ['一起写作', '和我一起打磨这段文字：', '改稿、润色或换个语气'],
                ].map(([label, prompt, hint]) => (
                  <button
                    key={label}
                    aria-label={label}
                    onClick={() => {
                      persistDraft(prompt);
                      focusComposer();
                    }}
                  >
                    <span>{label}</span>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="suggestions">
                {[
                  ['理解项目', '梳理这个项目的结构、运行方式和主要模块。', '结构、运行方式和主要模块'],
                  ['修复问题', '帮我定位并修复一个问题：', '描述现象，Pi 定位并修改'],
                  ['补充测试', '检查项目中缺少测试的关键逻辑，先给出建议。', '找出缺少测试的关键逻辑'],
                ].map(([label, prompt, hint]) => (
                  <button
                    key={label}
                    aria-label={label}
                    onClick={() => {
                      persistDraft(prompt);
                      input.current?.focus();
                    }}
                  >
                    <span>{label}</span>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.length > messageLimit && (
          <button className="load-history" onClick={() => setMessageLimit((v) => v + 80)}>
            加载更早的 {Math.min(80, messages.length - messageLimit)} 条消息
          </button>
        )}
        {visibleMessages.map((m, i) => (
          <ChatMessage
            key={`${selected?.id}-${i + messages.length - visibleMessages.length}`}
            m={m}
            last={m === lastAssistant}
            ctx={messageContext}
          />
        ))}
        {ownRuntime &&
          runtime.tools
            .filter((t) => !messages.some((m) => m.role === 'toolResult' && m.toolCallId === t.id))
            .map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                expanded={expanded.includes(tool.id)}
                onToggle={(v) => toggleTool(tool.id, v)}
                openFile={(p) => void inspectFile(p, 'files')}
              />
            ))}
        {ownRuntime &&
          approvals.map((d, i) => (
            <ApprovalCard
              key={d.id}
              dialog={d}
              first={i === 0}
              respond={(value) => void attempt(() => api.invoke('respond', d.id, { value }))}
            />
          ))}
        {ownRuntime && runtime.notices.length > 0 && (
          <details className="runtime-notices">
            <summary>运行记录 · {runtime.notices.length}</summary>
            {runtime.notices.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </details>
        )}
      </div>
      {newContent && (
        <button
          className="new-content"
          onClick={() => {
            autoScroll.current = true;
            thread.current?.scrollTo({ top: thread.current.scrollHeight });
            setNewContent(false);
          }}
        >
          <ArrowDown size={14} />
          新内容
        </button>
      )}
      {props.children}
    </section>
  );
}
