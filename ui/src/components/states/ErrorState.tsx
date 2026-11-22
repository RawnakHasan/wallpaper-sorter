interface ErrorStateProps {
  title: string;
  error: unknown;
  onRetry?: () => void;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ErrorState({ title, error, onRetry }: ErrorStateProps) {
  return (
    <div className="state-error" role="alert">
      <h2>{title}</h2>
      <p className="mono">{messageOf(error)}</p>
      {onRetry ? (
        <button className="button" type="button" onClick={onRetry}>Try again</button>
      ) : null}
    </div>
  );
}
