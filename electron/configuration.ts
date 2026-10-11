import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { agentDirectory } from './environment';
import type { ConfigDocument, ConfigKind } from '../shared/types';
import type { Store } from './store';
const hidden = '[已保存的密钥]';
const sensitive = /api.?key|token|password|secret|authorization|headers|env|auth/i;
function mask(value: any, secret = false): any {
  if (typeof value === 'string') return secret && value ? hidden : value;
  if (Array.isArray(value)) return value.map((v) => mask(v, secret));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, mask(v, secret || sensitive.test(k))]),
    );
  return value;
}
function restore(value: any, original: any): any {
  if (value === hidden) {
    if (typeof original !== 'string')
      throw new Error('密钥占位符必须保留在原位置；新配置请填写真实值或环境变量名');
    return original;
  }
  if (Array.isArray(value)) return value.map((v, i) => restore(v, original?.[i]));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v, original?.[k])]));
  return value;
}
const revision = (s: string) => createHash('sha256').update(s).digest('hex');
export class Configuration {
  constructor(private store: Store) {}
  private async file(id: string, kind: ConfigKind, local: boolean) {
    if (!['settings', 'models', 'mcp'].includes(kind) || typeof local !== 'boolean')
      throw new Error('配置类型无效');
    const session = this.store.session(id);
    if (local && (kind === 'models' || !session.projectId || !this.store.project(session.projectId).trusted))
      throw new Error('此配置只支持个人范围，或项目尚未启用');
    return path.join(
      local
        ? path.join(await this.store.sessionDirectory(id), '.pi')
        : agentDirectory(this.store.state.settings),
      kind + '.json',
    );
  }
  private async raw(file: string) {
    return fs.readFile(file, 'utf8').catch((e) => {
      if (e.code === 'ENOENT') return '{}';
      throw e;
    });
  }
  async read(id: string, kind: ConfigKind, local: boolean): Promise<ConfigDocument> {
    const file = await this.file(id, kind, local),
      raw = await this.raw(file);
    return { text: JSON.stringify(mask(JSON.parse(raw)), null, 2), revision: revision(raw), path: file };
  }
  async save(id: string, kind: ConfigKind, local: boolean, document: ConfigDocument) {
    const file = await this.file(id, kind, local),
      raw = await this.raw(file);
    if (document.revision !== revision(raw)) throw new Error('配置已被其他程序修改，请重新读取后再保存');
    const parsed = JSON.parse(document.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('配置必须是 JSON 对象');
    const value = restore(parsed, JSON.parse(raw));
    if (
      kind === 'models' &&
      value.providers !== undefined &&
      (!value.providers || Array.isArray(value.providers) || typeof value.providers !== 'object')
    )
      throw new Error('providers 必须是对象');
    if (
      kind === 'mcp' &&
      value.mcpServers !== undefined &&
      (!value.mcpServers || Array.isArray(value.mcpServers) || typeof value.mcpServers !== 'object')
    )
      throw new Error('mcpServers 必须是对象');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.desktop-backup', raw, { mode: 0o600 });
    await fs.writeFile(file + '.desktop-tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    if (revision(await this.raw(file)) !== revision(raw)) throw new Error('保存前配置发生了变化，请重新读取');
    await fs.rename(file + '.desktop-tmp', file);
  }
}
