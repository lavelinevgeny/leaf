import type { ProjectView } from './workspace-navigation.js';
export function ProjectViewTabs({
  value,
  onChange,
}: {
  value: ProjectView;
  onChange: (view: ProjectView) => boolean;
}) {
  const values = ['tasks', 'current', 'journal'] as const;
  return (
    <div
      className="project-view-tabs"
      role="tablist"
      aria-label="Представление проекта"
    >
      {values.map((view, index) => (
        <button
          key={view}
          type="button"
          role="tab"
          id={`project-tab-${view}`}
          aria-controls={`project-view-${view}`}
          aria-selected={value === view}
          tabIndex={value === view ? 0 : -1}
          onPointerDown={(event) => {
            if (event.button === 0) event.preventDefault();
          }}
          onClick={(event) => {
            if (onChange(view)) event.currentTarget.focus();
          }}
          onKeyDown={(event) => {
            if (
              ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
            ) {
              event.preventDefault();
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? values.length - 1
                    : (index +
                        (event.key === 'ArrowRight' ? 1 : -1) +
                        values.length) %
                      values.length;
              const next = values[nextIndex]!;
              if (onChange(next))
                document.getElementById(`project-tab-${next}`)?.focus();
            }
          }}
        >
          {view === 'tasks'
            ? 'Задачи'
            : view === 'current'
              ? 'Актуальное'
              : 'Журнал'}
        </button>
      ))}
    </div>
  );
}
