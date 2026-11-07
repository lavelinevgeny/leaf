import { useRef, type RefObject } from 'react';
import { ControlIcon } from './ControlIcon.js';
import { strings } from './strings.js';

export function TaskSearch({
  value,
  onChange,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localInput;
  return (
    <div className="task-search">
      <ControlIcon name="search" />
      <input
        ref={input}
        type="text"
        role="searchbox"
        aria-label={strings.searchTasks}
        inputMode="search"
        placeholder={strings.searchTasks}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            event.stopPropagation();
            onChange('');
          }
        }}
      />
      <button
        type="button"
        className={`quiet task-search-clear${value ? '' : ' is-hidden'}`}
        aria-label={strings.clearTaskSearch}
        tabIndex={value ? 0 : -1}
        disabled={disabled || !value}
        onClick={() => {
          onChange('');
          input.current?.focus();
        }}
      >
        ×
      </button>
    </div>
  );
}
