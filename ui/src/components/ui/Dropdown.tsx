import { Select } from '@base-ui/react/select';
import { ChevronDown } from 'lucide-react';

interface DropdownProps {
  ariaLabel: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (value: string) => void;
}

export function Dropdown({ ariaLabel, value, options, onChange }: DropdownProps) {
  return (
    <Select.Root value={value} onValueChange={(next) => next && onChange(next)}>
      <Select.Trigger className="dropdown-trigger" aria-label={ariaLabel}>
        <Select.Value />
        <Select.Icon className="dropdown-icon">
          <ChevronDown aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="dropdown-positioner" sideOffset={6}>
          <Select.Popup className="dropdown-popup">
            <Select.List className="dropdown-list">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="dropdown-item"
                  label={option.label}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="dropdown-check">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
