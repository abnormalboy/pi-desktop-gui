import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { getAppUpdatePublishConfiguration } from 'app-builder-lib/out/publish/PublishManager.js';

/** Directory-only Windows builds also need the repository and download cache configuration. */
export default async function writeWindowsUpdateConfig(context) {
  if (context.electronPlatformName !== 'win32') return;
  const config = await getAppUpdatePublishConfiguration(context.packager, null, context.arch, false);
  if (!config) throw new Error('缺少更新仓库地址，请检查 package.json 中的 build.publish 配置。');
  await fs.writeFile(
    path.join(context.packager.getResourcesDir(context.appOutDir), 'app-update.yml'),
    yaml.dump(config),
  );
}
