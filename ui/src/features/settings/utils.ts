import type { GapMode } from './types';
import type { Theme } from '../../stores/theme';

export const gapModes: GapMode[] = ['keep', 'lowest', 'last', 'renumber'];

export const gapText: Record<GapMode, string> = {
  keep: 'Keep gaps. The next number is the highest plus one. Nothing is renamed.',
  lowest: 'The next image takes the lowest free number. Nothing is renamed.',
  last: 'The last images are renamed into the gaps whenever an image arrives.',
  renumber: 'Everything is renumbered without gaps whenever an image arrives.',
};

export const themes: Theme[] = ['system', 'dark', 'light'];

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
