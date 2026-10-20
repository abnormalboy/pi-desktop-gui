import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { emptyRuntime } from '../shared/types';

const require = createRequire(import.meta.url);
function component(file: string, name: string) {
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    loader: { '.css': 'empty' },
  });
  const slots: unknown[] = [];
  let cursor = 0;
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value: any) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef: (current: unknown) => ({ current }),
    useEffect() {},
    useLayoutEffect() {},
  };
  const loaded = { exports: {} as Record<string, (props: any) => any> };
  new Function('require', 'module', 'exports', 'window', built.outputFiles[0].text)(
    (id: string) => (id === 'react' ? { ...require('react'), ...hooks } : require(id)),
    loaded,
    loaded.exports,
    { desktop: { platform: 'linux' } },
  );
  return (props: any) => {
    cursor = 0;
    return loaded.exports[name](props);
  };
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const noOp = () => {};

test('explicit current model and off thinking clicks reach the durable choice callbacks', () => {
  const render = component('src/components/ModelPicker.tsx', 'ModelPicker');
  const models: string[] = [],
    thinking: string[] = [];
  const runtime = {
    ...emptyRuntime(),
    modelsLoaded: true,
    model: { provider: 'local', id: 'default', name: 'Default' },
    models: [{ provider: 'local', id: 'default', name: 'Default' }],
    thinking: 'off',
    thinkingLevels: ['off', 'high'],
  };
  const tree = render({
    runtime,
    fallback: '',
    locked: false,
    thinkingLocked: false,
    canConnect: true,
    loadModels: noOp,
    pick: (value: string) => models.push(value),
    setThinking: (value: string) => thinking.push(value),
    manage: noOp,
    open: true,
    setOpen: noOp,
  });
  assert.deepEqual(models, [], 'showing a catalog must not choose a model');
  assert.deepEqual(thinking, [], 'showing a catalog must not choose a thinking level');
  const option = nodes(tree).find((node) => node.props?.role === 'option' && node.props['aria-current']);
  assert.ok(option);
  option.props.onClick();
  assert.deepEqual(models, ['local::default']);
  const off = nodes(tree).find((node) => node.props?.role === 'radio' && node.props['aria-checked']);
  assert.ok(off);
  off.props.onClick();
  assert.deepEqual(thinking, ['off']);
});

test('opening approval options is passive; explicitly choosing current auto is retained', () => {
  const render = component('src/components/Approval.tsx', 'ApprovalSwitch');
  const choices: string[] = [];
  const props = { mode: 'auto', disabled: false, change: (value: string) => choices.push(value) };
  let tree = render(props);
  nodes(tree)
    .find((node) => node.props?.['aria-label'] === '审批模式')
    .props.onClick();
  tree = render(props);
  assert.deepEqual(choices, []);
  const current = nodes(tree).find(
    (node) => node.props?.role === 'menuitemradio' && node.props['aria-checked'],
  );
  assert.ok(current);
  current.props.onClick();
  assert.deepEqual(choices, ['auto']);
});
