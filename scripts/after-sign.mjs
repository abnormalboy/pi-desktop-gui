import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Arch } from 'builder-util';

/** Validate every extracted file before a directory update changes the running copy. */
export default async function writeWindowsUpdateFileChecks(context) {
  if (context.electronPlatformName !== 'win32') return;
  const arch = Arch[context.arch];
  const lines = [`!macro piVerifyDirectory_${arch} DIRECTORY`];
  async function visit(relative = '') {
    const entries = await fs.readdir(path.join(context.appOutDir, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (!entry.isFile() || /[\r\n"`]/.test(file)) throw new Error(`无法生成 Windows 更新文件校验：${file}`);
      const hash = createHash('sha512');
      for await (const chunk of createReadStream(path.join(context.appOutDir, file))) hash.update(chunk);
      const escaped = file
        .split(path.sep)
        .join('\\')
        .replaceAll('$', () => '$$');
      lines.push('  ${StdUtils.HashFile} $R0 "SHA2-512" "${DIRECTORY}\\' + escaped + '"');
      lines.push('  ${if} $R0 != "' + hash.digest('hex').toUpperCase() + '"');
      lines.push('    Goto piDirectoryExtractFailed');
      lines.push('  ${endif}');
    }
  }
  await visit();
  lines.push('!macroend', '');
  await fs.writeFile(
    path.join(context.packager.info.buildResourcesDir, `update-files-${arch}.nsh`),
    lines.join('\n'),
  );
}
