// Playwright 1.64 checks predicate truthiness before awaiting it: return a boolean,
// never a Promise, and verify the intended session rather than whichever is current.
export function modelSwitchReady({
  id,
  title,
  status,
  modelId,
  nextModelId,
  savedModelId,
  selectorValue,
  thinking,
  nextThinking,
  supportsThinking,
  connected,
  readyToType,
  draft,
  canSend,
}) {
  const runtime = window.modelSwitchRuntimes?.get(id);
  const state = window.modelSwitchState;
  const thinkingLevels = runtime?.nextTask?.thinkingLevels ?? runtime?.thinkingLevels;
  const input = document.querySelector('textarea[aria-label="任务输入"]');
  const send = document.querySelector('.send-button');
  const selector = document.querySelector('select[aria-label="选择模型"]');
  return Boolean(
    id &&
    window.modelSwitchState?.selectedSessionId === id &&
    runtime?.sessionId === id &&
    (status === undefined || runtime.status === status) &&
    (modelId === undefined || runtime.model?.id === modelId) &&
    (nextModelId === undefined || runtime.nextTask?.model?.id === nextModelId) &&
    (savedModelId === undefined ||
      (state.settings?.modelId === savedModelId &&
        state.sessions?.find((session) => session.id === id)?.model?.id === savedModelId)) &&
    (selectorValue === undefined || (selector && !selector.disabled && selector.value === selectorValue)) &&
    (thinking === undefined || runtime.thinking === thinking) &&
    (nextThinking === undefined || runtime.nextTask?.thinking === nextThinking) &&
    (supportsThinking === undefined ||
      (Array.isArray(thinkingLevels) && thinkingLevels.includes(supportsThinking))) &&
    (connected === undefined || runtime.connected === connected) &&
    (title === undefined ||
      (document.querySelector('.workspace-title h1')?.textContent === title &&
        document
          .querySelector(`.session-row[data-session-id="${id}"] > button`)
          ?.getAttribute('aria-current') === 'page')) &&
    (!readyToType || (input && !input.disabled && send && !send.querySelector('.spin'))) &&
    (draft === undefined || input?.value === draft) &&
    (!canSend || (send && !send.disabled)),
  );
}
