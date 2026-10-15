export interface AttachmentSpec {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface AttachmentInfo {
  spec: string;
  bytes: number;
  lines: number;
}

/** Both input spellings are normalized before they enter a saved draft. */
export function parseAttachmentSpec(spec: string): AttachmentSpec {
  if (!spec || spec.includes('\0')) throw new Error('请输入项目内的文件路径');
  const match = /^(.*?)(?:#L(\d+)(?:-L(\d+))?|:(\d+)(?:-(\d+))?)$/.exec(spec);
  if (!match) {
    if (/#L|:\d/.test(spec)) throw new Error('行范围格式不正确，请使用 #L10-L40 或 :10-40');
    return { path: spec };
  }
  const startLine = Number(match[2] ?? match[4]);
  const endLine = Number(match[3] ?? match[5] ?? startLine);
  if (
    !match[1] ||
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  )
    throw new Error('行号必须从 1 开始，结束行不能小于起始行');
  return { path: match[1], startLine, endLine };
}

export function formatAttachmentSpec(spec: AttachmentSpec) {
  return spec.startLine === undefined
    ? spec.path
    : `${spec.path}#L${spec.startLine}-L${spec.endLine ?? spec.startLine}`;
}

export const normalizeAttachmentSpec = (spec: string) => formatAttachmentSpec(parseAttachmentSpec(spec));
