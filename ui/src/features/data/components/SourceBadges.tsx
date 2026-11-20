import type { OriginSource } from '../schemas';

interface SourceBadgesProps {
  sources: OriginSource[];
}

export function SourceBadges({ sources }: SourceBadgesProps) {
  const shown = sources.filter((source) => source.site !== 'Unknown');
  return shown.length
    ? shown.map((source, index) => (
      <span className="badge" key={`${source.site}-${source.id}-${index}`}>
        {source.id ? `${source.site} ${source.id}` : source.site}
      </span>
    ))
    : <span className="badge">Unknown source</span>;
}
