import {
  useId,
  useState,
  useRef,
  useLayoutEffect,
  useImperativeHandle,
  type Ref,
} from 'react';
import { calendarDateSchema } from '../shared/contracts.js';
import { parseDateInput } from './date-input.js';
import { strings } from './strings.js';

function displayDate(value: string | null): string {
  if (!value) return '';
  if (!calendarDateSchema.safeParse(value).success) return value;
  return `${value.slice(8)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}
export interface CalendarDateInputHandle {
  commit: () => void;
  focus: () => void;
  reset: () => void;
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
  referenceToday?: string;
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
  referenceToday,
  onChange,
  onCommit,
}: Props) {
  const id = useId();
  const yearHintId = `${id}-year`;
  const [editYear, setEditYear] = useState<string | null>(null);
  const frozenYear = useRef<string | null>(null);
  function beginEdit() {
    frozenYear.current ??= referenceToday?.slice(0, 4) ?? null;
    setEditYear(frozenYear.current);
  }
  function endEdit() {
    frozenYear.current = null;
    setEditYear(null);
  }
  const hintYear = editYear ?? referenceToday?.slice(0, 4);
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const edited = useRef(false);
  const current = useRef(value);
  current.current = value;
  const buffer = useRef('');
  function resetInput() {
    edited.current = false;
    endEdit();
    buffer.current = displayDate(current.current);
    setRaw(buffer.current);
    setFocused(false);
  }
  useLayoutEffect(resetInput, [resetKey]);
  function commit() {
    const year = frozenYear.current ?? undefined;
    endEdit();
    if (!edited.current) return;
    edited.current = false;
    const next = parseDateInput(buffer.current, year);
    // A replaced parent value discards an obsolete focused buffer.
    if (next === current.current) {
      if (next === null || calendarDateSchema.safeParse(next).success) {
        buffer.current = displayDate(next);
        setRaw(buffer.current);
      }
      onCommit?.(next);
    }
  }
  useImperativeHandle(ref, () => ({
    commit,
    reset: resetInput,
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
          placeholder={referenceToday ? 'ДД.ММ или ДД.ММ.ГГГГ' : 'ДД.ММ.ГГГГ'}
          maxLength={10}
          value={focused ? raw : displayDate(value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [descriptionId, referenceToday ? yearHintId : undefined]
              .filter(Boolean)
              .join(' ') || undefined
          }
          onFocus={() => {
            beginEdit();
            buffer.current = displayDate(value);
            setRaw(buffer.current);
            setFocused(true);
          }}
          onChange={(event) => {
            beginEdit();
            setFocused(true);
            edited.current = true;
            buffer.current = event.target.value;
            setRaw(event.target.value);
            onChange?.(
              parseDateInput(
                event.target.value,
                frozenYear.current ?? undefined,
              ),
            );
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
              edited.current = false;
              endEdit();
              const next = event.target.value || null;
              onChange?.(next);
              onCommit?.(next);
            }}
          />
        </span>
      </div>
      {referenceToday && (
        <span id={yearHintId} className="date-year-hint">
          Без года — {hintYear}
        </span>
      )}
      {today && (
        <button
          type="button"
          className="date-today"
          aria-label={`${strings.today}: ${label}`}
          disabled={disabled}
          onClick={() => {
            edited.current = false;
            endEdit();
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
