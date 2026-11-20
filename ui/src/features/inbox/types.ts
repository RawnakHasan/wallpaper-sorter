import type { InboxItem } from './schemas';

export type InboxFilters = {
  reason: '' | InboxItem['reason'];
  intake: string;
};

export interface AssignFile {
  path: string;
  name: string;
}
