import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startReadmeServer } from '../scripts/readme-server.mjs';

test('README capture server serves the build but rejects traversal, escaped links and malformed URLs', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-readme-server-'));
  let server;
  t.after(async () => {
    await server?.close();
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('pi-readme-server-'));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const dist = path.join(temporary, 'dist');
  const outside = path.join(temporary, 'outside');
  await fs.mkdir(dist);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.txt'), 'must not be served');
  await assert.rejects(startReadmeServer(dist), /ENOENT/);
  await fs.writeFile(path.join(dist, 'index.html'), '<h1>README fixture</h1>');
  await fs.writeFile(path.join(dist, 'app.js'), 'window.fixture = true;');
  await fs.symlink(outside, path.join(dist, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  server = await startReadmeServer(dist);
  const endpoint = new URL(server.url);
  assert.equal(endpoint.hostname, '127.0.0.1');
  // Preserve raw request paths instead of letting URL/fetch normalize ../ away.
  const request = (requestPath, method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: endpoint.hostname, port: endpoint.port, path: requestPath, method },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  assert.equal((await request('/')).body, '<h1>README fixture</h1>');
  assert.equal((await request('/app.js?v=1')).headers['content-type'], 'text/javascript');
  const head = await request('/app.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  for (const escape of ['/../outside/private.txt', '/%2e%2e%2foutside/private.txt', '/linked/private.txt']) {
    const result = await request(escape);
    assert.equal(result.status, 403, escape);
    assert.equal(result.body.includes('must not be served'), false);
  }
  if (process.platform === 'win32') assert.equal((await request('/..%5coutside%5cprivate.txt')).status, 403);
  assert.equal((await request('/%00')).status, 403);
  assert.equal((await request('/%zz')).status, 400);
  assert.equal((await request('/missing.js')).status, 404);
  assert.equal((await request('/', 'POST')).status, 405);
  assert.equal((await request('/')).status, 200, 'invalid requests must not crash the capture server');
});
