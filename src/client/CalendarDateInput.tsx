import {
  useId,
  useState,
  useRef,
  useLayoutEffect,
  useImperativeHandle,
  type Ref,
} from 'react';
import { calendarDateSchema } from '../shared/contracts.js';
import { strings } from './strings.js';

function inputDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : trimmed;
  return calendarDateSchema.safeParse(iso).success ? iso : trimmed;
}
function displayDate(value: string | null): string {
  if (!value) return '';
  if (!calendarDateSchema.safeParse(value).success) return value;
  return `${value.slice(8)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}
export interface CalendarDateInputHandle {
  commit: () => void;
  focus: () => void;
}
interface Props {
  ref?: Ref<CalendarDateInputHandle>;
  resetKey?: number | undefined;
  label: string;
  value: string | null;
  disabled?: boolean;
  invalid?: boolean;
  descriptionId?: string;
  highlighted?: boolean;
  today?: string;
  onChange?: (value: string | null) => void;
  onCommit?: (value: string | null) => void;
}
export function CalendarDateInput({
  ref,
  resetKey,
  label,
  value,
  disabled,
  invalid,
  descriptionId,
  highlighted,
  today,
  onChange,
  onCommit,
}: Props) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const edited = useRef(false);
  const current = useRef(value);
  current.current = value;
  const buffer = useRef('');
  useLayoutEffect(() => {
    edited.current = false;
    buffer.current = displayDate(current.current);
    setRaw(buffer.current);
    setFocused(false);
  }, [resetKey]);
  function commit() {
    if (!edited.current) return;
    edited.current = false;
    const next = inputDate(buffer.current);
    // A replaced parent value discards an obsolete focused buffer.
    if (next === current.current) onCommit?.(next);
  }
  useImperativeHandle(ref, () => ({
    commit,
    focus: () => input.current?.focus(),
  }));
  return (
    <div className="calendar-field">
      <label htmlFor={id}>{label}</label>
      <div
        className={`calendar-input${highlighted ? ' plan-recalculated' : ''}`}
      >
        <input
          ref={input}
          id={id}
          type="text"
          inputMode="numeric"
          placeholder="ДД.ММ.ГГГГ"
          maxLength={10}
          value={focused ? raw : displayDate(value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={descriptionId}
          onFocus={() => {
            buffer.current = displayDate(value);
            setRaw(buffer.current);
            setFocused(true);
          }}
          onChange={(event) => {
            edited.current = true;
            buffer.current = event.target.value;
            setRaw(event.target.value);
            onChange?.(inputDate(event.target.value));
          }}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <span className="calendar-picker">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <rect x="4" y="5" width="16" height="16" rx="2" />
            <path d="M8 3v4m8-4v4M4 10h16" />
          </svg>
          <input
            type="date"
            aria-label={`Календарь: ${label}`}
            disabled={disabled}
            min="0001-01-01"
            max="9999-12-31"
            value={calendarDateSchema.safeParse(value).success ? value! : ''}
            onClick={(event) => {
              // Native keyboard entry also works where showPicker is unavailable.
              try {
                event.currentTarget.showPicker?.();
              } catch {
                /* Native fallback. */
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                try {
                  event.currentTarget.showPicker?.();
                } catch {
                  /* Native keyboard fallback. */
                }
              }
            }}
            onChange={(event) => {
              const next = event.target.value || null;
              onChange?.(next);
              onCommit?.(next);
            }}
          />
        </span>
      </div>
      {today && (
        <button
          type="button"
          className="date-today"
          aria-label={`${strings.today}: ${label}`}
          disabled={disabled}
          onClick={() => {
            onChange?.(today);
            onCommit?.(today);
          }}
        >
          {strings.today}
        </button>
      )}
    </div>
  );
}
