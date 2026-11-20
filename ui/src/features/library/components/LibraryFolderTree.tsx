import type { DragEvent } from 'react';
import type { LibraryFolder } from '../schemas';

interface LibraryFolderTreeProps {
  folders: LibraryFolder[];
  currentFolder: string;
  dropTarget: string | null;
  onDragEnter: (folder: string) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>, folder: string) => void;
  onDragLeave: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>, folder: string) => void;
  onPrefetch: (folder: string) => void;
  onSelect: (folder: string) => void;
}

export function LibraryFolderTree({
  folders,
  currentFolder,
  dropTarget,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onPrefetch,
  onSelect,
}: LibraryFolderTreeProps) {
  return (
    <nav className="tree" aria-label="Folders">
      {folders.map((folder) => {
        const depth = folder.path.split('/').length - 1;
        return (
          <button
            key={folder.path}
            className={`${folder.path === currentFolder ? 'on' : ''}${dropTarget === folder.path ? ' drop-target' : ''}`}
            aria-current={folder.path === currentFolder ? 'true' : undefined}
            style={{ paddingLeft: 8 + depth * 14 }}
            onDragEnter={() => onDragEnter(folder.path)}
            onDragOver={(event) => onDragOver(event, folder.path)}
            onDragLeave={onDragLeave}
            onDrop={(event) => onDrop(event, folder.path)}
            onPointerEnter={() => onPrefetch(folder.path)}
            onFocus={() => onPrefetch(folder.path)}
            onClick={() => onSelect(folder.path)}
          >
            <span>{folder.name}</span>
            <span className="count">{folder.count}</span>
          </button>
        );
      })}
    </nav>
  );
}
