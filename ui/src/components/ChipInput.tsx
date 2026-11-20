import { useState } from 'react';

interface ChipInputProps {
  initial?: string[];
  placeholder?: string;
  onChange?: (values: string[]) => void;
}

export function ChipInput({ initial = [], placeholder = '', onChange }: ChipInputProps) {
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState('');

  const update = (next: string[]) => {
    setValues(next);
    onChange?.(next);
  };
  const add = () => {
    const value = pending.trim().replace(/,$/, '').trim();
    if (value && !values.includes(value)) update([...values, value]);
    setPending('');
  };

  return (
    <div className="chips">
      {values.map((value) => (
        <span className="tagchip" key={value}>
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => update(values.filter((entry) => entry !== value))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="chip-in"
        value={pending}
        placeholder={placeholder}
        aria-label={placeholder || 'Add'}
        onChange={(event) => setPending(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add();
          } else if (event.key === 'Backspace' && !pending && values.length) {
            update(values.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
