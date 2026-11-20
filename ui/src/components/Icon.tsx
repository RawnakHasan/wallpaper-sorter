import {
  Activity,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Inbox,
  Info,
  LayoutDashboard,
  Library,
  Settings,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';

const icons = {
  overview: LayoutDashboard,
  inbox: Inbox,
  library: Library,
  tags: Tags,
  duplicates: Copy,
  data: Database,
  resort: ArrowLeftRight,
  activity: Activity,
  settings: Settings,
  close: X,
  info: Info,
  previous: ChevronLeft,
  next: ChevronRight,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  const Component = icons[name];
  return <Component className={className} aria-hidden="true" focusable="false" strokeWidth={1.8} />;
}
