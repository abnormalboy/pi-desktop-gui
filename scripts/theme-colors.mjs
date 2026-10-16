/** Compare hex colors without discarding opacity. CSS uses RGBA; Electron native backgrounds use ARGB. */
export function hexColor(value, format = 'css') {
  if (!['css', 'electron'].includes(format)) throw new Error('Unknown color format');
  const match = typeof value === 'string' && /^#([\da-f]+)$/i.exec(value.trim());
  if (!match || ![3, 4, 6, 8].includes(match[1].length) || (format === 'electron' && match[1].length === 4))
    throw new Error(`Expected a ${format} hex color: ${value}`);
  let hex = match[1].toLowerCase();
  if (hex.length < 5) hex = [...hex].map((digit) => digit + digit).join('');
  if (hex.length === 6) hex += 'ff';
  else if (format === 'electron') hex = hex.slice(2) + hex.slice(0, 2);
  return '#' + hex;
}
