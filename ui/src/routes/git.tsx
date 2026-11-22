import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { commitGit, getGitLog, getGitStatus, pushGit } from '../features/git/api';
import { getStatus, statusQueryKey } from '../features/status/api';
import { useToastStore } from '../stores/toast';

interface GitPreferences {
  repository: string;
  remote: string;
  branch: string;
  excludeTrash: boolean;
}

function readPreferences(): GitPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem('ws-git-preferences') || '{}');
    return {
      repository: typeof saved.repository === 'string' ? saved.repository : '',
      remote: typeof saved.remote === 'string' ? saved.remote : 'origin',
      branch: typeof saved.branch === 'string' ? saved.branch : 'main',
      excludeTrash: saved.excludeTrash !== false,
    };
  } catch {
    return { repository: '', remote: 'origin', branch: 'main', excludeTrash: true };
  }
}

function GitPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [initial] = useState(readPreferences);
  const [repository, setRepository] = useState(initial.repository);
  const [remote, setRemote] = useState(initial.remote);
  const [branch, setBranch] = useState(initial.branch);
  const [excludeTrash, setExcludeTrash] = useState(initial.excludeTrash);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: getStatus,
  });
  useEffect(() => {
    if (!repository && statusQuery.data?.library) setRepository(statusQuery.data.library);
  }, [repository, statusQuery.data?.library]);

  const gitStatusQuery = useQuery({
    queryKey: ['git-status', repository],
    queryFn: () => getGitStatus(repository),
    enabled: repository.trim().length > 0,
    retry: false,
  });
  const gitLogQuery = useQuery({
    queryKey: ['git-log', repository],
    queryFn: () => getGitLog(repository, 300),
    enabled: repository.trim().length > 0,
    retry: false,
  });

  useEffect(() => {
    setBranch(gitStatusQuery.data?.branch || branch);
    setSelected(new Set());
  }, [gitStatusQuery.data?.branch]);

  const savePreferences = () => {
    try {
      localStorage.setItem('ws-git-preferences', JSON.stringify({
        repository,
        remote,
        branch,
        excludeTrash,
      }));
      if (excludeTrash && repository.trim()) {
        // This preference is browser-local until a Git settings endpoint exists.
      }
      showToast('Git settings saved');
      queryClient.invalidateQueries({ queryKey: ['git-status', repository] });
      queryClient.invalidateQueries({ queryKey: ['git-log', repository] });
    } catch {
      showToast('Could not save Git settings', { error: true });
    }
  };

  const refresh = async () => {
    await Promise.all([
      gitStatusQuery.refetch(),
      gitLogQuery.refetch(),
    ]);
  };

  const commitMutation = useMutation({
    mutationFn: () => commitGit(repository, [...selected], message.trim()),
    onSuccess: async (result) => {
      showToast(`Committed ${result.hash}`);
      setMessage('');
      setSelected(new Set());
      await refresh();
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), { error: true }),
  });
  const pushMutation = useMutation({
    mutationFn: () => pushGit(repository, remote.trim() || 'origin', gitStatusQuery.data?.branch || branch.trim() || 'main'),
    onSuccess: async (result) => {
      showToast(`Pushed ${result.pushed} commit${result.pushed === 1 ? '' : 's'} to ${result.remote}/${result.branch}`);
      await refresh();
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), { error: true }),
  });

  const changes = gitStatusQuery.data?.changes ?? [];
  const allSelected = changes.length > 0 && changes.every((change) => selected.has(change.path));
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(changes.map((change) => change.path)) : new Set());
  };
  const toggleChange = (path: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  };
  const commitsToPush = gitStatusQuery.data?.commits_to_push ?? 0;

  if (!repository && statusQuery.isPending) {
    return <div className="page"><p className="muted">Loading…</p></div>;
  }

  return (
    <div className="page git-page">
      <div className="page-head">
        <h1>Git</h1>
        <p className="sub">Commit and push your wallpaper folder when you choose. Nothing is committed on its own.</p>
      </div>
      <div className="git-settings-strip">
        <label>
          <span className="label">Repository folder</span>
          <input
            className="input mono"
            aria-label="Repository folder"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="~/Pictures/Wallpapers"
          />
        </label>
        <label>
          <span className="label">Remote URL</span>
          <input
            className="input mono"
            aria-label="Remote URL"
            value={remote}
            onChange={(event) => setRemote(event.target.value)}
            placeholder="origin"
          />
        </label>
        <label>
          <span className="label">Branch</span>
          <input
            className="input mono"
            aria-label="Branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="main"
          />
        </label>
        <label className="check-row git-exclude">
          <input
            type="checkbox"
            checked={excludeTrash}
            onChange={(event) => setExcludeTrash(event.target.checked)}
          />
          Leave out Trash and Duplicates
        </label>
        <button className="button button-primary" type="button" onClick={savePreferences}>Save Git settings</button>
      </div>

      {gitStatusQuery.isError ? (
        <div className="panel error-state" role="alert">
          <h2>Couldn’t read the repository</h2>
          <p className="mono">{gitStatusQuery.error instanceof Error ? gitStatusQuery.error.message : 'git status failed'}</p>
          <button className="button" type="button" onClick={() => { void refresh(); }}>Try again</button>
        </div>
      ) : gitStatusQuery.isPending ? (
        <div className="panel loading-skeleton" role="status">Loading Git status…</div>
      ) : (
        <>
          <section className="panel git-repository">
            <div className="row">
              <span className="mono grow">{gitStatusQuery.data?.repository ?? repository}</span>
              <span className="chip">{gitStatusQuery.data?.branch ?? branch}</span>
              <span className="chip">{gitStatusQuery.data?.remote ? 'origin' : 'No remote'}</span>
              <span className={`chip ${commitsToPush ? 'c-wn' : 'c-ok'}`}>
                {commitsToPush ? `${commitsToPush} to push` : 'Up to date'}
              </span>
              <button className="button ghost-button" type="button" onClick={() => { void refresh(); }}>Refresh</button>
            </div>
          </section>

          <h2 className="section-day">Changes</h2>
          {changes.length ? (
            <section className="panel git-batch">
              <div className="git-batch-head">
                <label className="check-row">
                  <input
                    type="checkbox"
                    aria-label="Select all changes"
                    checked={allSelected}
                    onChange={(event) => toggleAll(event.target.checked)}
                  />
                  Select all
                </label>
                <span className="sub">{selected.size} of {changes.length} selected</span>
              </div>
              {changes.map((change) => (
                <label className="git-change" key={`${change.status}-${change.path}`}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${change.path}`}
                    checked={selected.has(change.path)}
                    onChange={(event) => toggleChange(change.path, event.target.checked)}
                  />
                  <span className={`chip ${change.status === 'Deleted' ? 'c-bd' : change.status === 'Renamed' ? 'c-ac' : 'c-ok'}`}>
                    {change.status}
                  </span>
                  <span className="mono git-path">
                    {change.from ? `${change.from} → ` : ''}{change.path}
                  </span>
                </label>
              ))}
              <div className="git-commit-bar">
                <input
                  className="input grow"
                  aria-label="Commit message"
                  placeholder="Commit message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
                <button
                  className="button button-primary"
                  type="button"
                  disabled={selected.size === 0 || !message.trim() || commitMutation.isPending}
                  onClick={() => commitMutation.mutate()}
                >
                  Commit
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={selected.size === 0 || !message.trim() || commitMutation.isPending || pushMutation.isPending}
                  onClick={() => commitMutation.mutateAsync().then(() => pushMutation.mutate())}
                >
                  Commit and push
                </button>
              </div>
            </section>
          ) : (
            <div className="panel empty-state">
              <h2>Nothing to commit</h2>
              <p>Your folder matches the last commit.</p>
            </div>
          )}

          <div className="git-history-head">
            <h2 className="section-day">History</h2>
            <button
              className="button"
              type="button"
              disabled={commitsToPush === 0 || pushMutation.isPending}
              onClick={() => pushMutation.mutate()}
            >
              Push{commitsToPush ? ` ${commitsToPush} commit${commitsToPush === 1 ? '' : 's'}` : ''}
            </button>
          </div>
          <section className="panel git-batch">
            {gitLogQuery.isError ? (
              <p className="error" role="alert">
                {gitLogQuery.error instanceof Error ? gitLogQuery.error.message : 'Could not load history'}
              </p>
            ) : gitLogQuery.data?.items.length ? (
              gitLogQuery.data.items.map((item) => (
                <div className="git-log-row" key={item.hash}>
                  <span className="mono">{new Date(item.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`chip ${item.local ? 'c-wn' : 'c-ok'}`}>{item.local ? 'Local' : 'Pushed'}</span>
                  <span className="git-log-message">{item.message}</span>
                  <span className="mono">{item.hash}</span>
                </div>
              ))
            ) : (
              <p className="sub">No commits found.</p>
            )}
          </section>
          <p className="sub git-footer">
            Pushes use your system git and SSH keys. No password is stored here.
            {' '}Set repository details in <Link to="/settings">Settings</Link>.
          </p>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/git')({
  component: GitPage,
});
