import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStatus, statusQueryKey } from '../../status/api';
import { getLibraryFolders, libraryFoldersQueryKey, libraryImagesQueryOptions } from '../api';

export function useLibraryQueries(requestedFolder?: string, loadGallery = false) {
  const queryClient = useQueryClient();
  const foldersQuery = useQuery({
    queryKey: libraryFoldersQueryKey,
    queryFn: getLibraryFolders,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const duplicateFolder = statusQuery.data?.settings.duplicates_folder ?? '';
  const folders = (foldersQuery.data ?? []).filter((entry) =>
    entry.path !== duplicateFolder && !entry.path.startsWith(`${duplicateFolder}/`)
  );
  const currentFolder = requestedFolder && folders.some((entry) => entry.path === requestedFolder)
    ? requestedFolder
    : folders[0]?.path ?? '';
  const currentInfo = folders.find((entry) => entry.path === currentFolder);
  const imagesQuery = useQuery({
    ...libraryImagesQueryOptions(currentFolder),
    enabled: !!currentFolder,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const images = imagesQuery.data ?? [];
  const folderPaths = folders.map((entry) => entry.path);
  const galleryImagesQuery = useQuery({
    queryKey: ['library-gallery-images', folderPaths],
    queryFn: async () => {
      const lists = await Promise.all(folderPaths.map((folder) =>
        queryClient.fetchQuery(libraryImagesQueryOptions(folder))
      ));
      return lists.flat();
    },
    enabled: loadGallery && folderPaths.length > 0,
    staleTime: 0,
  });

  return {
    foldersQuery,
    statusQuery,
    folders,
    currentFolder,
    currentInfo,
    imagesQuery,
    images,
    galleryImagesQuery,
  };
}
