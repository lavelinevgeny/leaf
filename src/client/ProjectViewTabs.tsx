import type { ProjectView } from './workspace-navigation.js';
export function ProjectViewTabs({
  value,
  onChange,
}: {
  value: ProjectView;
  onChange: (view: ProjectView) => void;
}) {
  const values = ['tasks', 'journal'] as const;
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
          onClick={() => onChange(view)}
          onKeyDown={(event) => {
            if (
              ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
            ) {
              event.preventDefault();
              const next =
                values[
                  event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
                ]!;
              onChange(next);
              document.getElementById(`project-tab-${next}`)?.focus();
            }
          }}
        >
          {view === 'tasks' ? 'Задачи' : 'Журнал'}
        </button>
      ))}
    </div>
  );
}
