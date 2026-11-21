import { useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { LibraryImage } from '../schemas';

type ViewableImage = LibraryImage & { hash: string };

interface LibraryImageViewerProps {
  images: ViewableImage[];
  imagePath: string;
  onClose: (image: ViewableImage) => void;
}

export function LibraryImageViewer({ images, imagePath, onClose }: LibraryImageViewerProps) {
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
          disabled={index === 0}
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
          disabled={index >= images.length - 1}
          onClick={() => goTo(1)}
        >
          <Icon name="next" />
        </button>
        <button className="btn icon-btn" type="button" aria-label="Close viewer" title="Close" onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      <div className="library-viewer-content">
        <img className="library-viewer-image" src={`/api/image/${image.hash}`} alt={image.name} />
      </div>
    </dialog>
  );
}
