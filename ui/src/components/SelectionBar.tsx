import { useSelectionStore } from '../stores/selection';

export interface SelectionAction {
  label: string;
  className?: string;
  onClick: () => void;
}

interface SelectionBarProps {
  allKeys: string[];
  actions: SelectionAction[];
  onSelectionChange?: () => void;
}

export function SelectionBar({ allKeys, actions, onSelectionChange }: SelectionBarProps) {
  const keys = useSelectionStore((state) => state.keys);
  const count = keys.size;

  return (
    <div className="selbar" role="toolbar" aria-label="Selection" hidden={count === 0}>
      <b>{count} selected</b>
      {actions.map((action) => (
        <button key={action.label} className={`btn ${action.className ?? ''}`} onClick={action.onClick}>
          {action.label}
        </button>
      ))}
      <button
        className="btn"
        onClick={() => {
          useSelectionStore.getState().addMany(allKeys);
          onSelectionChange?.();
        }}
      >
        Select all
      </button>
      <button
        className="btn"
        onClick={() => {
          useSelectionStore.getState().clear();
          onSelectionChange?.();
        }}
      >
        Clear
      </button>
    </div>
  );
}
