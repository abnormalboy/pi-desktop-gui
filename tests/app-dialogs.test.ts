import test from 'node:test';
import assert from 'node:assert/strict';
import { AppDialogRequests } from '../electron/app-dialogs';
import type { AppDialog } from '../shared/types';

test('business confirmations publish their exact content and wait for an explicit answer', async () => {
  const events: AppDialog[] = [];
  const dialogs = new AppDialogRequests((event) => events.push(event));
  let settled = false;
  const result = dialogs.show({ message: '删除会话？', detail: '移到回收站', buttons: ['取消', '删除'] });
  void result.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(events[0].detail, '移到回收站');
  assert.throws(() => dialogs.respond(events[0].id, 2), /无效/);
  assert.throws(() => dialogs.respond(events[0].id, NaN), /无效/);
  dialogs.respond(events[0].id, 0);
  dialogs.respond(events[0].id, 1);
  assert.deepEqual(await result, { response: 0 });
});

test('queued confirmations have independent identities and renderer loss cancels all', async () => {
  const events: AppDialog[] = [];
  const dialogs = new AppDialogRequests((event) => events.push(event));
  const first = dialogs.show({ message: 'first', buttons: ['取消', '确认'] });
  const second = dialogs.show({ message: 'second', buttons: ['确认', '取消'], cancelId: 1 });
  assert.notEqual(events[0].id, events[1].id);
  dialogs.respond('unrequested-id', 1);
  dialogs.cancelAll();
  assert.deepEqual(await first, { response: 0 });
  assert.deepEqual(await second, { response: 1 });
  dialogs.respond(events[0].id, 1);
  const next = dialogs.show({ message: 'next', buttons: ['取消', '确认'] });
  dialogs.respond(events[2].id, 1);
  assert.deepEqual(await next, { response: 1 });
});
