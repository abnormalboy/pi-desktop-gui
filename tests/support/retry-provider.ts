import http from 'node:http';

export type RetryScenario = 'success' | 'recover' | 'exhaust' | 'cancel-delay' | 'cancel-request' | 'timeout';

/** Faults at the transport boundary of the unmodified Pi CLI; never uses a real provider. */
export async function createRetryProvider() {
  let scenario: RetryScenario = 'recover';
  let count = 0;
  let hold = false;
  const held = new Set<() => void>();
  const requests: { scenario: RetryScenario; count: number; toolResults: number; closed: boolean }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const attempt = ++count;
    const entry = {
      scenario,
      count: attempt,
      toolResults: body.messages.filter((m: any) => m.role === 'tool').length,
      closed: false,
    };
    requests.push(entry);
    res.on('close', () => {
      entry.closed = true;
    });
    if (
      scenario === 'exhaust' ||
      (scenario !== 'success' && attempt === 1) ||
      (scenario === 'recover' && attempt === 3)
    ) {
      if (scenario !== 'timeout' || attempt !== 1) req.socket.destroy();
      return;
    }
    if (scenario === 'cancel-request') return;
    const respond = () => {
      held.delete(respond);
      if (res.destroyed) return;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: 'retry-test', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      if (entry.scenario === 'recover' && attempt === 2) {
        chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'read-once',
              type: 'function',
              function: { name: 'read', arguments: JSON.stringify({ path: '输入 文件.txt' }) },
            },
          ],
        });
        chunk({}, 'tool_calls');
      } else {
        chunk({ role: 'assistant', content: 'RECOVERED' });
        chunk({}, 'stop');
      }
      res.end('data: [DONE]\n\n');
    };
    res.on('close', () => held.delete(respond));
    if (hold) held.add(respond);
    else respond();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    get count() {
      return count;
    },
    reset(next: RetryScenario, holdResponse = false) {
      scenario = next;
      count = 0;
      hold = holdResponse;
    },
    release() {
      hold = false;
      for (const respond of held) respond();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
