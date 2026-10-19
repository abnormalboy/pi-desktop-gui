import { messageText, type Message, type ToolActivity } from '../../shared/types';
import { splitUserContent } from './message-content';
const readOnly = new Set(['read', 'grep', 'find', 'ls', 'tool_search']);
export function hideRecoveredErrors(messages: Message[]): Message[] {
  const result: Message[] = [];
  let recovered = false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'user') recovered = false;
    if (message.role === 'assistant') {
      if (message.stopReason === 'stop' || message.stopReason === 'toolUse') recovered = true;
      else if (message.stopReason === 'error' && recovered) {
        if (!message.content.length) continue;
        result.push({ ...message, errorMessage: undefined });
        continue;
      }
    }
    result.push(message);
  }
  return result.reverse();
}
export type ConversationItem =
  { kind: 'message'; index: number } | { kind: 'group'; id: string; indices: number[] };
export function groupConversation(
  messages: Message[],
  toolFor: (message: Message) => ToolActivity,
  expanded: string[],
): ConversationItem[] {
  const result: ConversationItem[] = [],
    pending: number[] = [];
  const flush = () => {
    if (pending.length >= 3)
      result.push({
        kind: 'group',
        id: 'group:' + pending.map((i) => toolFor(messages[i]).id).join(':'),
        indices: [...pending],
      });
    else for (const index of pending) result.push({ kind: 'message', index });
    pending.length = 0;
  };
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'toolResult') {
      const tool = toolFor(message);
      if (
        readOnly.has(tool.name) &&
        tool.status === 'done' &&
        !message.isError &&
        !expanded.includes(tool.id)
      ) {
        pending.push(index);
        continue;
      }
    }
    // Tool-call-only assistant envelopes have no visible message; they do not break an exploration group.
    if (
      message.role === 'assistant' &&
      !messageText(message) &&
      !message.errorMessage &&
      Array.isArray(message.content) &&
      !message.content.some((b) => (b.type === 'thinking' && b.thinking) || typeof b.partialJson === 'string')
    )
      continue;
    flush();
    result.push({ kind: 'message', index });
  }
  flush();
  return result;
}
export interface TurnItem {
  turn: number;
  index: number;
  title: string;
  modified: boolean;
  failed: boolean;
  added: number;
  removed: number;
}
export function conversationTurns(
  messages: Message[],
  toolFor: (message: Message) => ToolActivity,
): TurnItem[] {
  const turns: TurnItem[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'user')
      turns.push({
        turn: turns.length + 1,
        index,
        title: splitUserContent(messageText(message)).text.slice(0, 36),
        modified: false,
        failed: false,
        added: 0,
        removed: 0,
      });
    const current = turns.at(-1);
    if (!current) continue;
    if (
      message.errorMessage ||
      message.isError ||
      (message.role === 'bashExecution' && Number(message.exitCode))
    )
      current.failed = true;
    if (message.role === 'toolResult') {
      const tool = toolFor(message);
      current.modified ||= tool.name === 'write' || tool.name === 'edit';
      current.failed ||= tool.status === 'error';
      for (const line of tool.patch?.split('\n') ?? []) {
        if (line.startsWith('+') && !line.startsWith('+++')) current.added++;
        if (line.startsWith('-') && !line.startsWith('---')) current.removed++;
      }
    }
  }
  return turns;
}
