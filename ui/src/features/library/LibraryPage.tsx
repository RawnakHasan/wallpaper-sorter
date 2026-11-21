import { useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSearch } from '@tanstack/react-router';
import { type GridItem } from '../../components/ImageGrid';
import { useHotkeysStore } from '../../stores/hotkeys';
import { useSelectionStore } from '../../stores/selection';
import { CreateFolderSheet } from './components/CreateFolderSheet';
import { LibraryFolderTree } from './components/LibraryFolderTree';
import { LibraryMainPane } from './components/LibraryMainPane';
import { LibraryOverlays } from './components/LibraryOverlays';
import { useLibraryActions } from './hooks/useLibraryActions';
import { useLibraryQueries } from './hooks/useLibraryQueries';
import { imageSources, messageOf } from './utils';
import type { LibraryImage } from './schemas';

export function LibraryPage() {
  const routeSearch = useSearch({ from: '/library' });
  const selectionKeys = useSelectionStore((state) => state.keys);
  const { foldersQuery, statusQuery, folders, currentFolder, currentInfo, imagesQuery, images } =
    useLibraryQueries(routeSearch.folder);
  const actions = useLibraryActions({
    currentFolder,
    images,
    duplicateFolder: statusQuery.data?.settings.duplicates_folder,
  });
  const {
    selectedImage, setSelectedImage, moveFiles, setMoveFiles, moveTags, moveError, setMoveError,
    createOpen, setCreateOpen, createError, setCreateError, managementFolder, setManagementFolder,
    managementKey, setManagementKey, managementError, setManagementError, gapFolder, setGapFolder,
    gapError, setGapError, dropTarget, setDropTarget, thumbVersions, draggedFiles,
    createMutation, moveMutation, deleteMutation, folderChangeMutation, gapMutation,
    sourceMutation, lookupMutation,
    navigateToFolder, prefetchFolder, selectedFiles, openMove, deleteSelected, rebuildThumbnails,
    openDeleteImage, openMoveImage, startImageDrag, dropImagesOnFolder, folderChangeDone, fillGaps,
  } = actions;
  const [fullscreenPath, setFullscreenPath] = useState<string | null>(null);

  const allKeys = images.map((image) => image.path);
  const fullscreenImages = images.filter((image): image is LibraryImage & { hash: string } => image.hash !== null);
  const gridItems: GridItem[] = images.map((image) => ({
    key: image.path,
    hash: image.hash,
    thumbVersion: image.hash ? thumbVersions[image.hash] ?? 0 : 0,
    name: image.name,
    sub: imageSources(image).map((source) => source.site).join(', '),
    onOpen: () => setSelectedImage(image),
    onExpand: image.hash ? () => setFullscreenPath(image.path) : undefined,
  }));
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const image of images) {
      const source = imageSources(image)[0];
      const label = source ? source.site : 'Unknown';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) =>
      a === 'Unknown' ? -1 : b === 'Unknown' ? 1 : a.localeCompare(b)
    );
  }, [images]);

  // Remove selected paths as soon as the refreshed folder image list no longer contains them.
  useLayoutEffect(() => {
    if (!imagesQuery.data) return;
    const valid = new Set(images.map((image) => image.path));
    const current = useSelectionStore.getState();
    const keys = new Set([...current.keys].filter((key) => valid.has(key)));
    if (keys.size !== current.keys.size || (current.last !== null && !valid.has(current.last))) {
      useSelectionStore.setState({
        keys,
        last: current.last !== null && valid.has(current.last) ? current.last : null,
      });
    }
  }, [images, imagesQuery.data]);

  // Keep the global shortcuts bound to the current folder's available actions.
  useLayoutEffect(() => {
    const setActions = useHotkeysStore.getState().setActions;
    setActions({
      assign: () => { void openMove(selectedFiles()); },
      remove: () => { void deleteSelected(selectedFiles()); },
      all: () => flushSync(() => useSelectionStore.getState().addMany(allKeys)),
    });
    return () => setActions({});
  }, [images]);

  const queryError = foldersQuery.error ?? statusQuery.error ?? imagesQuery.error;
  if (queryError) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(queryError)}</p>
        <button className="btn" onClick={() => { void foldersQuery.refetch(); void statusQuery.refetch(); void imagesQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!foldersQuery.data || !statusQuery.data || (currentFolder && !imagesQuery.data)) {
    return <div className="page"><p className="muted">Loading…</p></div>;
  }

  if (!folders.length) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Library</h1>
          <span className="spacer" />
          <button className="btn primary" type="button" onClick={() => { setCreateError(null); setCreateOpen(true); }}>New folder</button>
        </div>
        <div className="empty"><b>No folders yet</b>Folders appear here when images are sorted into them.</div>
        {createOpen ? (
          <CreateFolderSheet
            defaultPath=""
            pending={createMutation.isPending}
            error={createError}
            onClose={() => setCreateOpen(false)}
            onCreate={(folder) => createMutation.mutate(folder)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="lib">
        <LibraryFolderTree
          folders={folders}
          currentFolder={currentFolder}
          dropTarget={dropTarget}
          onDragEnter={(folder) => { if (draggedFiles.current.length) setDropTarget(folder); }}
          onDragOver={(event, folder) => {
            if (!draggedFiles.current.length) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTarget(folder);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
          }}
          onDrop={(event, folder) => { void dropImagesOnFolder(event, folder); }}
          onPrefetch={prefetchFolder}
          onSelect={(folder) => { void navigateToFolder(folder); }}
        />
        <LibraryMainPane
          currentFolder={currentFolder}
          currentInfo={currentInfo}
          images={images}
          sourceCounts={sourceCounts}
          allKeys={allKeys}
          gridItems={gridItems}
          onCreate={() => { setCreateError(null); setCreateOpen(true); }}
          onManage={() => {
            setManagementError(null);
            setManagementKey((key) => key + 1);
            setManagementFolder(currentInfo ?? null);
          }}
          onFillGaps={() => { setGapError(null); setGapFolder(currentFolder); }}
          onPrefetch={prefetchFolder}
          onNavigate={(folder) => {
            if (folders.some((entry) => entry.path === folder)) void navigateToFolder(folder);
          }}
          onMove={() => { void openMove(selectedFiles()); }}
          onRebuild={() => {
            void rebuildThumbnails(images.filter((image) => selectionKeys.has(image.path)).map((image) => image.hash));
          }}
          onDelete={() => { void deleteSelected(selectedFiles()); }}
          onDragStart={startImageDrag}
          onDragEnd={() => {
            draggedFiles.current = [];
            setDropTarget(null);
          }}
        />
      </div>
      <LibraryOverlays
        viewerImages={fullscreenImages}
        fullscreenPath={fullscreenPath}
        onOpenFullscreen={() => {
          if (selectedImage?.hash) setFullscreenPath(selectedImage.path);
        }}
        onCloseFullscreen={(image) => {
          setFullscreenPath(null);
          if (selectedImage) {
            const latestImage = images.find((entry) => entry.path === image.path);
            if (latestImage) setSelectedImage(latestImage);
          }
        }}
        selectedImage={selectedImage}
        currentFolder={currentFolder}
        imagePending={deleteMutation.isPending || moveMutation.isPending}
        onCloseImage={() => setSelectedImage(null)}
        onMoveImage={() => { if (selectedImage) openMoveImage(selectedImage); }}
        onDeleteImage={() => { if (selectedImage) openDeleteImage(selectedImage); }}
        onRebuildImage={(hash) => { void rebuildThumbnails([hash]); }}
        sourcePending={sourceMutation.isPending || lookupMutation.isPending}
        onSaveSource={(request) => sourceMutation.mutate(request)}
        onLookupSource={(request) => lookupMutation.mutate(request)}
        moveFiles={moveFiles}
        folders={folders}
        moveTags={moveTags}
        duplicateFolder={statusQuery.data.settings.duplicates_folder}
        movePending={moveMutation.isPending}
        moveError={moveError}
        onCloseMove={() => {
          if (moveMutation.isPending) return;
          setMoveFiles(null);
          setMoveError(null);
        }}
        onMove={(request) => {
          setMoveError(null);
          moveMutation.mutate(request);
        }}
        createOpen={createOpen}
        createPending={createMutation.isPending}
        createError={createError}
        onCloseCreate={() => {
          if (!createMutation.isPending) setCreateOpen(false);
        }}
        onCreate={(folder) => createMutation.mutate(folder)}
        managementFolder={managementFolder}
        managementKey={managementKey}
        folderChangePending={folderChangeMutation.isPending}
        managementError={managementError}
        onCloseManagement={() => {
          if (!folderChangeMutation.isPending) setManagementFolder(null);
        }}
        onApplyFolderChange={(request) => folderChangeMutation.mutateAsync(request)}
        onFolderChangeApplied={async (request, result) => {
          setManagementError(null);
          await folderChangeDone(request, result);
        }}
        gapFolder={gapFolder}
        gapPending={gapMutation.isPending}
        gapError={gapError}
        onCloseGaps={() => {
          if (!gapMutation.isPending) setGapFolder(null);
        }}
        onFillGaps={(mode) => { void fillGaps(mode); }}
      />
    </div>
  );
}
