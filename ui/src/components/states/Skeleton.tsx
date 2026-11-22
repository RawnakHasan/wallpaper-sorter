interface SkeletonProps {
  rows?: number;
  label?: string;
}

export function Skeleton({ rows = 4, label = 'Loading' }: SkeletonProps) {
  return (
    <div className="state-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="state-skeleton-row" key={index} />
      ))}
    </div>
  );
}
