import { useState, type ReactNode } from 'react';
import type { Project } from '../shared/contracts.js';
import { strings } from './strings.js';
interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string) => Promise<boolean>;
  onLogout: () => void;
  busy: boolean;
  controls?: ReactNode;
}
export function ProjectSidebar({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onLogout,
  busy,
  controls,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  return (
    <aside className="project-sidebar" aria-label={strings.projects}>
      <div className="brand">
        <span aria-hidden="true">❧</span>
        {strings.app}
      </div>
      <div className="sidebar-heading">
        <h2>{strings.projects}</h2>
        <button
          type="button"
          aria-label={strings.newProject}
          disabled={busy}
          onClick={() => setAdding(!adding)}
        >
          ＋
        </button>
      </div>
      <nav aria-label={strings.projects}>
        {projects.map((project) => (
          <div
            key={project.id}
            className={`project-item${project.id === selectedId ? ' active' : ''}`}
          >
            <button
              type="button"
              className={`project-link${project.id === selectedId ? ' active' : ''}`}
              title={project.title}
              aria-current={project.id === selectedId ? 'page' : undefined}
              onClick={() => onSelect(project.id)}
              disabled={busy}
            >
              <span aria-hidden="true">♧</span>
              <span className="project-name">{project.title}</span>
            </button>
            {project.id === selectedId && controls}
          </div>
        ))}
      </nav>
      {adding && (
        <form
          className="project-create"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onCreate(title)) {
              setTitle('');
              setAdding(false);
            }
          }}
        >
          <label>
            {strings.projectTitle}
            <input
              autoFocus
              value={title}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <button disabled={busy || !title.trim()}>
            {strings.createProject}
          </button>
        </form>
      )}
      <button
        type="button"
        className="logout"
        disabled={busy}
        onClick={onLogout}
      >
        {strings.logout}
      </button>
    </aside>
  );
}
