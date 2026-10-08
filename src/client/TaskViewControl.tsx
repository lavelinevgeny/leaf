import { strings } from './strings.js';

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
        onClick={() => onChange(false)}
      >
        {strings.list}
      </button>
      <button
        type="button"
        aria-pressed={showGantt}
        onClick={() => onChange(true)}
      >
        {strings.gantt}
      </button>
    </div>
  );
}
