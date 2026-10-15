import test from 'node:test';
import assert from 'node:assert/strict';
import desktopBridge from '../electron/pi-bridge';
import { APPROVAL_ALWAYS, APPROVAL_DENY, alwaysKey, describe } from '../shared/approval';

function bridge(mode: 'confirm' | 'readonly') {
  const handlers = new Map<string, (...args: any[]) => any>();
  const previous = process.env.PI_DESKTOP_APPROVAL;
  process.env.PI_DESKTOP_APPROVAL = mode;
  try {
    desktopBridge({
      on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
      registerCommand: () => {},
      getAllTools: () => [{ name: 'external_writer', annotations: { readOnlyHint: true } }],
    } as never);
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_APPROVAL;
    else process.env.PI_DESKTOP_APPROVAL = previous;
  }
  return handlers;
}

test('external read-only hints cannot bypass confirmation or read-only restrictions', async () => {
  for (const mode of ['confirm', 'readonly'] as const) {
    let asked = 0;
    const result = await bridge(mode).get('tool_call')!(
      { toolName: 'external_writer', input: {}, toolCallId: 'external' },
      {
        ui: {
          select: async () => {
            asked++;
            return APPROVAL_DENY;
          },
        },
      },
    );
    assert.equal(result?.block, true);
    assert.equal(asked, mode === 'confirm' ? 1 : 0);
  }
});

test('approval displays the entire command and grants only its exact text', () => {
  const prefix = 'echo ' + 'x'.repeat(5000);
  const first = describe('bash', { command: prefix + '; echo first' });
  const second = describe('bash', { command: prefix + '; echo second' });
  assert.equal(first.summary, prefix + '; echo first');
  assert.notEqual(alwaysKey(first), alwaysKey(second));
});

test('always-allow grants end when Pi starts a different session', async () => {
  const handlers = bridge('confirm');
  let asked = 0;
  const notifications: string[] = [];
  const ctx = {
    ui: {
      notify: (message: string) => notifications.push(message),
      select: async () => {
        asked++;
        return APPROVAL_ALWAYS;
      },
    },
  };
  const event = { toolName: 'write', input: { path: 'a.txt', content: 'a' }, toolCallId: 'write' };
  await handlers.get('tool_call')!(event, ctx);
  await handlers.get('tool_call')!(event, ctx);
  assert.equal(asked, 1);
  await handlers.get('session_start')?.({}, ctx);
  assert.deepEqual(notifications, ['__PI_DESKTOP__{"type":"desktop_session_start"}']);
  await handlers.get('tool_call')!(event, ctx);
  assert.equal(asked, 2);
});

test('manual ! commands obey read-only mode before the shell starts', async () => {
  const handler = bridge('readonly').get('user_bash');
  assert.ok(handler, 'RPC user commands need the same approval policy');
  const response = await handler({ command: 'echo blocked', excludeFromContext: false, cwd: '.' }, {});
  assert.notEqual(response?.result?.exitCode, 0);
  assert.match(response.result.output, /只读/);
});
