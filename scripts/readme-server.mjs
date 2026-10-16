import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

// Serve only the built renderer. README captures never need repository or user files.
export async function startReadmeServer(directory = 'dist') {
  const root = await fs.realpath(directory);
  await fs.access(path.join(root, 'index.html'));
  const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const insideRoot = (file) => {
      const relative = path.relative(root, file);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    };
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (pathname.includes('\0') || !insideRoot(file)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const resolved = await fs.realpath(file);
      if (!insideRoot(resolved)) {
        res.writeHead(403).end();
        return;
      }
      const data = await fs.readFile(resolved);
      const type =
        {
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.html': 'text/html',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.woff2': 'font/woff2',
        }[path.extname(resolved)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      res.writeHead(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
