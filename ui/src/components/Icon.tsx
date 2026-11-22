import {
  Activity,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  Expand,
  GitBranch,
  Inbox,
  Info,
  LayoutDashboard,
  Library,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';

const icons = {
  overview: LayoutDashboard,
  inbox: Inbox,
  library: Library,
  search: Search,
  tags: Tags,
  duplicates: Copy,
  data: Database,
  resort: ArrowLeftRight,
  activity: Activity,
  settings: Settings,
  close: X,
  info: Info,
  help: CircleHelp,
  git: GitBranch,
  monitor: Monitor,
  moon: Moon,
  sun: Sun,
  panelClose: PanelLeftClose,
  panelOpen: PanelLeftOpen,
  previous: ChevronLeft,
  next: ChevronRight,
  expand: Expand,
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
