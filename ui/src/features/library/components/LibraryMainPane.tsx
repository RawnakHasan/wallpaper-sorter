import { Fragment, type DragEvent } from 'react';
import { ImageGrid, type GridItem } from '../../../components/ImageGrid';
import { SelectionBar } from '../../../components/SelectionBar';
import type { LibraryFolder, LibraryImage } from '../schemas';
import { basename } from '../utils';

interface LibraryMainPaneProps {
  currentFolder: string;
  currentInfo?: LibraryFolder;
  images: LibraryImage[];
  sourceCounts: Array<[string, number]>;
  allKeys: string[];
  gridItems: GridItem[];
  onCreate: () => void;
  onManage: () => void;
  onFillGaps: () => void;
  onPrefetch: (folder: string) => void;
  onNavigate: (folder: string) => void;
  onMove: () => void;
  onRebuild: () => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, item: GridItem) => void;
  onDragEnd: () => void;
}

export function LibraryMainPane({
  currentFolder,
  currentInfo,
  images,
  sourceCounts,
  allKeys,
  gridItems,
  onCreate,
  onManage,
  onFillGaps,
  onPrefetch,
  onNavigate,
  onMove,
  onRebuild,
  onDelete,
  onDragStart,
  onDragEnd,
}: LibraryMainPaneProps) {
  const gapsLabel = currentInfo?.gaps.length
    ? currentInfo.gaps.length > 6
      ? `${currentInfo.gaps.length} (${currentInfo.gaps.slice(0, 6).join(', ')}, …)`
      : `${currentInfo.gaps.length} (${currentInfo.gaps.join(', ')})`
    : '';
  const sourceSummary = sourceCounts.length ? (
    <span className="source-counts" role="group" aria-label="Images by source">
      <span className="source-count-label">Sources</span>
      {sourceCounts.map(([source, count]) => (
        <span className="source-count" key={source}><b>{source}</b>{count}</span>
      ))}
    </span>
  ) : null;

  return (
    <div className="lib-main">
      <div className="page-head">
        <h1>{currentInfo?.name ?? basename(currentFolder)}</h1>
        <span className="spacer" />
        <div className="row">
          <button className="btn" type="button" onClick={onCreate}>New folder</button>
          {currentInfo ? <button className="btn" type="button" onClick={onManage}>Manage folder…</button> : null}
          {currentInfo?.gaps.length ? <button className="btn" type="button" onClick={onFillGaps}>Close gaps…</button> : null}
        </div>
      </div>
      <div className="crumbs">
        {currentFolder.split('/').map((segment, index, segments) => {
          const path = segments.slice(0, index + 1).join('/');
          return (
            <Fragment key={path}>
              {index ? <span>/</span> : null}
              <button type="button" onPointerEnter={() => onPrefetch(path)} onFocus={() => onPrefetch(path)} onClick={() => onNavigate(path)}>
                {segment}
              </button>
            </Fragment>
          );
        })}
      </div>
      {currentInfo ? (
        <div className="facts">
          <span>Prefix <b>{currentInfo.prefix}</b></span>
          <span>Next number <b>{currentInfo.next_number}</b></span>
          <span>Images <b>{images.length}</b></span>
          {gapsLabel ? <span>Gaps <b>{gapsLabel}</b></span> : null}
          {sourceSummary}
        </div>
      ) : null}
      {images.length === 0 ? <div className="empty"><b>No images in this folder</b></div> : null}
      <SelectionBar
        allKeys={allKeys}
        actions={[
          { label: 'Move to folder…', className: 'primary', onClick: onMove },
          { label: 'Rebuild thumbnails', onClick: onRebuild },
          { label: 'Delete', className: 'danger', onClick: onDelete },
        ]}
      />
      {images.length ? <ImageGrid key={currentFolder} items={gridItems} onDragStart={onDragStart} onDragEnd={onDragEnd} /> : null}
    </div>
  );
}
