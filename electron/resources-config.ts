import path from 'node:path';
import type { ResourceItem } from '../shared/types';
export function toggleResourceSetting(config: any, r: ResourceItem, enabled: boolean) {
  const prefix = enabled ? '+' : '-';
  const normalize = (s: string) => s.replaceAll('\\', '/');
  const toggle = (values: string[] = [], target: string) => [
    ...values.filter((v) => normalize(v.replace(/^[+-]/, '')) !== normalize(target)),
    prefix + target,
  ];
  if (r.metadata.origin === 'package') {
    const packages = config.packages ?? [];
    const index = packages.findIndex(
      (v: any) => (typeof v === 'string' ? v : v.source) === r.metadata.source,
    );
    if (index < 0) throw new Error('找不到资源所属包，请刷新列表');
    const item = typeof packages[index] === 'string' ? { source: packages[index] } : { ...packages[index] };
    const relative = normalize(path.relative(r.metadata.baseDir!, r.path));
    item[r.kind] = toggle(item[r.kind] ?? ['**/*'], relative);
    config.packages[index] = item;
  } else config[r.kind] = toggle(config[r.kind], r.path);
  return config;
}
