import { useEffect, useState } from 'react';
import { Folder, ChevronRight, FileText } from 'lucide-react';
import { type Project, type FileItem } from '../../shared/types';
import { readableError } from '../lib/format';
const api = window.desktop;

export function FileTree({
  project,
  directory = '',
  depth = 0,
  onSelect,
}: {
  project: Project;
  directory?: string;
  depth?: number;
  onSelect: (name: string) => void;
}) {
  const [items, setItems] = useState<FileItem[]>([]),
    [open, setOpen] = useState<string[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api
      .invoke('files', project.id, directory)
      .then((v) => {
        if (alive) {
          setItems(v);
          setError('');
        }
      })
      .catch((e) => alive && setError(readableError(e)));
    return () => {
      alive = false;
    };
  }, [project.id, directory]);
  return (
    <div className="file-tree">
      {error && <p className="inline-error">{error}</p>}
      {!items.length && !error && <p className="empty-small">{depth ? '空文件夹' : '没有可显示的文件'}</p>}
      {items.map((item) => (
        <div key={item.path}>
          <button
            className="file-row"
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() =>
              item.directory
                ? setOpen((v) =>
                    v.includes(item.path) ? v.filter((x) => x !== item.path) : [...v, item.path],
                  )
                : onSelect(item.path)
            }
          >
            {item.directory ? (
              <>
                <ChevronRight size={12} className={open.includes(item.path) ? 'rotated' : ''} />
                <Folder size={14} />
              </>
            ) : (
              <>
                <span className="tree-indent" />
                <FileText size={14} />
              </>
            )}
            <span>{item.name}</span>
          </button>
          {item.directory && open.includes(item.path) && (
            <FileTree project={project} directory={item.path} depth={depth + 1} onSelect={onSelect} />
          )}
        </div>
      ))}
    </div>
  );
}
