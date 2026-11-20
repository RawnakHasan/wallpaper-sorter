import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../../components/dialogs';
import { useThemeStore } from '../../../stores/theme';
import { useToastStore } from '../../../stores/toast';
import { getStatus, statusQueryKey, updateSettings } from '../../status/api';
import type { Status } from '../../status/schemas';
import { emptyTrash, removeIntake, saveIntake } from '../api';
import type { IntakeRequest } from '../api';
import type { GapMode, IntakeDraft, IntakeEntry } from '../types';
import { gapModes, messageOf } from '../utils';

export function useSettingsPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const [gapMode, setGapMode] = useState<GapMode | null>(null);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: statusQueryKey });
  const gapMutation = useMutation({
    mutationFn: (mode: GapMode) => updateSettings({ gap_mode: mode }),
    onSuccess: async () => {
      showToast('Saved', { success: true });
      await refreshStatus();
      setGapMode(null);
    },
    onError: (error) => {
      setGapMode(null);
      showToast(messageOf(error), { error: true });
    },
  });
  const saveIntakeMutation = useMutation({
    mutationFn: ({ index, ...body }: IntakeDraft & IntakeRequest) => saveIntake(index, body),
    onSuccess: async () => {
      setIntakeDraft(null);
      showToast(intakeDraft?.index === null ? 'Intake folder added' : 'Intake folder updated');
      await refreshStatus();
    },
    onError: (error) => setIntakeError(messageOf(error)),
  });
  const removeIntakeMutation = useMutation({
    mutationFn: removeIntake,
    onSuccess: async () => {
      showToast('Intake folder removed');
      await refreshStatus();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const emptyTrashMutation = useMutation({
    mutationFn: emptyTrash,
    onSuccess: (result) => showToast(`Removed ${result.removed} ${result.removed === 1 ? 'file' : 'files'}`),
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const closeIntakeDialog = () => {
    if (saveIntakeMutation.isPending) return;
    setIntakeDraft(null);
    setIntakeError(null);
  };
  const openIntakeDialog = (intake?: IntakeEntry) => {
    setIntakeError(null);
    setIntakeDraft({
      index: intake?.index ?? null,
      path: intake?.path ?? '',
      recursive: intake?.recursive ?? true,
      remove_empty_folders: intake?.remove_empty_folders ?? false,
    });
  };
  const saveIntakeDraft = (request: IntakeDraft & IntakeRequest) => {
    setIntakeError(null);
    saveIntakeMutation.mutate(request);
  };
  const removeWatchedFolder = async (intake: IntakeEntry) => {
    const confirmed = await confirmDialog(`Stop watching ${intake.path}?`, 'Remove', true);
    if (confirmed) removeIntakeMutation.mutate(intake.index);
  };
  const clearTrash = async () => {
    const confirmed = await confirmDialog(
      'Permanently remove everything in the trash? This cannot be undone.',
      'Remove for good',
      true,
    );
    if (confirmed) emptyTrashMutation.mutate();
  };
  const onGapModeChange = (value: string) => {
    const mode = gapModes.find((candidate) => candidate === value);
    if (!mode) {
      showToast('Invalid numbering option', { error: true });
      return;
    }
    setGapMode(mode);
    gapMutation.mutate(mode);
  };

  const status: Status | undefined = statusQuery.data;
  const selectedGap = gapMode ?? status?.settings.gap_mode ?? 'keep';

  return {
    statusQuery,
    status,
    theme,
    setTheme,
    selectedGap,
    gapMutation,
    intakeDraft,
    intakeError,
    saveIntakeMutation,
    emptyTrashMutation,
    closeIntakeDialog,
    openIntakeDialog,
    saveIntakeDraft,
    removeWatchedFolder,
    clearTrash,
    onGapModeChange,
  };
}
