import type { MouseEvent, PointerEvent } from 'react';
import { strings } from './strings.js';

function preserveEditorFocus(
  event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
) {
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  ) {
    event.preventDefault();
  }
}

export function TaskViewControl({
  showGantt,
  onChange,
}: {
  showGantt: boolean;
  onChange: (show: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label={strings.taskView}
      className="task-view-control"
    >
      <button
        type="button"
        aria-pressed={!showGantt}
        onPointerDown={preserveEditorFocus}
        onMouseDown={preserveEditorFocus}
        onClick={() => onChange(false)}
      >
        {strings.list}
      </button>
      <button
        type="button"
        aria-pressed={showGantt}
        onPointerDown={preserveEditorFocus}
        onMouseDown={preserveEditorFocus}
        onClick={() => onChange(true)}
      >
        {strings.gantt}
      </button>
    </div>
  );
}
