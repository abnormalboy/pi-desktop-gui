import readline from 'node:readline';
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const r = JSON.parse(line);
  if (r.id === undefined) return;
  let result = {};
  if (r.method === 'initialize')
    result = {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'desktop-test', version: '1.0.0' },
    };
  if (r.method === 'tools/list')
    result = {
      tools: [
        {
          name: 'ping',
          description: 'Local deterministic MCP test',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };
  if (r.method === 'tools/call') result = { content: [{ type: 'text', text: 'MCP_TEST_OK' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n');
});
