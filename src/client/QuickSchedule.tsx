import { useLayoutEffect, useRef, useState } from 'react';
import type { Project, SourceFields } from '../shared/contracts.js';
import { completeSourceEdit } from '../domain/planning.js';
import { shiftDate } from './gantt-view.js';
import { fridayPlan, scheduleChip } from './quick-add-view.js';
import { useProjectToday } from './use-project-today.js';
import { strings } from './strings.js';
import { PlanFields } from './PlanFields.js';

interface Props {
  id: string;
  plan: SourceFields;
  parentPlan: SourceFields | null;
  calendar: Project['calendarType'];
  timezone: string;
  disabled: boolean;
  anchor: HTMLButtonElement | null;
  onChange: (plan: SourceFields) => void;
  onValidityChange: (valid: boolean) => void;
  onClose: () => void;
}
export function QuickSchedule({
  id,
  plan,
  parentPlan,
  calendar,
  timezone,
  disabled,
  anchor,
  onChange,
  onValidityChange,
  onClose,
}: Props) {
  const popup = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const today = useProjectToday(timezone);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    const node = popup.current;
    if (!node || !anchor) return;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(440, window.innerWidth - 24);
      node.style.width = `${width}px`;
      node.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      node.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - node.offsetHeight - 12))}px`;
    };
    node.showPopover?.();
    position();
    node.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !node.contains(event.target) &&
        !anchor.closest('form')?.contains(event.target)
      )
        closeRef.current();
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [anchor]);
  function preset(make: () => SourceFields, fallback?: SourceFields) {
    try {
      onChange(make());
      setError('');
      onValidityChange(true);
    } catch {
      if (fallback) onChange(fallback);
      setError(strings.quickScheduleError);
      onValidityChange(false);
    }
  }
  return (
    <div
      ref={popup}
      id={id}
      popover={
        typeof HTMLElement.prototype.showPopover === 'function'
          ? 'manual'
          : undefined
      }
      role="dialog"
      aria-label={strings.quickScheduleTitle}
      className="quick-schedule"
      onToggle={(event) => {
        if ((event.nativeEvent as ToggleEvent).newState === 'closed') onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="quick-schedule-heading">
        <strong>{strings.quickScheduleTitle}</strong>
        <kbd>Alt D</kbd>
      </div>
      <div className="quick-presets">
        <button
          type="button"
          aria-label={`${strings.today}: ${strings.start}`}
          disabled={disabled}
          onClick={() =>
            preset(
              () =>
                completeSourceEdit(
                  { ...plan, inputStart: today },
                  'inputStart',
                  calendar,
                ),
              { ...plan, inputStart: today },
            )
          }
        >
          {strings.today}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            preset(
              () =>
                completeSourceEdit(
                  { ...plan, inputStart: shiftDate(today, 1) },
                  'inputStart',
                  calendar,
                ),
              { ...plan, inputStart: shiftDate(today, 1) },
            )
          }
        >
          {strings.tomorrow}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => preset(() => fridayPlan(today, calendar))}
        >
          {strings.untilFriday}
        </button>
        {parentPlan && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => preset(() => ({ ...parentPlan }))}
          >
            {strings.likeParent} · {scheduleChip(parentPlan, calendar)}
          </button>
        )}
      </div>
      <PlanFields
        compact
        task={{ status: 'todo' }}
        plan={plan}
        calendar={calendar}
        timezone={timezone}
        summary={false}
        disabled={disabled}
        onChange={(next) => {
          setError('');
          onChange(next);
        }}
        onValidityChange={(valid) => onValidityChange(valid && !error)}
      />
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <div className="quick-schedule-actions">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange({
              inputStart: null,
              inputFinish: null,
              durationDays: null,
            });
            setError('');
            onValidityChange(true);
          }}
        >
          {strings.resetSchedule}
        </button>
        <button type="button" disabled={disabled || !!error} onClick={onClose}>
          {strings.confirmSchedule}
        </button>
      </div>
    </div>
  );
}
