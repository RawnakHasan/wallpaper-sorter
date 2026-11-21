import { Fragment, useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import { OriginSourceEditor } from '../../data/components/OriginSourceEditor';
import type { OriginLookupRequest, Site } from '../../data/schemas';
import type { InboxItem } from '../schemas';
import { formatDateTime, reasonLabels, safeUrl } from '../utils';

function artistNameFromTag(tag: string) {
  const match = /^(.*?)\s+\(artist\)$/i.exec(tag);
  return match?.[1].trim() || null;
}

interface InboxDetailProps {
  item: InboxItem;
  pending: boolean;
  onClose: () => void;
  onAssign: () => void;
  onAssignCandidate: (folder: string) => void;
  onDelete: () => void;
  onRebuild: (hash: string) => void;
  onCreateTag: (keywords: string[]) => void;
  sourcePending: boolean;
  onSaveSource: (request: { hash: string; site: Site; id: string }) => void;
  onLookupSource: (request: OriginLookupRequest) => void;
}

export function InboxDetail({
  item,
  pending,
  onClose,
  onAssign,
  onAssignCandidate,
  onDelete,
  onRebuild,
  onCreateTag,
  sourcePending,
  onSaveSource,
  onLookupSource,
}: InboxDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const origin = item.origin;
  const sourceArtists = origin?.sources.flatMap((source) => source.artist
    ? [{ name: source.artist, id: source.artist_id ?? null, site: source.site }]
    : []) ?? [];
  const taggedArtists = (origin?.tags ?? [])
    .map(artistNameFromTag)
    .filter((name): name is string => name !== null)
    .map((name) => ({ name, id: null, site: null }));
  const artists = [...new Map(
    [...sourceArtists, ...taggedArtists].map((artist) => [artist.name.toLowerCase(), artist]),
  ).values()];
  const siteTags = [...new Set(origin?.tags ?? [])].filter((tag) => !artistNameFromTag(tag));
  useNativeDialog(dialogRef);

  const rows: Array<[string, string]> = [
    ['File', item.name],
    ['Waiting because', reasonLabels[item.reason]],
    ['Folder', item.intake === 'library' ? 'the library folder' : item.intake],
  ];
  if (origin) {
    rows.push(['Original name', origin.original_name]);
    if (origin.width) rows.push(['Resolution', `${origin.width} × ${origin.height}`]);
    rows.push(['Added', formatDateTime(origin.added)]);
    if (origin.note) rows.push(['Why here', origin.note]);
    if (origin.rating) rows.push(['Content rating', origin.rating]);
  }

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag)
      ? current.filter((value) => value !== tag)
      : [...current, tag]);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={item.name}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <header>
        <h2>{item.name}</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        {origin ? <img className="preview" src={`/api/image/${origin.hash}`} alt={item.name} /> : null}
        <div className="kv">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <div>{label}</div>
              <div className="m">{value}</div>
            </Fragment>
          ))}
        </div>
        {origin?.sources.map((source, index) => {
          const url = safeUrl(source.url ?? '');
          return (
            <div className="kv" key={`${source.site}-${source.id}-${index}`}>
              <div>Source</div>
              <div>
                <span className="badge">{source.site}</span>
                {source.id ? <> <span className="m">{source.id}</span></> : null}
                {url ? <> <a href={url} target="_blank" rel="noopener noreferrer">open page</a></> : null}
              </div>
            </div>
          );
        })}
        {origin ? (
          <OriginSourceEditor
            hash={origin.hash}
            source={origin.sources[0]}
            pending={sourcePending}
            onSave={onSaveSource}
            onLookup={onLookupSource}
          />
        ) : null}
        {item.candidates.length ? (
          <section className="metadata-section">
            <h3>Possible destinations</h3>
            <div className="row">
              {item.candidates.map((candidate) => (
                <button
                  className="btn small"
                  type="button"
                  key={candidate.folder}
                  onClick={() => onAssignCandidate(candidate.folder)}
                >
                  {candidate.folder} (from {candidate.matched.map((tag) => `"${tag}"`).join(', ')})
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {artists.length ? (
          <section className="metadata-section">
            <h3>Artist</h3>
            <div className="metadata-artists">
              {artists.map((source, index) => (
                <div className="metadata-artist" key={`${source.site ?? 'tag'}-${source.id ?? source.name}-${index}`}>
                  <button
                    className={`tagchip site-tag-chip${selectedTags.includes(source.name) ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={selectedTags.includes(source.name)}
                    onClick={() => toggleTag(source.name)}
                  >
                    {source.name}
                    {source.id ? <>{' '}<span className="m muted">({source.id})</span></> : null}
                  </button>
                  {source.site ? <span className="badge">{source.site}</span> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {siteTags.length ? (
          <section className="metadata-section">
            <h3>Site tags</h3>
            <div className="site-tags">
              {siteTags.map((tag) => {
                const selected = selectedTags.includes(tag);
                return (
                  <button
                    className={`tagchip site-tag-chip${selected ? ' selected' : ''}`}
                    type="button"
                    key={tag}
                    aria-pressed={selected}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
        {selectedTags.length ? (
          <button
            className="btn small primary"
            type="button"
            onClick={() => onCreateTag(selectedTags)}
          >
            Assign with selected tags ({selectedTags.length})…
          </button>
        ) : null}
      </div>
      <footer>
        {origin?.hash ? <button className="btn" type="button" onClick={() => onRebuild(origin.hash)}>Rebuild thumbnail</button> : null}
        <button className="btn primary" type="button" onClick={onAssign}>Assign…</button>
        <button className="btn danger" type="button" onClick={onDelete}>Delete</button>
      </footer>
    </dialog>
  );
}
