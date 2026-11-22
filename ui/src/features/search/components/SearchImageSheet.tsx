import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import { searchPostDetails } from '../api';
import type { SearchResults, SearchSite } from '../schemas';

type SearchItem = SearchResults['items'][number];

interface SearchImageSheetProps {
  site: SearchSite;
  items: SearchItem[];
  initialIndex: number;
  onClose: () => void;
}

export function SearchImageSheet({ site, items, initialIndex, onClose }: SearchImageSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  const item = items[index];
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
      aria-label={`${site} image viewer`}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
        if (event.key === 'ArrowRight' && index < items.length - 1) setIndex(index + 1);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="search-viewer-header">
        <button
          className="btn icon-btn"
          type="button"
          aria-label="Previous image"
          title="Previous image"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          <Icon name="previous" />
        </button>
        <h2>{site} post {item.id}</h2>
        <button
          className="btn icon-btn"
          type="button"
          aria-label="Next image"
          title="Next image"
          disabled={index >= items.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          <Icon name="next" />
        </button>
        <button className="btn icon-btn" type="button" aria-label="Close viewer" title="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="search-viewer-body">
        <div className="search-viewer-media">
          <img className="search-detail-image" src={item.preview} alt={`${site} post ${item.id}`} />
        </div>
        <aside className="search-viewer-sidebar" aria-label="Post details">
          <h2 className="mono">{item.id}</h2>
          <div className="row">
            <span className="badge">{item.rating}</span>
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
            <>
              <p className="label">Tags</p>
              <div className="search-tags">
                {tags.map((tag) => <span className="tagchip" key={tag}>{tag}</span>)}
              </div>
            </>
          ) : !detailsQuery.isLoading ? (
            <p className="muted">No tags returned</p>
          ) : null}
        </aside>
      </div>
    </dialog>
  );
}
