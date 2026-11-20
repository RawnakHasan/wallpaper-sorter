interface WatchedEntryProps {
  path: string;
  badges: Array<[string, string?]>;
  message?: string | null;
}

export function WatchedEntry({ path, badges, message }: WatchedEntryProps) {
  return (
    <div className="watched-entry" key={path}>
      <span className="m watched-path">{path}</span>
      <span className="watched-badges">
        {badges.map(([label, tone]) => <span className={`badge${tone ? ` ${tone}` : ''}`} key={label}>{label}</span>)}
      </span>
      {message ? <p className="error">{message}</p> : null}
    </div>
  );
}
