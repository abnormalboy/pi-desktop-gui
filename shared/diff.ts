import { diffWordsWithSpace } from 'diff';

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}
export interface DiffSegment {
  text: string;
  changed: boolean;
}
export interface DiffCell {
  text: string;
  line: number;
  kind: 'added' | 'removed' | 'context';
  segments?: DiffSegment[];
}
export interface DiffRow {
  left?: DiffCell;
  right?: DiffCell;
}

export function parseDiffHunks(patch: string): DiffHunk[] {
  const result: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  for (const line of patch.split(/\r?\n/)) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      current = {
        header: line,
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? 1),
        lines: [],
      };
      result.push(current);
    } else if (current && /^[ +\-\\]/.test(line)) current.lines.push(line);
  }
  return result;
}

export function inlineDiff(before: string, after: string): [DiffSegment[], DiffSegment[]] {
  // Very long generated lines remain readable without expensive word matching.
  if (before.length + after.length > 8_000)
    return [[{ text: before, changed: true }], [{ text: after, changed: true }]];
  const parts = diffWordsWithSpace(before, after);
  return [
    parts.filter((p) => !p.added).map((p) => ({ text: p.value, changed: !!p.removed })),
    parts.filter((p) => !p.removed).map((p) => ({ text: p.value, changed: !!p.added })),
  ];
}

export function alignHunk(hunk: DiffHunk): DiffRow[] {
  const rows: DiffRow[] = [];
  let left = hunk.oldStart,
    right = hunk.newStart;
  for (let index = 0; index < hunk.lines.length;) {
    const line = hunk.lines[index];
    if (line.startsWith('\\')) {
      index++;
      continue;
    }
    if (line.startsWith(' ')) {
      rows.push({
        left: { text: line.slice(1), line: left++, kind: 'context' },
        right: { text: line.slice(1), line: right++, kind: 'context' },
      });
      index++;
      continue;
    }
    const removed: DiffCell[] = [],
      added: DiffCell[] = [];
    while (index < hunk.lines.length && /^[+\-\\]/.test(hunk.lines[index])) {
      const changed = hunk.lines[index++];
      if (changed.startsWith('-')) removed.push({ text: changed.slice(1), line: left++, kind: 'removed' });
      if (changed.startsWith('+')) added.push({ text: changed.slice(1), line: right++, kind: 'added' });
    }
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      if (removed[i] && added[i])
        [removed[i].segments, added[i].segments] = inlineDiff(removed[i].text, added[i].text);
      rows.push({ left: removed[i], right: added[i] });
    }
  }
  return rows;
}

export function hunkPrompt(file: string, hunk: DiffHunk): { attachment?: string; text: string } {
  if (hunk.newLines > 0) {
    const end = hunk.newStart + hunk.newLines - 1;
    return {
      attachment: `${file}#L${hunk.newStart}-L${end}`,
      text: `请看 ${file} 第 ${hunk.newStart}–${end} 行的改动：`,
    };
  }
  return {
    text: `请看 ${file} 的这段删除：\n\n\`\`\`diff\n${hunk.header}\n${hunk.lines.filter((line) => line.startsWith('-')).join('\n')}\n\`\`\``,
  };
}
