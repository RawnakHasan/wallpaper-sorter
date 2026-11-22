import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { activityQueryKey, getActivity, undoActivity } from '../activity/api';
import { getStatus, statusQueryKey, updateSettings } from '../status/api';
import { useToastStore } from '../../stores/toast';
import { ActivityRow } from '../activity/components/ActivityRow';
import { FetchPanel } from '../fetch/components/FetchPanel';
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
        <Link className="button button-primary" to="/resort">Re-sort library</Link>
      </div>
      <div className="overview-layout">
        <div className="overview-left">
          <FetchPanel />
          <section className="panel recent-activity">
            <h2>Recent activity</h2>
            {activity.length ? (
              <div className="activity-list">
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
            ) : (
              <div className="empty compact-empty">
                <b>Nothing yet</b>
                Sorted images show up here, with an Undo button.
              </div>
            )}
          </section>
        </div>
        <aside className="overview-right">
          <div className="count-grid">
            <Link className="count-card count-inbox" to="/inbox">
              <b className="count-number">{status.counts.inbox}</b>
              <span>Inbox waiting</span>
            </Link>
            <Link className="count-card count-library" to="/library">
              <b className="count-number">{status.counts.library_images}</b>
              <span>Library images</span>
            </Link>
            <Link className="count-card count-duplicates" to="/duplicates">
              <b className="count-number">{status.counts.duplicates}</b>
              <span>Duplicates</span>
            </Link>
            <Link className="count-card count-data" to="/data">
              <b className="count-number">{status.counts.records}</b>
              <span>Data records</span>
            </Link>
          </div>
          <section className="panel watched-folders">
            <h2>Watched folders</h2>
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
          </section>
        </aside>
      </div>
      {!status.setup_complete ? (
        <div className="panel welcome">
          <h2>Welcome to Wallpaper Sorter</h2>
          <p className="sub">Library: <span className="mono">{status.library}</span></p>
          <button className="button button-primary" disabled={setupMutation.isPending} onClick={() => setupMutation.mutate()}>
            Finish setup
          </button>
        </div>
      ) : null}
    </div>
  );
}
