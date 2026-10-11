// Render the repository-owned SVG with Electron, then wrap the PNG in an ICO.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true },
    });
    const svg = fs.readFileSync(path.resolve('build/icon.svg'), 'utf8');
    await win.loadURL(
      'data:text/html,' +
        encodeURIComponent('<body style="margin:0;background:transparent">' + svg + '</body>'),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const icon = (await win.webContents.capturePage()).resize({ width: 256, height: 256 }).toPNG();
    fs.writeFileSync(path.resolve('build/icon.png'), icon);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(icon.length, 14);
    header.writeUInt32LE(22, 18);
    fs.writeFileSync(path.resolve('build/icon.ico'), Buffer.concat([header, icon]));
    win.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
