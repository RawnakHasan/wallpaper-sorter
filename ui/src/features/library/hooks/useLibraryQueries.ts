import { useQuery } from '@tanstack/react-query';
import { getStatus, statusQueryKey } from '../../status/api';
import { getLibraryFolders, libraryFoldersQueryKey, libraryImagesQueryOptions } from '../api';

export function useLibraryQueries(requestedFolder?: string) {
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

  return { foldersQuery, statusQuery, folders, currentFolder, currentInfo, imagesQuery, images };
}
