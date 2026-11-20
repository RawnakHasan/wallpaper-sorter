import type { ResortItem } from '../schemas';

const kindLabels: Record<ResortItem['kind'], string> = {
  move: 'Move and rename',
  rename: 'Rename',
  duplicate: 'Duplicate',
  leave: 'Leave here',
  stay: 'Stays',
};

function itemPath(item: ResortItem) {
  return item.kind === 'move' || item.kind === 'rename' || item.kind === 'duplicate'
    ? item.from
    : item.path;
}

function itemDestination(item: ResortItem) {
  return item.kind === 'move' || item.kind === 'rename' || item.kind === 'duplicate' ? item.to : '';
}

function itemReason(item: ResortItem) {
  if (item.kind === 'leave') return item.reason;
  if (item.kind === 'duplicate') return item.duplicate_of;
  if (item.kind === 'move') return item.rule;
  return '';
}

function relativePath(path: string, library: string) {
  return library && path.startsWith(`${library}/`) ? path.slice(library.length + 1) : path;
}

export function ResortList({ items, library }: { items: ResortItem[]; library: string }) {
  const shown = items.slice(0, 200);
  return (
    <div className="resort-list">
      {shown.map((item, index) => {
        const from = relativePath(itemPath(item), library);
        const to = itemDestination(item);
        const detail = to ? `${from} → ${to}` : from;
        const reason = itemReason(item);
        const tone = item.kind === 'leave' ? 'warn' : item.kind === 'duplicate' ? 'bad' : 'good';
        return (
          <div className="resort-row" key={`${item.kind}-${itemPath(item)}-${index}`}>
            <span className={`badge ${tone}`}>{kindLabels[item.kind]}</span>
            <span className="m grow">{detail}</span>
            {reason ? <span className="muted">{reason}</span> : null}
          </div>
        );
      })}
      {items.length > shown.length ? <p className="muted">and {items.length - shown.length} more</p> : null}
    </div>
  );
}
