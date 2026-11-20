import { useState } from 'react';
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
}

interface ImageGridProps {
  items: GridItem[];
  onSelectionChange?: () => void;
}

const CHUNK_SIZE = 240;

export function ImageGrid({ items, onSelectionChange }: ImageGridProps) {
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
              onClick={(event) => toggle(item, event.shiftKey)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  toggle(item, event.shiftKey);
                }
              }}
            >
              <Thumb hash={item.hash ?? ''} alt={item.name} refreshKey={item.thumbVersion ?? 0} />
              {item.label ? <span className={`label ${item.labelClass ?? ''}`} title={item.title}>{item.label}</span> : null}
              <span className="check">✓</span>
              <button
                className="open"
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
              <div className="cap">
                <span className="m">{item.name}</span>
                {item.sub ? <span className="m">{item.sub}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      {remaining > 0 ? (
        <div className="more">
          <button className="btn" onClick={() => setShown((count) => Math.min(items.length, count + CHUNK_SIZE))}>
            Show {Math.min(CHUNK_SIZE, remaining)} more ({remaining} not shown)
          </button>
        </div>
      ) : null}
    </div>
  );
}
