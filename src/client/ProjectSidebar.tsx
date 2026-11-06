import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Project } from '../shared/contracts.js';
import { strings } from './strings.js';
interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string, openMenu?: boolean) => void;
  onCreate: (title: string) => Promise<boolean>;
  onLogout: () => void;
  busy: boolean;
  controls?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}
export function ProjectSidebar({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onLogout,
  busy,
  controls,
  collapsed,
  onToggle,
}: Props) {
  const lastFocus = useRef<HTMLElement | null>(null);
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(max-width: 600px)');
    const restoreFocus = () => {
      const active =
        document.activeElement === document.body
          ? lastFocus.current
          : document.activeElement;
      if (!sidebar.current?.contains(active)) return;
      if (media.matches && active === toggle.current) {
        const target =
          content.current?.querySelector<HTMLButtonElement>(
            'button:not(:disabled)',
          ) ??
          document.querySelector<HTMLElement>(
            '.workspace button[aria-pressed="true"]:not(:disabled), .workspace [role="tab"][aria-selected="true"]:not(:disabled)',
          ) ??
          document.querySelector<HTMLElement>('.workspace');
        target?.focus();
      } else if (
        !media.matches &&
        collapsed &&
        content.current?.contains(active)
      ) {
        toggle.current?.focus();
      }
    };
    media.addEventListener('change', restoreFocus);
    return () => media.removeEventListener('change', restoreFocus);
  }, [collapsed]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  return (
    <aside
      ref={sidebar}
      onFocusCapture={(event) => {
        lastFocus.current = event.target as HTMLElement;
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget ||
          (event.target as HTMLElement).getClientRects().length > 0
        )
          lastFocus.current = null;
      }}
      className={`project-sidebar${collapsed ? ' project-sidebar--collapsed' : ''}`}
      aria-label={strings.projects}
    >
      <button
        ref={toggle}
        type="button"
        className="project-sidebar-toggle"
        aria-label={collapsed ? 'Развернуть проекты' : 'Свернуть проекты'}
        title={collapsed ? 'Развернуть проекты' : 'Свернуть проекты'}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
      </button>
      <div ref={content} className="project-sidebar-content">
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
              {project.id === selectedId && controls ? (
                controls
              ) : (
                <div className="project-controls">
                  <button
                    type="button"
                    className="quiet project-menu-trigger"
                    aria-label={strings.projectActions}
                    title={strings.projectActions}
                    aria-expanded={false}
                    disabled={busy}
                    onClick={() => onSelect(project.id, true)}
                  >
                    ⋯
                  </button>
                </div>
              )}
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
      </div>
    </aside>
  );
}
