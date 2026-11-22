import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getStatus, statusQueryKey } from '../status/api';
import { useToastStore } from '../../stores/toast';
import { activityQueryKey, getActivity, undoActivity } from './api';
import type { ActivityEvent, UndoRequest } from './schemas';
import { ActivityRow } from './components/ActivityRow';

const ACTIVITY_LIMIT = 300;

function dayLabel(time: number) {
  return new Date(time * 1000).toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function groupByDayAndBatch(events: ActivityEvent[]) {
  const days: Array<{ date: string; batches: ActivityEvent[][] }> = [];
  for (let index = 0; index < events.length;) {
    const date = dayLabel(events[index].time);
    if (days[days.length - 1]?.date !== date) days.push({ date, batches: [] });
    let end = index + 1;
    while (
      end < events.length
      && events[end].batch === events[index].batch
      && dayLabel(events[end].time) === date
    ) end += 1;
    days[days.length - 1].batches.push(events.slice(index, end));
    index = end;
  }
  return days;
}

export function ActivityPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const activityQuery = useQuery({
    queryKey: activityQueryKey(ACTIVITY_LIMIT),
    queryFn: () => getActivity(ACTIVITY_LIMIT),
  });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const undoMutation = useMutation({
    mutationFn: (request: UndoRequest) => undoActivity(request),
    onSuccess: async () => {
      showToast('Undone');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: statusQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ]);
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const error = activityQuery.error ?? statusQuery.error;
  if (error) {
    return (
      <div className="page activity-page">
        <p className="error" role="alert">{messageOf(error)}</p>
        <button className="btn" onClick={() => { void activityQuery.refetch(); void statusQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!activityQuery.data || !statusQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const events = activityQuery.data;
  const days = groupByDayAndBatch(events);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Activity</h1>
        {events.length ? <span className="sub">Everything the sorter did, newest first</span> : null}
      </div>
      {events.length ? (
        <>
          {days.map((day) => (
            <section key={day.date}>
              <div className="day">{day.date}</div>
              {day.batches.map((batch) => {
                const undoable = batch.some((event) => event.undoable);
                const first = batch[0];
                const batchKey = first.batch || first.id;
                const batchId = first.batch;
                return (
                  <div className="batch" key={batchKey}>
                    {batch.length > 1 || undoable ? (
                      <div className="batch-head">
                        <span>{batch.length} {batch.length === 1 ? 'action' : 'actions'}</span>
                        <span className="spacer" />
                        {undoable && batch.length > 1 && batchId !== null ? (
                          <button
                            className="btn small"
                            disabled={undoMutation.isPending}
                            onClick={() => undoMutation.mutate({ batch: batchId })}
                          >
                            Undo all
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {batch.map((event) => (
                      <ActivityRow
                        key={event.id}
                        event={event}
                        root={statusQuery.data.library}
                        onUndo={(id) => undoMutation.mutate({ id })}
                        undoing={undoMutation.isPending}
                      />
                    ))}
                  </div>
                );
              })}
            </section>
          ))}
          <p className="faint">The log keeps recent entries. Where each image came from is kept for good, on the Data page.</p>
        </>
      ) : <div className="empty"><b>Nothing yet</b>Every move and rename is listed here and can be undone.</div>}
    </div>
  );
}
