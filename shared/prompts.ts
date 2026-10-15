export type PromptScope = 'global' | 'project';

export interface PromptTemplateInput {
  name: string;
  description: string;
  argumentHint: string;
  body: string;
  scope: PromptScope;
}

export interface PromptTemplateDocument extends PromptTemplateInput {
  path: string;
  revision: string;
}

export function validatePromptTemplate(value: unknown): asserts value is PromptTemplateInput {
  if (!value || typeof value !== 'object') throw new Error('提示词模板内容无效，请重新打开后保存');
  const template = value as PromptTemplateInput;
  if (typeof template.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(template.name))
    throw new Error('模板命令名只能使用字母、数字和连字符，长度为 1–80 个字符');
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(template.name))
    throw new Error('这个名称由系统保留，请换一个模板命令名');
  if (template.scope !== 'global' && template.scope !== 'project')
    throw new Error('请选择个人全局或当前项目');
  for (const [key, label, limit] of [
    ['description', '模板说明', 500],
    ['argumentHint', '参数提示', 200],
  ] as const) {
    if (typeof template[key] !== 'string' || template[key].length > limit || /[\r\n\0]/.test(template[key]))
      throw new Error(`${label}必须是单行文字，且不超过 ${limit} 个字符`);
  }
  if (typeof template.body !== 'string' || !template.body.trim() || template.body.includes('\0'))
    throw new Error('请填写模板正文');
  if (new TextEncoder().encode(template.body).length > 1024 * 1024)
    throw new Error('模板正文不能超过 1 MiB，请缩小内容后保存');
}

/** JSON strings are valid YAML scalars, including colons, hashes and quotes. */
export function serializePromptTemplate(template: PromptTemplateInput): string {
  validatePromptTemplate(template);
  return [
    '---',
    `description: ${JSON.stringify(template.description)}`,
    ...(template.argumentHint ? [`argument-hint: ${JSON.stringify(template.argumentHint)}`] : []),
    '---',
    template.body,
  ].join('\n');
}
