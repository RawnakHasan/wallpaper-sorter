import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNativeDialog } from '../../../components/useNativeDialog';
import { searchPostDetails } from '../api';
import type { SearchSite } from '../schemas';

type SearchItem = {
  id: string;
  url: string;
  rating: string;
  tags: string[];
  preview: string;
  image_url: string | null;
};

interface SearchImageSheetProps {
  site: SearchSite;
  item: SearchItem;
  onClose: () => void;
}

export function SearchImageSheet({ site, item, onClose }: SearchImageSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeDialog(dialogRef);
  const detailsQuery = useQuery({
    queryKey: ['site-search-details', site, item.id],
    queryFn: () => searchPostDetails(site, item.id),
    enabled: site === 'Wallhaven',
    retry: false,
  });
  const tags = detailsQuery.data?.tags ?? item.tags;

  return (
    <dialog
      ref={dialogRef}
      className="sheet search-detail-sheet"
      aria-label={`Post ${item.id}`}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{site} post {item.id}</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <div className="content">
        <img className="search-detail-image" src={item.preview} alt={`${site} post ${item.id}`} />
        <div className="row">
          <span className="badge">{item.rating}</span>
          <span className="spacer" />
          {item.image_url ? (
            <a className="btn small" href={item.image_url} target="_blank" rel="noopener noreferrer">
              Open full-size image
            </a>
          ) : null}
          <a className="btn small" href={item.url} target="_blank" rel="noopener noreferrer">
            Open post
          </a>
        </div>
        {detailsQuery.isError ? (
          <p className="error" role="alert">
            {detailsQuery.error instanceof Error ? detailsQuery.error.message : String(detailsQuery.error)}
          </p>
        ) : null}
        {detailsQuery.isLoading ? <p className="muted" role="status">Loading tags…</p> : null}
        {tags.length ? (
          <div className="search-tags">
            {tags.map((tag) => <span className="tagchip" key={tag}>{tag}</span>)}
          </div>
        ) : !detailsQuery.isLoading ? (
          <p className="muted">No tags returned</p>
        ) : null}
      </div>
    </dialog>
  );
}
