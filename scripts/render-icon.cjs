// Export the approved source artwork for runtime and platform packaging.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const buildDir = path.resolve(__dirname, '..', 'build');
    const source = nativeImage.createFromPath(path.join(buildDir, 'icon-source-v2.png'));
    const { width, height } = source.getSize();
    if (source.isEmpty() || width !== 1024 || height !== 1024)
      throw new Error('图标原图必须是可读取的 1024 × 1024 PNG：build/icon-source-v2.png');
    const pngAt = (size) => source.resize({ width: size, height: size, quality: 'best' }).toPNG();
    fs.writeFileSync(path.join(buildDir, 'icon.png'), pngAt(256));
    fs.writeFileSync(path.join(buildDir, 'icon-mac.png'), source.toPNG());

    const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    const frames = sizes.map(pngAt);
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
      const entry = 6 + index * 16;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(frames[index].length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += frames[index].length;
    });
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([header, ...frames]));
    console.log(`已生成窗口 PNG、macOS/Linux PNG 和 ${sizes.length} 种尺寸的 Windows ICO。`);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
