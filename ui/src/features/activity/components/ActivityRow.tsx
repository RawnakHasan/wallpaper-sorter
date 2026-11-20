import type { ActivityEvent } from '../schemas';

function activityLabel(event: ActivityEvent) {
  if (event.kind === 'undo') return 'Undone';
  if (event.kind === 'rename') return 'Renamed';
  if (event.kind === 'duplicate') return 'Sent to Duplicates';
  if (event.note.startsWith('Deleted')) return 'Deleted';
  if (event.note.startsWith('Assigned')) return 'Assigned';
  return 'Sorted';
}

function activityPath(path: string, root: string) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path.split('/').pop() || path;
}

interface ActivityRowProps {
  event: ActivityEvent;
  root: string;
  onUndo: (id: number) => void;
  undoing: boolean;
}

export function ActivityRow({ event, root, onUndo, undoing }: ActivityRowProps) {
  return (
    <div className="act">
      <span className="t m">{new Date(event.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="k">{activityLabel(event)}</span>
      <span className="m grow" title={`${event.from} → ${event.to}`}>
        {activityPath(event.from, root)} → {activityPath(event.to, root)}
      </span>
      {event.undone ? <span className="badge">undone</span> : event.undoable ? (
        <button className="btn small" disabled={undoing} onClick={() => onUndo(event.id)}>Undo</button>
      ) : null}
    </div>
  );
}
