import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

interface ChipInputProps {
  initial?: string[];
  placeholder?: string;
  onChange?: (values: string[]) => void;
}

export interface ChipInputHandle {
  add: (value: string) => void;
  get: () => string[];
}

export const ChipInput = forwardRef<ChipInputHandle, ChipInputProps>(function ChipInput(
  { initial = [], placeholder = '', onChange },
  forwardedRef,
) {
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (next: string[]) => {
    flushSync(() => setValues(next));
    onChange?.(next);
  };
  const updatePending = (value: string) => setPending(value);
  const add = (inputValue?: string) => {
    const value = (inputValue ?? inputRef.current?.value ?? pending).trim().replace(/,$/, '').trim();
    if (value && !values.includes(value)) update([...values, value]);
    setPending('');
    if (inputRef.current) inputRef.current.value = '';
  };
  useImperativeHandle(forwardedRef, () => ({
    add: (value) => {
      const next = value.trim();
      if (next && !values.includes(next)) update([...values, next]);
    },
    get: () => {
      const value = (inputRef.current?.value ?? pending).trim();
      return value && !values.includes(value) ? [...values, value] : [...values];
    },
  }), [pending, values]);

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
        ref={inputRef}
        className="chip-in"
        value={pending}
        placeholder={placeholder}
        aria-label={placeholder || 'Add'}
        onChange={(event) => updatePending(event.currentTarget.value)}
        onInput={(event) => updatePending(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add();
          } else if (event.key === 'Backspace' && !inputRef.current?.value && values.length) {
            update(values.slice(0, -1));
          }
        }}
        onBlur={() => add()}
      />
    </div>
  );
});
