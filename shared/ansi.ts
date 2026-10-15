export type AnsiColor = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'gray';
export interface AnsiSegment {
  text: string;
  color?: AnsiColor;
  bold?: boolean;
}
const colors: (AnsiColor | undefined)[] = [
  'gray',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'gray',
];

/** Terminal text only: no HTML, links, titles, cursor escapes or executable markup. */
export function parseAnsi(input: string): AnsiSegment[] {
  if (!/[\x1b\x9b\r\b]/.test(input)) return [{ text: input.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '') }];
  const out: AnsiSegment[] = [];
  let line: AnsiSegment[] = [],
    cursor = 0;
  let color: AnsiColor | undefined,
    bold = false;
  const append = (part: AnsiSegment) => {
    const previous = out.at(-1);
    if (previous && previous.color === part.color && Boolean(previous.bold) === Boolean(part.bold))
      previous.text += part.text;
    else out.push({ ...part });
  };
  const flush = (newline: boolean) => {
    for (const part of line) append(part ?? { text: ' ' });
    if (newline) append({ text: '\n' });
    line = [];
    cursor = 0;
  };
  for (let i = 0; i < input.length;) {
    const ch = input[i++];
    if (ch === '\x1b' || ch === '\x9b') {
      const kind = ch === '\x9b' ? '[' : input[i++];
      if (kind === '[') {
        const start = i;
        while (i < input.length && !/[@-~]/.test(input[i])) i++;
        const parameters = input.slice(start, i),
          final = input[i++];
        const values = parameters.split(';').map((v) => Number(v) || 0);
        if (final === 'm') {
          for (let p = 0; p < values.length; p++) {
            const value = values[p];
            if (value === 0) {
              color = undefined;
              bold = false;
            } else if (value === 1) bold = true;
            else if (value === 22) bold = false;
            else if (value === 39) color = undefined;
            else if (value >= 30 && value <= 37) color = colors[value - 30];
            else if (value >= 90 && value <= 97) color = colors[value - 90];
            else if (value === 38 || value === 48) p += values[p + 1] === 2 ? 4 : values[p + 1] === 5 ? 2 : 0;
          }
        } else if (final === 'K') {
          if (values[0] === 2) line = [];
          else if (values[0] === 1) for (let p = 0; p <= cursor; p++) line[p] = { text: ' ' };
          else line.length = Math.min(cursor, line.length);
        } else if (final === 'G') cursor = Math.max(0, (values[0] || 1) - 1);
      } else if (kind === ']' || kind === 'P' || kind === '^' || kind === '_') {
        while (i < input.length && input[i] !== '\x07' && !(input[i] === '\x1b' && input[i + 1] === '\\'))
          i++;
        i += input[i] === '\x07' ? 1 : 2;
      }
      continue;
    }
    if (ch === '\r') {
      cursor = 0;
      continue;
    }
    if (ch === '\b') {
      cursor = Math.max(0, cursor - 1);
      continue;
    }
    if (ch === '\n') {
      flush(true);
      continue;
    }
    if ((ch < ' ' && ch !== '\t') || ch === '\x7f') continue;
    line[cursor++] = { text: ch, ...(color && { color }), ...(bold && { bold }) };
  }
  flush(false);
  return out;
}
export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((part) => part.text)
    .join('');
}
