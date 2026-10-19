// Serializable for Electron's app.evaluate. Install only after the real Pi scenarios finish.
export function installRetryDisplayFixture({ ipcMain, BrowserWindow }, sessionId) {
  const webContents = BrowserWindow.getAllWindows()[0].webContents;
  const send = webContents.send.bind(webContents);
  const fixture = {
    runtime: undefined,
    actions: [],
    ignoredEvents: 0,
    publish(runtime) {
      if (runtime.sessionId !== sessionId) throw new Error('Unexpected fixture session');
      fixture.runtime = runtime;
      send('desktop:event', { type: 'runtime', runtime });
    },
  };
  globalThis.retryDisplayFixture = fixture;
  webContents.send = (channel, event, ...args) => {
    const eventSession =
      event?.type === 'runtime'
        ? event.runtime?.sessionId
        : event?.type === 'runtimePatch'
          ? event.patch?.sessionId
          : event?.type === 'runtimeRemoved'
            ? event.sessionId
            : undefined;
    // Pi can publish a debounced settlement patch after the UI shows completed.
    // Once fixture mode starts, only its snapshots own this session's renderer runtime.
    if (fixture.runtime && channel === 'desktop:event' && eventSession === sessionId) {
      fixture.ignoredEvents++;
      return;
    }
    return send(channel, event, ...args);
  };
  const handler = ipcMain._invokeHandlers.get('desktop:invoke');
  ipcMain.removeHandler('desktop:invoke');
  ipcMain.handle('desktop:invoke', async (event, method, args) => {
    if (fixture.runtime && args?.[0] === sessionId) {
      if (method === 'readHistory') return fixture.runtime.messages;
      if (method === 'messageAction') {
        fixture.actions.push(args);
        return;
      }
    }
    const result = await handler(event, method, args);
    return method === 'bootstrap' && fixture.runtime ? { ...result, runtime: fixture.runtime } : result;
  });
}
