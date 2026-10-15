export interface CodeToken {
  text: string;
  kind?: 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'added' | 'removed';
}
const languages = new Set([
  'ts',
  'tsx',
  'typescript',
  'js',
  'jsx',
  'javascript',
  'json',
  'bash',
  'sh',
  'shell',
  'powershell',
  'ps1',
  'python',
  'py',
  'rust',
  'rs',
  'go',
  'html',
  'xml',
  'css',
  'scss',
  'diff',
  'patch',
  'md',
  'markdown',
]);
const keywords = new Set(
  'const let var function return async await if else for while do switch case break continue import export from default class interface type extends implements public private protected static new this null undefined true false try catch finally throw in of typeof instanceof void def lambda with as pass raise except yield None True False fn pub impl trait struct enum mut use match self Self mod crate package func defer go range map chan select fallthrough print echo param foreach Write-Host'.split(
    ' ',
  ),
);
export function tokenizeCode(text: string, language: string): CodeToken[] {
  if (!languages.has(language.toLowerCase()) || text.length > 100000) return [{ text }];
  if (language === 'diff' || language === 'patch')
    return text.split(/(?<=\n)/).map((line) => ({
      text: line,
      kind: line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : undefined,
    }));
  const pattern =
    /\/\*[\s\S]*?(?:\*\/|$)|<!--[\s\S]*?(?:-->|$)|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_$][\w$]*\b/g;
  const result: CodeToken[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index,
      value = match[0];
    if (start > offset) result.push({ text: text.slice(offset, start) });
    const kind = /^(\/\*|\/\/|<!--|#)/.test(value)
      ? 'comment'
      : /^['"`]/.test(value)
        ? 'string'
        : /^\d/.test(value)
          ? 'number'
          : keywords.has(value)
            ? 'keyword'
            : /^\s*\(/.test(text.slice(start + value.length))
              ? 'function'
              : undefined;
    result.push({ text: value, kind });
    offset = start + value.length;
  }
  if (offset < text.length) result.push({ text: text.slice(offset) });
  return result;
}
