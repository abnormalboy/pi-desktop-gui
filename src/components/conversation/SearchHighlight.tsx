export function SearchHighlight({
  text,
  query,
  activeStart,
}: {
  text: string;
  query?: string;
  activeStart?: number;
}) {
  if (!query) return <>{text}</>;
  const lower = text.toLocaleLowerCase(),
    needle = query.toLocaleLowerCase();
  const nodes = [];
  let previous = 0;
  for (let start = lower.indexOf(needle); start >= 0; start = lower.indexOf(needle, start + needle.length)) {
    nodes.push(
      text.slice(previous, start),
      <mark key={start} className={start === activeStart ? 'search-current' : undefined}>
        {text.slice(start, start + needle.length)}
      </mark>,
    );
    previous = start + needle.length;
  }
  nodes.push(text.slice(previous));
  return <>{nodes}</>;
}
