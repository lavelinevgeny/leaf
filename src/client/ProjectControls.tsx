import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Command, Project } from '../shared/contracts.js';
import { ProjectPlan } from './ProjectPlan.js';
import { strings } from './strings.js';
interface Props {
  project: Project;
  disabled: boolean;
  dirty: boolean;
  onSave: (
    command: Extract<Command, { type: 'project.schedule' }>,
  ) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
  rename: string | null;
  onRenameChange: (title: string | null) => void;
  onRename: () => void;
  onOpen: () => boolean;
  onVisibility: (open: boolean) => void;
  feedback: ReactNode;
  initialMenuOpen?: boolean;
}
export function ProjectControls(props: Props) {
  const {
    project,
    disabled,
    dirty,
    onSave,
    onDirty,
    rename,
    onRenameChange,
    onRename,
    onOpen,
    onVisibility,
    feedback,
  } = props;
  const [menu, setMenu] = useState(props.initialMenuOpen ?? false);
  const [action, setAction] = useState<'settings' | 'rename' | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const settingsDirty = useRef(dirty);
  const setSettingsDirty = useCallback(
    (value: boolean) => {
      settingsDirty.current = value;
      onDirty(value);
    },
    [onDirty],
  );
  const visibilityCallback = useRef(onVisibility);
  useEffect(() => {
    visibilityCallback.current = onVisibility;
  }, [onVisibility]);
  useEffect(() => () => visibilityCallback.current(false), []);
  const unsaved =
    action === 'settings' ? dirty : rename !== null && rename !== project.title;
  const close = () => {
    if ((action === 'settings' ? settingsDirty.current : unsaved) || disabled)
      return;
    dialog.current?.close();
    setAction(null);
    onRenameChange(null);
    opener.current?.focus();
  };
  useEffect(() => {
    onVisibility(action !== null);
  }, [action, onVisibility]);
  useEffect(() => {
    if (menu)
      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [menu]);
  useEffect(() => {
    if (action && dialog.current) {
      dialog.current.showModal();
      dialog.current.querySelector<HTMLElement>('input, select')?.focus();
    }
  }, [action]);
  useEffect(() => {
    if (action === 'rename' && rename === null) {
      dialog.current?.close();
      setAction(null);
      opener.current?.focus();
    }
  }, [rename, action]);
  return (
    <div className="project-controls">
      <button
        ref={opener}
        type="button"
        className="quiet project-menu-trigger"
        aria-label={strings.projectActions}
        title={strings.projectActions}
        aria-expanded={menu}
        disabled={disabled}
        onClick={() => setMenu(!menu)}
      >
        ⋯
      </button>
      {menu && (
        <div
          className="project-menu"
          ref={menuRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setMenu(false);
          }}
          onKeyDown={(event) => {
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button',
              ),
            ];
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setMenu(false);
              opener.current?.focus();
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          {(['settings', 'rename'] as const).map((next) => (
            <button
              type="button"
              key={next}
              onClick={() => {
                if (!onOpen()) return;
                setMenu(false);
                if (next === 'rename') onRenameChange(project.title);
                setAction(next);
              }}
            >
              {next === 'settings'
                ? strings.projectPlan
                : strings.renameProject}
            </button>
          ))}
        </div>
      )}
      {action && (
        <dialog
          ref={dialog}
          className="project-dialog"
          aria-label={
            action === 'settings' ? strings.projectPlan : strings.renameProject
          }
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === 'Tab') {
              const focusable = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  'button, input, select, a[href], [tabindex="0"]',
                ),
              ].filter((element) => !element.matches(':disabled'));
              const first = focusable[0];
              const last = focusable.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <h2>
            {action === 'settings'
              ? strings.projectPlan
              : strings.renameProject}
          </h2>
          {feedback}
          {action === 'settings' ? (
            <ProjectPlan
              project={project}
              disabled={disabled}
              onSave={onSave}
              onDirty={setSettingsDirty}
            />
          ) : (
            <form
              className="rename-project"
              onSubmit={(event) => {
                event.preventDefault();
                onRename();
              }}
            >
              <label>
                {strings.projectTitle}
                <input
                  required
                  value={rename ?? ''}
                  maxLength={120}
                  disabled={disabled}
                  onChange={(event) => onRenameChange(event.target.value)}
                />
              </label>
              {unsaved && (
                <div className="project-dialog-draft">
                  <p role="status">{strings.unsaved}</p>
                  <button
                    type="button"
                    className="quiet"
                    disabled={disabled}
                    onClick={() => onRenameChange(project.title)}
                  >
                    {strings.discard}
                  </button>
                </div>
              )}
              <div className="project-dialog-actions">
                <button
                  className="primary"
                  disabled={disabled || !rename?.trim()}
                >
                  {strings.renameProject}
                </button>
                <button type="button" disabled={disabled} onClick={close}>
                  {strings.closeProjectDialog}
                </button>
              </div>
            </form>
          )}
          {action === 'settings' && (
            <>
              {unsaved && <p role="status">{strings.unsaved}</p>}
              <button type="button" disabled={disabled} onClick={close}>
                {strings.closeProjectDialog}
              </button>
            </>
          )}
        </dialog>
      )}
    </div>
  );
}
