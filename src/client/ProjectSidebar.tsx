import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
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
const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
function projectInitials(title: string): string {
  const words =
    title
      .normalize('NFC')
      .toLocaleUpperCase('ru-RU')
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = (word: string) =>
    Array.from(segmenter.segment(word), (part) => part.segment);
  if (words.length > 1) return letters(words[0]!)[0]! + letters(words[1]!)[0]!;
  return words[0] ? letters(words[0]).slice(0, 2).join('') : '•';
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
  const titleInput = useRef<HTMLInputElement>(null);
  const focusTitle = useRef(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [tooltip, setTooltip] = useState<{
    title: string;
    left: number;
    top: number;
  } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelDismiss() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
  }
  function dismissTooltip() {
    cancelDismiss();
    setTooltip(null);
  }
  function scheduleDismiss() {
    cancelDismiss();
    dismissTimer.current = setTimeout(() => setTooltip(null), 120);
  }
  function showTooltip(button: HTMLButtonElement, label: string) {
    cancelDismiss();
    if (!collapsed || window.matchMedia?.('(max-width: 600px)').matches) return;
    const rect = button.getBoundingClientRect();
    setTooltip({
      title: label,
      left: (sidebar.current?.getBoundingClientRect().right ?? rect.right) + 8,
      top: Math.max(8, Math.min(rect.top, window.innerHeight - 160)),
    });
  }
  useLayoutEffect(() => {
    if (focusTitle.current && adding && !collapsed) {
      focusTitle.current = false;
      titleInput.current?.focus();
    }
  }, [adding, collapsed]);
  useEffect(() => {
    const dismiss = () => setTooltip(null);
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', dismissOnEscape);
      cancelDismiss();
    };
  }, []);
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
        active instanceof Element &&
        active.closest('.project-create, .project-controls')
      ) {
        toggle.current?.focus();
      }
    };
    media.addEventListener('change', restoreFocus);
    return () => media.removeEventListener('change', restoreFocus);
  }, [collapsed]);
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
        onClick={() => {
          dismissTooltip();
          onToggle();
        }}
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
            title={strings.newProject}
            disabled={busy}
            onClick={() => {
              if (
                collapsed &&
                !window.matchMedia?.('(max-width: 600px)').matches
              ) {
                focusTitle.current = true;
                setAdding(true);
                onToggle();
              } else setAdding(!adding);
            }}
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
                title={collapsed ? undefined : project.title}
                aria-label={project.title}
                aria-current={project.id === selectedId ? 'page' : undefined}
                onMouseEnter={(event) =>
                  showTooltip(event.currentTarget, project.title)
                }
                onMouseLeave={scheduleDismiss}
                onFocus={(event) =>
                  showTooltip(event.currentTarget, project.title)
                }
                onBlur={dismissTooltip}
                onClick={() => {
                  dismissTooltip();
                  onSelect(project.id);
                }}
                disabled={busy}
              >
                <span className="project-symbol" aria-hidden="true">
                  ♧
                </span>
                <span className="project-initials" aria-hidden="true">
                  {projectInitials(project.title)}
                </span>
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
                ref={titleInput}
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
          aria-label={strings.logout}
          title={strings.logout}
          disabled={busy}
          onClick={onLogout}
        >
          <svg
            className="logout-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4" />
          </svg>
          <span className="logout-label">{strings.logout}</span>
        </button>
      </div>
      {collapsed &&
        tooltip &&
        createPortal(
          <div
            role="tooltip"
            className="project-shortcut-tooltip"
            style={{
              left: tooltip.left,
              top: tooltip.top,
              maxHeight: `calc(100dvh - ${tooltip.top + 8}px)`,
            }}
            onMouseEnter={cancelDismiss}
            onMouseLeave={scheduleDismiss}
          >
            {tooltip.title}
          </div>,
          document.body,
        )}
    </aside>
  );
}
