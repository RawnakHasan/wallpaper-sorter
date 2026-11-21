import { messageOf } from '../../inbox/utils';
import { useFetchPanel } from '../hooks/useFetchPanel';

const stateLabels = {
  queued: 'Queued',
  downloading: 'Downloading',
  sorted: 'Sorted',
  inbox: 'Inbox',
  duplicate: 'Duplicate',
  error: 'Error',
} as const;

export function FetchPanel() {
  const {
    site,
    setSite,
    input,
    setInput,
    submit,
    busy,
    submitMutation,
    jobQuery,
  } = useFetchPanel();

  return (
    <section className="panel">
      <h2>Fetch from Wallhaven or Danbooru</h2>
      <p className="muted">Paste one post ID or link per line. Links identify their site automatically.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="row">
          <label className="field">
            <span className="lbl">Site for bare IDs</span>
            <select
              className="select"
              aria-label="Site for bare IDs"
              value={site}
              disabled={busy}
              onChange={(event) => setSite(event.currentTarget.value as typeof site)}
            >
              <option value="Wallhaven">Wallhaven</option>
              <option value="Danbooru">Danbooru</option>
            </select>
          </label>
          <label className="field fetch-input-field">
            <span className="lbl">Post IDs or links</span>
            <textarea
              className="input fetch-textarea"
              aria-label="Post IDs or links"
              rows={3}
              maxLength={20_000}
              value={input}
              disabled={busy}
              placeholder={'abc123\nhttps://danbooru.donmai.us/posts/123456'}
              onChange={(event) => setInput(event.currentTarget.value)}
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
      </form>
      {submitMutation.error ? <p className="error" role="alert">{messageOf(submitMutation.error)}</p> : null}
      {jobQuery.error ? (
        <div>
          <p className="error" role="alert">{messageOf(jobQuery.error)}</p>
          <button className="btn small" type="button" onClick={() => { void jobQuery.refetch(); }}>Retry status</button>
        </div>
      ) : null}
      {jobQuery.data ? (
        <ul className="fetch-results">
          {jobQuery.data.items.map((item, index) => (
            <li key={`${item.input}-${index}`}>
              <span className={`tagchip fetch-state-${item.state}`}>{stateLabels[item.state]}</span>
              <span className="m">{item.input}</span>
              <span className="muted">{item.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
