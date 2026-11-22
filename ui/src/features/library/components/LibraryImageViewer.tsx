import { useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { LibraryImage } from '../schemas';

type ViewableImage = LibraryImage & { hash: string };

interface LibraryImageViewerProps {
  images: ViewableImage[];
  imagePath: string;
  navigationPending: boolean;
  navigationError: string | null;
  onClose: (image: ViewableImage) => void;
}

export function LibraryImageViewer({
  images,
  imagePath,
  navigationPending,
  navigationError,
  onClose,
}: LibraryImageViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [currentPath, setCurrentPath] = useState(imagePath);
  const index = Math.max(0, images.findIndex((image) => image.path === currentPath));
  const image = images[index];
  useNativeDialog(dialogRef);

  if (!image) return null;

  const close = () => onClose(image);
  const goTo = (offset: number) => {
    const next = images[index + offset];
    if (next) setCurrentPath(next.path);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet library-image-viewer"
      aria-label={`Full-screen image ${image.name}`}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') goTo(-1);
        if (event.key === 'ArrowRight') goTo(1);
      }}
    >
      <header className="library-viewer-header">
        <button
          className="btn icon-btn"
          type="button"
          aria-label="Previous image"
          title="Previous image"
          disabled={navigationPending || index === 0}
          onClick={() => goTo(-1)}
        >
          <Icon name="previous" />
        </button>
        <h2>{image.name}</h2>
        <button
          className="btn icon-btn"
          type="button"
          aria-label="Next image"
          title="Next image"
          disabled={navigationPending || index >= images.length - 1}
          onClick={() => goTo(1)}
        >
          <Icon name="next" />
        </button>
        <button className="btn icon-btn" type="button" aria-label="Close viewer" title="Close" onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      <div className="library-viewer-content">
        {navigationPending ? <p className="muted" role="status">Loading the full Library gallery…</p> : null}
        {navigationError ? (
          <p className="error" role="alert">
            Could not load the full Library gallery. {navigationError}
          </p>
        ) : null}
        <img className="library-viewer-image" src={`/api/image/${image.hash}`} alt={image.name} />
      </div>
      <aside className="library-viewer-sidebar" aria-label="Image details">
        <h2 className="mono">{image.name}</h2>
        <p className="sub">{index + 1} of {images.length}</p>
        {image.origin?.width ? (
          <dl className="kv">
            <div>Resolution</div>
            <div className="mono">{image.origin.width} × {image.origin.height}</div>
            {image.origin.rating ? (
              <>
                <div>Rating</div>
                <div>{image.origin.rating}</div>
              </>
            ) : null}
          </dl>
        ) : null}
        {image.origin?.tags.length ? (
          <>
            <p className="label">Tags</p>
            <div className="site-tags">
              {image.origin.tags.map((tag) => <span className="tagchip" key={tag}>{tag}</span>)}
            </div>
          </>
        ) : null}
      </aside>
    </dialog>
  );
}
