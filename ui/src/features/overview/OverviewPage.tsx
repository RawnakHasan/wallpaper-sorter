import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { activityQueryKey, getActivity, undoActivity } from '../activity/api';
import { getStatus, statusQueryKey, updateSettings } from '../status/api';
import { useToastStore } from '../../stores/toast';
import { ActivityRow } from '../activity/components/ActivityRow';
import { WatchedEntry } from './components/WatchedEntry';

const RECENT_ACTIVITY_LIMIT = 8;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function OverviewPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const activityQuery = useQuery({
    queryKey: activityQueryKey(RECENT_ACTIVITY_LIMIT),
    queryFn: () => getActivity(RECENT_ACTIVITY_LIMIT),
  });
  const undoMutation = useMutation({
    mutationFn: (id: number) => undoActivity({ id }),
    onSuccess: async () => {
      showToast('Undone');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: statusQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ]);
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const setupMutation = useMutation({
    mutationFn: () => updateSettings({ setup_complete: true }),
    onSuccess: async () => {
      showToast('Setup complete');
      await queryClient.invalidateQueries({ queryKey: statusQueryKey });
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const error = statusQuery.error ?? activityQuery.error;
  if (error) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(error)}</p>
        <button className="btn" onClick={() => { void statusQuery.refetch(); void activityQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!statusQuery.data || !activityQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const status = statusQuery.data;
  const activity = activityQuery.data;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Overview</h1>
        <span className="sub">{status.counts.library_images} images in {status.library}</span>
        <span className="spacer" />
        <Link className="btn" to="/resort">Re-sort library</Link>
      </div>
      <div className="stats">
        <Link className="stat" to="/inbox"><div className="n">{status.counts.inbox}</div><div className="l">waiting in the Inbox</div></Link>
        <Link className="stat" to="/library"><div className="n">{status.counts.library_images}</div><div className="l">images in the library</div></Link>
        <Link className="stat" to="/duplicates"><div className="n">{status.counts.duplicates}</div><div className="l">in Duplicates</div></Link>
        <Link className="stat" to="/data"><div className="n">{status.counts.records}</div><div className="l">records of where images came from</div></Link>
      </div>
      <h3>Recent activity</h3>
      {activity.length ? (
        <div className="batch">
          {activity.map((event) => (
            <ActivityRow
              key={event.id}
              event={event}
              root={status.library}
              onUndo={(id) => undoMutation.mutate(id)}
              undoing={undoMutation.isPending}
            />
          ))}
        </div>
      ) : <div className="empty"><b>Nothing yet</b>Sorted images show up here, with an Undo button.</div>}
      <h3>Watched folders</h3>
      <div className="panel watched-folders">
        <div className="watched-list">
          <WatchedEntry path={status.library} badges={ [['library, top level', 'good']] } />
          {status.intake.map((intake) => (
            <WatchedEntry
              key={intake.path}
              path={intake.path}
              badges={[
                [intake.watching ? 'watching' : intake.exists ? 'not watching' : 'folder not found yet', intake.watching ? 'good' : 'warn'],
                ...(intake.recursive ? [['includes subfolders', ''] as [string, string]] : []),
              ]}
              message={intake.error}
            />
          ))}
        </div>
      </div>
      {!status.setup_complete ? (
        <div className="panel welcome">
          <h3>Welcome to Wallpaper Sorter</h3>
          <p className="muted">Library: {status.library}</p>
          <button className="btn primary" disabled={setupMutation.isPending} onClick={() => setupMutation.mutate()}>
            Finish setup
          </button>
        </div>
      ) : null}
    </div>
  );
}
