import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { placeMenu, type MenuPlacement } from './menu-position.js';
import './styles/menu.css';
export interface ActionMenuItem {
  id: string;
  label: string;
  // false: refused or no-op action, focus returns to the trigger.
  onSelect: (trigger: HTMLButtonElement) => boolean | void;
  disabled?: boolean;
  disabledReason?: string | undefined;
  tone?: 'danger';
  separatorBefore?: boolean;
  selected?: boolean;
}
// The trigger stays in the row; the open menu is portaled and fixed so it never
// changes row geometry and is not clipped by scrolling containers.
export function ActionMenu({
  label,
  items,
  open,
  onOpenChange,
  className,
  disabled = false,
  triggerData,
  triggerContent,
}: {
  label: string;
  items: ActionMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className: string;
  disabled?: boolean;
  triggerData?: Record<`data-${string}`, string>;
  triggerContent?: ReactNode;
}) {
  const id = useId();
  const triggerId = `${id}trigger`,
    menuId = `${id}menu`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  const isOpen = useRef(open);
  const focused = useRef(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const unavailable = disabled || items.every((item) => item.disabled);
  useEffect(() => {
    change.current = onOpenChange;
    isOpen.current = open;
  });
  function measure() {
    const button = trigger.current,
      node = menu.current;
    if (!button || !node) return;
    const next = placeMenu(
      button.getBoundingClientRect(),
      { width: node.offsetWidth, height: node.offsetHeight },
      {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
      },
    );
    // Scroll fires often; an unchanged placement must not re-render the menu.
    setPlacement((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.side === next.side
        ? prev
        : next,
    );
  }
  // Closing paths that the user did not aim at the menu keep focus where it is,
  // unless focus was inside the menu and would otherwise fall to <body>: then
  // it goes to the trigger or, when the trigger is disabled, to the nearest
  // focusable owner container (tree row, journal feed).
  function dismiss() {
    const button = trigger.current;
    const hadFocus = !!menu.current?.contains(document.activeElement);
    change.current(false);
    if (!hadFocus || !button?.isConnected) return;
    if (!button.disabled) button.focus({ preventScroll: true });
    else
      button.parentElement
        ?.closest<HTMLElement>('[tabindex]')
        ?.focus({ preventScroll: true });
  }
  const latest = useRef({ measure, dismiss });
  useEffect(() => {
    latest.current = { measure, dismiss };
  });
  useLayoutEffect(() => {
    if (open) latest.current.measure();
    else {
      setPlacement(null);
      focused.current = false;
    }
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !placement || focused.current) return;
    focused.current = true;
    menu.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [open, placement]);
  useEffect(() => {
    if (open && unavailable) latest.current.dismiss();
  }, [open, unavailable]);
  useEffect(
    () => () => {
      if (isOpen.current) change.current(false);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menu.current?.contains(target) || trigger.current?.contains(target))
      )
        return;
      change.current(false);
    };
    const reposition = () => latest.current.measure();
    // Capture phase: Gantt bars and handles stop pointerdown propagation.
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            if (entries.at(-1)?.isIntersecting === false)
              latest.current.dismiss();
          });
    if (trigger.current) observer?.observe(trigger.current);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      observer?.disconnect();
    };
  }, [open]);
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Keys inside the menu never reach row handlers or window shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      change.current(false);
      trigger.current?.focus({ preventScroll: true });
      return;
    }
    const enabled = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    ];
    if (!enabled.length) return;
    // -1 when the menu container itself has focus (pointer on its padding).
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % enabled.length
        : event.key === 'ArrowUp'
          ? index < 0
            ? enabled.length - 1
            : (index - 1 + enabled.length) % enabled.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? enabled.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    enabled[next]?.focus({ preventScroll: true });
  }
  return (
    // Clicks from the portaled menu bubble through React to this wrapper and
    // must not select the row; trigger keys stay global (Ctrl/Cmd+Z, Escape).
    <div className={className} onClick={(event) => event.stopPropagation()}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={unavailable}
        onClick={() => change.current(!open)}
        {...triggerData}
      >
        {triggerContent ?? '⋯'}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-labelledby={triggerId}
            // Focusable container: a click on padding or a separator keeps
            // focus (and Escape/Tab/arrow handling) inside the menu.
            tabIndex={-1}
            className="action-menu"
            data-side={placement?.side}
            style={
              placement
                ? { top: placement.top, left: placement.left }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
            onKeyDown={onMenuKeyDown}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (
                !(next instanceof Node) ||
                menu.current?.contains(next) ||
                trigger.current?.contains(next)
              )
                return;
              change.current(false);
            }}
          >
            {items.map((item) => (
              <Fragment key={item.id}>
                {item.separatorBefore && (
                  <div role="separator" className="action-menu-separator" />
                )}
                <button
                  type="button"
                  role="menuitem"
                  className={item.tone === 'danger' ? 'danger' : undefined}
                  disabled={item.disabled}
                  aria-current={item.selected ? 'true' : undefined}
                  aria-describedby={
                    item.disabledReason
                      ? `${menuId}-${item.id}-reason`
                      : undefined
                  }
                  onClick={() => {
                    const button = trigger.current;
                    change.current(false);
                    if (!button) return;
                    // Accepted actions move focus themselves, possibly later
                    // (journal editor focus is token-based); a guessed fallback
                    // would cancel it, so only an explicit refusal returns here.
                    if (item.onSelect(button) === false)
                      button.focus({ preventScroll: true });
                  }}
                >
                  {item.label}
                  {item.selected && <span aria-hidden="true"> ✓</span>}
                </button>
                {item.disabledReason && (
                  <p id={`${menuId}-${item.id}-reason`} className="field-hint">
                    {item.disabledReason}
                  </p>
                )}
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
