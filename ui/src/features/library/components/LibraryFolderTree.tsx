import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [logos, setLogos] = useState<Record<string, { dataUrl: string; tint: boolean }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ws-folder-logos') || '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    const refresh = () => {
      try {
        setLogos(JSON.parse(localStorage.getItem('ws-folder-logos') || '{}'));
      } catch {
        setLogos({});
      }
    };
    window.addEventListener('ws-folder-logo-changed', refresh);
    return () => window.removeEventListener('ws-folder-logo-changed', refresh);
  }, []);
  const visibleFolders = useMemo(() => folders.filter((folder) => {
    const parts = folder.path.split('/');
    for (let index = parts.length - 1; index > 0; index -= 1) {
      const parent = parts.slice(0, index).join('/');
      if (collapsed.has(parent)) return false;
    }
    return true;
  }), [collapsed, folders]);

  useEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-folder-path="${CSS.escape(currentFolder)}"]`);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest' });
    }
  }, [currentFolder, visibleFolders]);

  const toggleFolder = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, folder: LibraryFolder) => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tree-folder'));
    const index = buttons.indexOf(event.currentTarget);
    if (event.key === 'ArrowDown' && buttons[index + 1]) {
      event.preventDefault();
      buttons[index + 1].focus();
    } else if (event.key === 'ArrowUp' && buttons[index - 1]) {
      event.preventDefault();
      buttons[index - 1].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      buttons[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      buttons.at(-1)?.focus();
    } else if (event.key === 'ArrowRight') {
      const hasChildren = folders.some((entry) => entry.path.startsWith(`${folder.path}/`));
      if (hasChildren && collapsed.has(folder.path)) {
        event.preventDefault();
        toggleFolder(folder.path);
      }
    } else if (event.key === 'ArrowLeft') {
      const hasChildren = folders.some((entry) => entry.path.startsWith(`${folder.path}/`));
      if (hasChildren && !collapsed.has(folder.path)) {
        event.preventDefault();
        toggleFolder(folder.path);
      } else if (folder.path.includes('/')) {
        event.preventDefault();
        const parent = folder.path.slice(0, folder.path.lastIndexOf('/'));
        document.querySelector<HTMLButtonElement>(`[data-folder-path="${CSS.escape(parent)}"]`)?.focus();
      }
    }
  };

  return (
    <nav className="tree" aria-label="Folders" role="tree">
      {visibleFolders.map((folder) => {
        const depth = folder.path.split('/').length - 1;
        const hasChildren = folders.some((entry) => entry.path.startsWith(`${folder.path}/`));
        const isOpen = hasChildren && !collapsed.has(folder.path);
        return (
          <button
            key={folder.path}
            className={`tree-folder depth-${depth}${folder.path === currentFolder ? ' on' : ''}${dropTarget === folder.path ? ' drop-target' : ''}`}
            aria-current={folder.path === currentFolder ? 'true' : undefined}
            aria-expanded={hasChildren ? isOpen : undefined}
            data-folder-path={folder.path}
            role="treeitem"
            tabIndex={folder.path === currentFolder ? 0 : -1}
            onDragEnter={() => onDragEnter(folder.path)}
            onDragOver={(event) => onDragOver(event, folder.path)}
            onDragLeave={onDragLeave}
            onDrop={(event) => onDrop(event, folder.path)}
            onPointerEnter={() => onPrefetch(folder.path)}
            onFocus={() => onPrefetch(folder.path)}
            onClick={() => onSelect(folder.path)}
            onKeyDown={(event) => onTreeKeyDown(event, folder)}
          >
            <span className="tree-guides" aria-hidden="true">
              {Array.from({ length: depth }, (_, index) => (
                <span className={`tree-guide guide-${index % 4}${index === depth - 1 ? ' active-guide' : ''}`} key={index} />
              ))}
            </span>
            {hasChildren ? (
              <span
                className="tree-chevron"
                role="button"
                tabIndex={-1}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${folder.path}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFolder(folder.path);
                }}
              >
                <ChevronRight className={isOpen ? 'chevron-open' : ''} />
              </span>
            ) : <span className="tree-chevron-placeholder" />}
            {isOpen ? <FolderOpen className="tree-folder-icon" /> : <Folder className="tree-folder-icon" />}
            {logos[folder.path] ? (
              <img
                className={`tree-folder-logo${logos[folder.path].tint ? ' tint' : ''}`}
                src={logos[folder.path].dataUrl}
                alt={folder.name}
              />
            ) : <span className="tree-folder-name">{folder.name}</span>}
            <span className="mono tree-folder-count">{folder.count}</span>
          </button>
        );
      })}
    </nav>
  );
}
