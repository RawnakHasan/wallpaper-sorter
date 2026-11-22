import { useState, type DragEvent } from 'react';
import { flushSync } from 'react-dom';
import { useSelectionStore } from '../stores/selection';
import { Icon } from './Icon';
import { Thumb } from './Thumb';

export interface GridItem {
  key: string;
  hash: string | null;
  thumbVersion?: number;
  name: string;
  sub?: string;
  label?: string;
  labelClass?: string;
  title?: string;
  onOpen: () => void;
  onExpand?: () => void;
}

interface ImageGridProps {
  items: GridItem[];
  onSelectionChange?: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>, item: GridItem) => void;
  onDragEnd?: () => void;
}

const CHUNK_SIZE = 240;

export function ImageGrid({ items, onSelectionChange, onDragStart, onDragEnd }: ImageGridProps) {
  const keys = useSelectionStore((state) => state.keys);
  const [shown, setShown] = useState(Math.min(CHUNK_SIZE, items.length));

  const toggle = (item: GridItem, shiftKey: boolean) => {
    const state = useSelectionStore.getState();
    const next = new Set(state.keys);
    if (shiftKey && state.last !== null) {
      const start = items.findIndex((entry) => entry.key === state.last);
      const end = items.findIndex((entry) => entry.key === item.key);
      if (start >= 0 && end >= 0) {
        items.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((entry) => next.add(entry.key));
      }
    } else if (next.has(item.key)) {
      next.delete(item.key);
    } else {
      next.add(item.key);
    }
    flushSync(() => useSelectionStore.setState({ keys: next, last: item.key }));
    onSelectionChange?.();
  };

  const visible = items.slice(0, shown);
  const remaining = items.length - shown;

  return (
    <div className="grid-scroll">
      <div className="grid" role="list">
        {visible.map((item) => {
          const selected = keys.has(item.key);
          return (
            <div
              className={`cell${selected ? ' sel' : ''}${item.hash ? ' loading' : ''}`}
              key={item.key}
              role="listitem"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={item.name}
              draggable={!!onDragStart}
              onDragStart={onDragStart ? (event) => onDragStart(event, item) : undefined}
              onDragEnd={onDragEnd}
              onClick={(event) => toggle(item, event.shiftKey)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  toggle(item, event.shiftKey);
                  return;
                }
                const keys = visible.map((entry) => entry.key);
                const index = keys.indexOf(item.key);
                const firstRow = visible.filter((entry) => {
                  const element = document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(entry.name)}"]`);
                  const current = document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(item.name)}"]`);
                  return element && current && element.offsetTop === current.offsetTop;
                }).length;
                const columns = Math.max(1, firstRow);
                let targetIndex: number | null = null;
                if (event.key === 'ArrowRight') targetIndex = index + 1;
                if (event.key === 'ArrowLeft') targetIndex = index - 1;
                if (event.key === 'ArrowDown') targetIndex = index + columns;
                if (event.key === 'ArrowUp') targetIndex = index - columns;
                if (event.key === 'Home') targetIndex = 0;
                if (event.key === 'End') targetIndex = visible.length - 1;
                if (targetIndex !== null) {
                  event.preventDefault();
                  if (targetIndex < 0 || targetIndex >= visible.length) return;
                  const target = visible[targetIndex];
                  const targetElement = event.currentTarget.parentElement?.querySelector<HTMLElement>(
                    `[aria-label="${CSS.escape(target.name)}"]`,
                  );
                  if (event.shiftKey) {
                    const state = useSelectionStore.getState();
                    const anchorIndex = state.last ? visible.findIndex((entry) => entry.key === state.last) : index;
                    const start = Math.max(0, anchorIndex >= 0 ? Math.min(anchorIndex, targetIndex) : targetIndex);
                    const end = Math.min(visible.length - 1, anchorIndex >= 0 ? Math.max(anchorIndex, targetIndex) : targetIndex);
                    const next = new Set(state.keys);
                    visible.slice(start, end + 1).forEach((entry) => next.add(entry.key));
                    useSelectionStore.setState({ keys: next, last: target.key });
                    onSelectionChange?.();
                  }
                  targetElement?.focus();
                  return;
                }
                if (event.key.toLowerCase() === 'x') {
                  event.preventDefault();
                  toggle(item, event.shiftKey);
                  return;
                }
                if (event.key.toLowerCase() === 'i') {
                  event.preventDefault();
                  item.onOpen();
                } else if (event.key.toLowerCase() === 'v' && item.onExpand) {
                  event.preventDefault();
                  item.onExpand();
                }
              }}
            >
              <Thumb hash={item.hash ?? ''} alt={item.name} refreshKey={item.thumbVersion ?? 0} />
              {item.label ? <span className={`label ${item.labelClass ?? ''}`} title={item.title}>{item.label}</span> : null}
              <span className="check">✓</span>
              <button
                className="open details"
                type="button"
                aria-label={`Details of ${item.name}`}
                title="Details"
                onClick={(event) => {
                  event.stopPropagation();
                  item.onOpen();
                }}
              >
                <Icon name="info" />
              </button>
              {item.onExpand ? (
                <button
                  className="open expand"
                  type="button"
                  aria-label={`View ${item.name} full screen`}
                  title="View full screen"
                  onClick={(event) => {
                    event.stopPropagation();
                    item.onExpand?.();
                  }}
                >
                  <Icon name="expand" />
                </button>
              ) : null}
              <div className="cap">
                <span className="m">{item.name}</span>
                {item.sub ? <span className="m">{item.sub}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="more">
        {remaining > 0 ? (
          <button className="btn" onClick={() => setShown((count) => Math.min(items.length, count + CHUNK_SIZE))}>
            Show {Math.min(CHUNK_SIZE, remaining)} more ({remaining} not shown)
          </button>
        ) : null}
      </div>
    </div>
  );
}
