import { Fragment, useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react';
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
  const [logos, setLogos] = useState<Record<string, { dataUrl: string; tint: boolean }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ws-folder-logos') || '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    const refresh = () => {
      try {
        setLogos(JSON.parse(localStorage.getItem('ws-folder-logos') || '{}'));
      } catch {
        setLogos({});
      }
    };
    window.addEventListener('ws-folder-logo-changed', refresh);
    return () => window.removeEventListener('ws-folder-logo-changed', refresh);
  }, []);
  const [previewSize, setPreviewSize] = useState(270);
  const [resolution, setResolution] = useState<'any' | '1080' | '1440' | '4k'>('any');
  const [shape, setShape] = useState<'any' | 'landscape' | 'ultrawide' | 'portrait'>('any');
  const [colour, setColour] = useState<number>(-1);
  const [fitsMonitor, setFitsMonitor] = useState(false);
  const [savedSearches, setSavedSearches] = useState<Array<{ name: string; resolution: typeof resolution; shape: typeof shape; colour: number; fitsMonitor: boolean }>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ws-library-searches') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  const monitor = useMemo(() => {
    try {
      const match = (localStorage.getItem('ws-monitor-resolution') || '2560×1440').match(/(\d+)×(\d+)/);
      return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 2560, height: 1440 };
    } catch {
      return { width: 2560, height: 1440 };
    }
  }, []);

  const visibleGridItems = useMemo(() => gridItems.filter((item) => {
    const image = images.find((entry) => entry.path === item.key);
    const width = image?.origin?.width ?? 0;
    const height = image?.origin?.height ?? 0;
    const ratio = width && height ? width / height : 0;
    if (resolution === '1080' && width < 1920) return false;
    if (resolution === '1440' && width < 2560) return false;
    if (resolution === '4k' && width < 3840) return false;
    if (shape === 'landscape' && !(ratio >= 1 && ratio < 2.2)) return false;
    if (shape === 'ultrawide' && !(ratio >= 2.2)) return false;
    if (shape === 'portrait' && !(ratio > 0 && ratio < 1)) return false;
    if (colour >= 0) {
      const index = item.key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 8;
      if (index !== colour) return false;
    }
    if (fitsMonitor && (!(width >= monitor.width && height >= monitor.height))) return false;
    return true;
  }), [colour, fitsMonitor, gridItems, images, monitor, resolution, shape]);

  const clearFilters = () => {
    setResolution('any');
    setShape('any');
    setColour(-1);
    setFitsMonitor(false);
  };
  const saveSearch = () => {
    const name = [
      resolution === 'any' ? '' : `${resolution === '4k' ? '4K+' : `${resolution}p+`}`,
      shape === 'any' ? '' : shape,
      colour >= 0 ? `colour ${colour + 1}` : '',
      fitsMonitor ? 'Fits monitor' : '',
    ].filter(Boolean).join(' · ') || 'All images';
    const next = [...savedSearches, { name, resolution, shape, colour, fitsMonitor }];
    setSavedSearches(next);
    try {
      localStorage.setItem('ws-library-searches', JSON.stringify(next));
    } catch {
      // Saved searches are optional in restricted browser contexts.
    }
  };
  const removeSavedSearch = (index: number) => {
    const next = savedSearches.filter((_, itemIndex) => itemIndex !== index);
    setSavedSearches(next);
    try {
      localStorage.setItem('ws-library-searches', JSON.stringify(next));
    } catch {
      // Saved searches are optional in restricted browser contexts.
    }
  };
  const applySavedSearch = (index: number) => {
    const saved = savedSearches[index];
    if (!saved) return;
    setResolution(saved.resolution);
    setShape(saved.shape);
    setColour(saved.colour);
    setFitsMonitor(saved.fitsMonitor);
  };

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
        <h1>
          {logos[currentFolder] ? (
            <img
              className={`library-folder-logo${logos[currentFolder].tint ? ' tint' : ''}`}
              src={logos[currentFolder].dataUrl}
              alt={currentInfo?.name ?? basename(currentFolder)}
            />
          ) : (currentInfo?.name ?? basename(currentFolder))}
        </h1>
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
          <span className="pill">Prefix <b>{currentInfo.prefix}</b></span>
          <span className="pill pill-accent">Next <b>{currentInfo.next_number}</b></span>
          <span className="pill pill-purple">Images <b>{images.length}</b></span>
          {gapsLabel ? <span className="pill pill-ok">Gaps <b>{gapsLabel}</b></span> : null}
          {sourceSummary}
        </div>
      ) : null}
      <div className="library-filterbar">
        <div className="library-filter-group" aria-label="Resolution">
          <span className="label">Resolution</span>
          <div className="segmented-control">
            {([
              ['any', 'Any'],
              ['1080', '1080p+'],
              ['1440', '1440p+'],
              ['4k', '4K+'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={resolution === value}
                onClick={() => setResolution(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="library-filter-group" aria-label="Shape">
          <span className="label">Shape</span>
          <div className="segmented-control">
            {([
              ['any', 'Any'],
              ['landscape', 'Landscape'],
              ['ultrawide', 'Ultrawide'],
              ['portrait', 'Portrait'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={shape === value}
                onClick={() => setShape(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="library-filter-group" aria-label="Colour">
          <span className="label">Colour</span>
          <div className="colour-swatches">
            {['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink'].map((label, index) => (
              <button
                key={label}
                type="button"
                className={`colour-swatch colour-${index}`}
                aria-label={label}
                aria-pressed={colour === index}
                onClick={() => setColour((current) => current === index ? -1 : index)}
                title={label}
              />
            ))}
          </div>
        </div>
        <button
          className={`monitor-filter${fitsMonitor ? ' on' : ''}`}
          type="button"
          aria-pressed={fitsMonitor}
          onClick={() => setFitsMonitor((current) => !current)}
        >
          Fits my monitor · {monitor.width}×{monitor.height}
        </button>
      </div>
      <div className="library-filter-summary">
        <span className="sub">{visibleGridItems.length} of {gridItems.length} match</span>
        {(resolution !== 'any' || shape !== 'any' || colour >= 0 || fitsMonitor) ? (
          <button className="link-button" type="button" onClick={clearFilters}>Clear</button>
        ) : null}
        <button className="button small" type="button" onClick={saveSearch}>Save search</button>
        {savedSearches.length ? (
          <div className="saved-searches" aria-label="Saved searches">
            {savedSearches.map((search, index) => (
              <span className="saved-search" key={`${search.name}-${index}`}>
                <button type="button" onClick={() => applySavedSearch(index)}>{search.name}</button>
                <button
                  type="button"
                  className="saved-search-remove"
                  aria-label={`Remove saved search ${search.name}`}
                  onClick={() => removeSavedSearch(index)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="library-size-control" role="group" aria-label="Preview size">
        {[190, 270, 400].map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={previewSize === size}
            aria-label={size === 190 ? 'Small previews' : size === 270 ? 'Medium previews' : 'Large previews'}
            onClick={() => setPreviewSize(size)}
          >
            {size === 190 ? 'S' : size === 270 ? 'M' : 'L'}
          </button>
        ))}
      </div>
      {images.length === 0 ? <div className="empty"><b>No images in this folder</b></div> : null}
      <SelectionBar
        allKeys={allKeys}
        actions={[
          { label: 'Move to folder…', className: 'primary', onClick: onMove },
          { label: 'Rebuild thumbnails', onClick: onRebuild },
          { label: 'Delete', className: 'danger', onClick: onDelete },
        ]}
      />
      {visibleGridItems.length ? (
        <div
          className="library-grid-wrap"
          style={{ '--preview-size': `${previewSize}px` } as CSSProperties & { '--preview-size': string }}
        >
          <ImageGrid key={currentFolder} items={visibleGridItems} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      ) : (
        <div className="empty library-empty-filter"><b>No images match</b>Loosen a filter or clear them.</div>
      )}
    </div>
  );
}
