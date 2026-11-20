import type { Status } from '../status/schemas';

export type GapMode = 'keep' | 'lowest' | 'last' | 'renumber';
export type IntakeEntry = Status['intake'][number];

export interface IntakeDraft {
  index: number | null;
  path: string;
  recursive: boolean;
  remove_empty_folders: boolean;
}
