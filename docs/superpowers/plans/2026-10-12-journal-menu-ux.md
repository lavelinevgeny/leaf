# Journal Menu UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести меню `⋯` строк дерева и записей журнала на один плавающий доступный компонент, сделать ленты и composer журнала компактными, а после решений владельца R1–R3 убрать дублирующую `+ Подзадача`, modal-composer проекта и постоянную подпись про Undo.

**Architecture:** Чистая функция `placeMenu` считает позицию меню во viewport. `ActionMenu` оставляет триггер в строке, а меню рендерит через `createPortal` в `document.body` с `position: fixed`. Позиция пересчитывается при прокрутке и resize; `IntersectionObserver` закрывает меню, когда триггер перестаёт быть видимым. `TaskTree` и `JournalFeed` хранят состояние open как сейчас и передают пункты. Остальное — изменения JSX и CSS существующих компонентов журнала. Journal API, journal-state, scheduler и схема БД не меняются.

**Tech Stack:** Existing TypeScript 6, React 19 (`react-dom` `createPortal`, `useId`), Vite, Vitest + Testing Library (jsdom), Playwright (проекты `1440x900` и `1280x800`). Node 24.21.0 по `.nvmrc`. Новых пакетов нет.

**Spec:** [Компактные меню действий и журналы — дизайн](../specs/2026-10-12-journal-menu-ux-design.md). Также прочитать: START_HERE.md, AGENTS.md, [спецификацию журнала](../specs/2026-10-10-task-journal-design.md), D21/C21/C24 в [DECISIONS](../../DECISIONS.md), раздел журнала в [UI.md](../../UI.md).

## Global Constraints

- Модель данных, journal API, миграции, `journal-state.ts`, `use-journal.ts`, scheduler, CPM, FS, Undo плана и Гант не меняются.
- Новые npm-зависимости, CDN, шрифты, state-библиотеки не добавляются.
- Высота строк дерева и Ганта не меняется (один синхронизированный flattened-tree, `--leaf-row-height: 38px`).
- Drafts только в памяти; pinned baseline edit/delete, 409, uncertain retry, coherent revisions — без изменений (§5.8 спецификации).
- Тексты пунктов: «Открыть задачу», «Добавить запись», «Добавить подзадачу», «Редактировать запись», «Удалить запись». Имена триггеров: `Действия задачи: <title>`, `Действия записи <workDate>`.
- Решения владельца R1, R2, R3 приняты 2026-10-12, поэтому задачи 7, 6, 8 выполняются. Если владелец отзовёт решение до начала задачи, задача пропускается и отмечается в STATUS как not done. В DECISIONS решения записываются в Task 9, после реализации.
- Только синтетические fixtures; никаких реальных данных, скриншотов владельца и PNG архива в репозитории.
- Каждая задача коммитится только после положительного review. Push, deploy и публикация не разрешены.
- Проверки после каждой задачи, в этом порядке: `npx prettier --write <изменённые файлы задачи>`, затем `npm run typecheck && npm run lint && npm run format:check`, затем затронутые unit- и e2e-файлы. Prettier использует ширину 80 символов (`.prettierrc.json`); сниппеты плана могут быть отформатированы иначе. Полный набор — в Task 9.
- e2e-команды без `--project` прогоняют оба viewport (`1440x900` и `1280x800`). `--project=1440x900` используется только для быстрого подтверждения падения.

## File Structure

| Файл | Ответственность | Задачи |
|---|---|---|
| `src/client/menu-position.ts` (new) | Чистый расчёт позиции меню | 1 |
| `src/client/ActionMenu.tsx` (new) | Триггер, portal, клавиатура, позиция, закрытие | 1 |
| `src/client/styles/menu.css` (new) | Стили `.action-menu` | 1 |
| `src/client/TaskTree.tsx` | Меню строки через `ActionMenu`; при R1 — удаление `.add-child` и меню во всех строках | 2, 7 |
| `src/client/JournalFeed.tsx` | Меню записи через `ActionMenu`; фокус после «Редактировать»/«Удалить» | 3, 8 |
| `src/client/styles/journal.css` | Триггер строки, компактная лента, toolbar, composer | 2, 3, 4, 5, 6, 7 |
| `src/client/styles/planning.css` | Удаление `.add-child` | 7 |
| `src/client/ProjectJournal.tsx` | Toolbar, встроенный composer | 4, 6, 8 |
| `src/client/JournalEditor.tsx` | Компактный composer (`compactIdle`, `placeholder`) | 5 |
| `src/client/TaskJournal.tsx` | Placeholder, `compactIdle`, подпись | 5, 8 |
| `src/client/strings.ts` | Удаление `addChildShort` | 7 |
| `tests/client/menu-position.test.ts` (new) | U01 | 1 |
| `tests/client/action-menu.test.tsx` (new) | U02 | 1 |
| `tests/client/journal-compact.test.tsx` (new) | U05 (jsdom-часть), U06, U08, U09 | 2–6 |
| `tests/e2e/action-menus.spec.ts` (new) | U03, U04, U07, U10, U11, U12 | 2, 3, 4, 6, 7, 8 |
| Existing tests | Адаптация запросов к portal и новым состояниям | 2–8 |
| `docs/UI.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, journal spec | Документация | 9 |

---

### Task 1: ActionMenu primitive

**Files:**
- Create: `src/client/menu-position.ts`
- Create: `src/client/ActionMenu.tsx`
- Create: `src/client/styles/menu.css`
- Test: `tests/client/menu-position.test.ts`
- Test: `tests/client/action-menu.test.tsx`

**Interfaces:**
- Produces:
  - `placeMenu(trigger: MenuBox, size: { width: number; height: number }, viewport: { width: number; height: number }): MenuPlacement`
  - `interface MenuBox { top: number; right: number; bottom: number; left: number }`
  - `interface MenuPlacement { top: number; left: number; side: 'below' | 'above' }`
  - `interface ActionMenuItem { id: string; label: string; onSelect: (trigger: HTMLButtonElement) => boolean | void; disabled?: boolean; tone?: 'danger'; separatorBefore?: boolean }` — `false` означает «действие отклонено или не меняет контекст»: фокус сразу возвращается на триггер. Принятое действие переносит фокус само (в том числе асинхронно), `ActionMenu` его не трогает.
  - `ActionMenu(props: { label: string; items: ActionMenuItem[]; open: boolean; onOpenChange: (open: boolean) => void; className: string; disabled?: boolean; triggerData?: Record<\`data-${string}\`, string> })`

- [ ] **Step 1: Write failing position tests**

`tests/client/menu-position.test.ts`:

```ts
import { expect, it } from 'vitest';
import { placeMenu } from '../../src/client/menu-position.js';

const size = { width: 200, height: 120 };
const desktop = { width: 1440, height: 900 };
const box = (top: number, right: number) => ({
  top,
  bottom: top + 26,
  left: right - 26,
  right,
});

it('places the menu below the trigger, right-aligned', () => {
  expect(placeMenu(box(100, 326), size, desktop)).toEqual({
    top: 130,
    left: 126,
    side: 'below',
  });
});

it('flips above when there is no room below', () => {
  expect(placeMenu(box(850, 326), size, desktop)).toEqual({
    top: 726,
    left: 126,
    side: 'above',
  });
});

it('clamps horizontally inside an 8px viewport margin', () => {
  expect(placeMenu(box(100, 50), size, desktop).left).toBe(8);
  expect(placeMenu(box(100, 1500), size, desktop).left).toBe(1232);
});

it('keeps the menu in a short viewport when neither side fits', () => {
  expect(
    placeMenu(box(60, 326), { width: 200, height: 180 }, {
      width: 1440,
      height: 200,
    }),
  ).toEqual({ top: 12, left: 126, side: 'below' });
});

it('fits a 240px menu on a 375px phone viewport', () => {
  expect(
    placeMenu(box(300, 360), { width: 240, height: 120 }, {
      width: 375,
      height: 812,
    }).left,
  ).toBe(120);
});

it('fits a 200% zoom viewport of 720x450 CSS px', () => {
  expect(
    placeMenu(box(300, 700), size, { width: 720, height: 450 }),
  ).toEqual({ top: 176, left: 500, side: 'above' });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/client/menu-position.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/client/menu-position.js"`.

- [ ] **Step 3: Implement `placeMenu`**

`src/client/menu-position.ts`:

```ts
export interface MenuBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface MenuPlacement {
  top: number;
  left: number;
  side: 'below' | 'above';
}
const gap = 4;
const margin = 8;
// Right-aligned to the trigger, below by default, flipped above when the
// lower edge would leave the viewport, and always clamped inside it.
export function placeMenu(
  trigger: MenuBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPlacement {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const left = Math.min(Math.max(trigger.right - size.width, margin), maxLeft);
  const below = trigger.bottom + gap;
  const above = trigger.top - gap - size.height;
  const fitsBelow = below + size.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  const roomBelow = viewport.height - trigger.bottom;
  const side =
    fitsBelow || (!fitsAbove && roomBelow >= trigger.top) ? 'below' : 'above';
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  const top = Math.min(
    Math.max(side === 'below' ? below : above, margin),
    maxTop,
  );
  return { top, left, side };
}
```

- [ ] **Step 4: Run position tests**

Run: `npx vitest run tests/client/menu-position.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write failing component tests**

`tests/client/action-menu.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ActionMenu,
  type ActionMenuItem,
} from '../../src/client/ActionMenu.js';

let visibility: ((entries: { isIntersecting: boolean }[]) => void) | null =
  null;
class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    visibility = callback;
  }
  observe() {}
  disconnect() {}
}
beforeEach(() => {
  visibility = null;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness({
  items,
  onRow,
  disabled = false,
  mounted = true,
}: {
  items: ActionMenuItem[];
  onRow?: () => void;
  disabled?: boolean;
  mounted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="row"
      style={{ overflow: 'auto' }}
      onKeyDown={onRow}
      onClick={onRow}
    >
      {mounted && (
        <ActionMenu
          className="test-menu"
          label="Действия: A"
          items={items}
          open={open}
          onOpenChange={setOpen}
          disabled={disabled}
          triggerData={{ 'data-test-trigger': 'a' }}
        />
      )}
      <button type="button">Снаружи</button>
      <button type="button" onPointerDown={(event) => event.stopPropagation()}>
        Полоса
      </button>
      <output data-testid="open">{String(open)}</output>
    </div>
  );
}
const items = (onSelect = vi.fn()): ActionMenuItem[] => [
  { id: 'open', label: 'Открыть', onSelect },
  { id: 'off', label: 'Недоступно', onSelect, disabled: true },
  {
    id: 'delete',
    label: 'Удалить',
    onSelect,
    tone: 'danger',
    separatorBefore: true,
  },
];
const trigger = () => screen.getByRole('button', { name: 'Действия: A' });
const rect = (top: number, right: number) =>
  ({
    top,
    bottom: top + 26,
    left: right - 26,
    right,
    x: right - 26,
    y: top,
    width: 26,
    height: 26,
    toJSON: () => ({}),
  }) as DOMRect;

it('opens a portaled labelled menu, focuses the first item and skips disabled items', async () => {
  render(<Harness items={items()} />);
  expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  expect(trigger()).not.toHaveAttribute('aria-controls');
  expect(trigger()).toHaveAttribute('data-test-trigger', 'a');
  await userEvent.click(trigger());
  const menu = screen.getByRole('menu', { name: 'Действия: A' });
  expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  expect(trigger()).toHaveAttribute('aria-controls', menu.id);
  expect(screen.getByTestId('row')).not.toContainElement(menu);
  expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveClass(
    'danger',
  );
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();
  await userEvent.keyboard('{End}');
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
  await userEvent.keyboard('{Home}{ArrowUp}');
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
  expect(screen.getByRole('separator')).toBeInTheDocument();
});

it.each(['{Escape}', '{Tab}', '{Shift>}{Tab}{/Shift}'])(
  '%s closes the menu and returns focus to the trigger',
  async (key) => {
    render(<Harness items={items()} />);
    await userEvent.click(trigger());
    await userEvent.keyboard(key);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  },
);

it('a second trigger click closes the menu', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  await userEvent.click(trigger());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('keeps menu events away from row and window handlers and passes the trigger to onSelect', async () => {
  const onSelect = vi.fn();
  const onRow = vi.fn();
  const onWindow = vi.fn();
  window.addEventListener('keydown', onWindow);
  render(<Harness items={items(onSelect)} onRow={onRow} />);
  await userEvent.click(trigger());
  onRow.mockClear();
  onWindow.mockClear();
  const first = screen.getByRole('menuitem', { name: 'Открыть' });
  fireEvent.keyDown(first, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(first, { key: 'Escape' });
  expect(onRow).not.toHaveBeenCalled();
  expect(onWindow).not.toHaveBeenCalled();
  await userEvent.click(trigger());
  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith(trigger());
  expect(onRow).not.toHaveBeenCalled();
  expect(onWindow).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  window.removeEventListener('keydown', onWindow);
});

it('lets trigger shortcuts such as Ctrl+Z reach window handlers', async () => {
  const onWindow = vi.fn();
  window.addEventListener('keydown', onWindow);
  render(<Harness items={items()} />);
  trigger().focus();
  await userEvent.keyboard('{Control>}z{/Control}');
  expect(onWindow).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'z', ctrlKey: true }),
  );
  window.removeEventListener('keydown', onWindow);
});

it('closes on outside pointerdown without taking focus, but not on its own pointerdown', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Открыть' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  const outside = screen.getByRole('button', { name: 'Снаружи' });
  fireEvent.pointerDown(outside);
  outside.focus();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(outside).toHaveFocus();
});

it('closes on outside pointerdown even when the target stops propagation', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Полоса' }));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('returns focus to the trigger only when onSelect reports a refused action', async () => {
  render(<Harness items={items(vi.fn(() => false))} />);
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));
  expect(trigger()).toHaveFocus();
});

it('leaves focus to an accepted action, even when it moves focus later', async () => {
  render(<Harness items={items(vi.fn())} />);
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(trigger()).not.toHaveFocus();
});

it('repositions on ancestor scroll and resize and closes when the trigger is no longer visible', async () => {
  render(<Harness items={items()} />);
  const spy = vi
    .spyOn(trigger(), 'getBoundingClientRect')
    .mockReturnValue(rect(100, 326));
  await userEvent.click(trigger());
  expect(screen.getByRole('menu')).toHaveStyle({ top: '130px' });
  spy.mockReturnValue(rect(200, 326));
  fireEvent.scroll(screen.getByTestId('row'));
  expect(screen.getByRole('menu')).toHaveStyle({ top: '230px' });
  spy.mockReturnValue(rect(300, 326));
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('menu')).toHaveStyle({ top: '330px' });
  act(() => visibility?.([{ isIntersecting: false }]));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
});

it('closes when focus leaves the menu for another control', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  act(() => screen.getByRole('button', { name: 'Снаружи' }).focus());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Снаружи' })).toHaveFocus();
});

it('closes and resets owner state when the trigger is disabled or unmounted', async () => {
  const { rerender } = render(<Harness items={items()} />);
  await userEvent.click(trigger());
  rerender(<Harness items={items()} disabled />);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByTestId('open')).toHaveTextContent('false');
  rerender(<Harness items={items()} />);
  await userEvent.click(trigger());
  rerender(<Harness items={items()} mounted={false} />);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByTestId('open')).toHaveTextContent('false');
  rerender(<Harness items={items()} />);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('disables the trigger while disabled or when every item is unavailable', async () => {
  const { rerender } = render(<Harness items={items()} disabled />);
  expect(trigger()).toBeDisabled();
  await userEvent.click(trigger());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  rerender(
    <Harness
      items={items().map((item) => ({ ...item, disabled: true }))}
    />,
  );
  expect(trigger()).toBeDisabled();
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `npx vitest run tests/client/action-menu.test.tsx`
Expected: FAIL, `Failed to resolve import "../../src/client/ActionMenu.js"`.

- [ ] **Step 7: Implement `ActionMenu`**

`src/client/ActionMenu.tsx`:

```tsx
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
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
  tone?: 'danger';
  separatorBefore?: boolean;
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
}: {
  label: string;
  items: ActionMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className: string;
  disabled?: boolean;
  triggerData?: Record<`data-${string}`, string>;
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
    setPlacement(
      placeMenu(
        button.getBoundingClientRect(),
        { width: node.offsetWidth, height: node.offsetHeight },
        {
          width: document.documentElement.clientWidth || window.innerWidth,
          height: window.innerHeight,
        },
      ),
    );
  }
  // Closing paths that the user did not aim at the menu keep focus where it is,
  // unless focus was inside the menu and would otherwise fall to <body>.
  function dismiss() {
    const button = trigger.current;
    const hadFocus = !!menu.current?.contains(document.activeElement);
    change.current(false);
    if (hadFocus && button?.isConnected && !button.disabled)
      button.focus({ preventScroll: true });
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
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % enabled.length
        : event.key === 'ArrowUp'
          ? (index - 1 + enabled.length) % enabled.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? enabled.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    enabled[next]?.focus();
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
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-labelledby={triggerId}
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
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
```

Примечания для исполнителя:
- `onBlur` игнорирует `relatedTarget === null` (переключение окна, клик по неинтерактивной области): такие случаи закрывает `pointerdown` или они не должны закрывать меню.

`src/client/styles/menu.css`:

```css
.action-menu {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 200px;
  max-width: min(260px, calc(100vw - 16px));
  padding: var(--leaf-space-1);
  background: var(--leaf-bg);
  border: 1px solid var(--leaf-border);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgb(30 40 50 / 14%);
}
.action-menu [role='menuitem'] {
  min-height: 36px;
  padding: 0 var(--leaf-space-3);
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 14px;
  text-align: start;
  white-space: nowrap;
}
.action-menu [role='menuitem']:not(.danger) {
  color: var(--leaf-text);
}
.action-menu [role='menuitem']:hover:not(:disabled),
.action-menu [role='menuitem']:focus-visible {
  background: var(--leaf-accent-soft);
}
.action-menu [role='menuitem']:disabled {
  color: var(--leaf-text-muted);
}
.action-menu-separator {
  height: 1px;
  margin: var(--leaf-space-1) var(--leaf-space-2);
  background: var(--leaf-border);
}
```

Danger-пункт берёт цвет существующего класса `.danger` (`app.css`), а не `--leaf-critical`: тот закреплён за критическим путём.

- [ ] **Step 8: Run component tests**

Run: `npx vitest run tests/client/action-menu.test.tsx tests/client/menu-position.test.ts`
Expected: PASS, 21 test (6 + 15, считая три случая `it.each`).

- [ ] **Step 9: Format, typecheck, lint, commit**

Run: `npx prettier --write src/client/menu-position.ts src/client/ActionMenu.tsx src/client/styles/menu.css tests/client/menu-position.test.ts tests/client/action-menu.test.tsx && npm run typecheck && npm run lint && npm run format:check`
Expected: без ошибок.

```bash
git add src/client/menu-position.ts src/client/ActionMenu.tsx src/client/styles/menu.css tests/client/menu-position.test.ts tests/client/action-menu.test.tsx
git commit -m "feat: add floating accessible action menu primitive"
```

---

### Task 2: Tree row menu on ActionMenu

**Files:**
- Modify: `src/client/TaskTree.tsx` (props `onSelect`/`onJournal` lines ~15-17; state `menuTask` effect lines ~49-61; menu JSX lines ~306-397)
- Modify: `src/client/App.tsx` (`openTaskJournal` ~349, `selectTask` ~857, `selectSubtask` ~885, `action` ~975, `subtaskAction` ~1620 сообщают результат)
- Modify: `src/client/TaskTimeline.tsx`, `src/client/TaskPanel.tsx` (типы props `onSelect`/`onJournal`/`onAction` → `boolean | void`)
- Modify: `src/client/styles/journal.css` (`.task-row-menu` rules lines ~132-158)
- Modify: `tests/e2e/task-journal.spec.ts:510`, `tests/e2e/journal-drafts.spec.ts:575`
- Create: `tests/e2e/action-menus.spec.ts`
- Create: `tests/client/journal-compact.test.tsx`

**Interfaces:**
- Consumes: `ActionMenu`, `ActionMenuItem` (Task 1).
- Produces: `.task-row-menu` wrapper with trigger `Действия задачи: <title>`; menu `role=menu` with the same name, rendered in `document.body`.

- [ ] **Step 1: Write the failing e2e geometry test**

`tests/e2e/action-menus.spec.ts`:

```ts
import type { Locator, Page } from '@playwright/test';
import { test, expect, seedJournal } from '../helpers/journal-e2e.js';

async function rects(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    }),
  );
}
async function menuInViewport(page: Page) {
  return page.getByRole('menu').evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.bottom - 6,
    );
    return {
      inside:
        r.top >= 0 &&
        r.left >= 0 &&
        r.bottom <= window.innerHeight &&
        r.right <= document.documentElement.clientWidth,
      onTop: !!hit && node.contains(hit),
      side: (node as HTMLElement).dataset.side,
    };
  });
}
async function noHorizontalScroll(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );
}

test('U03/U04 row menu floats above rows without shifting them and stays in viewport', async ({
  page,
  runtime,
}) => {
  await seedJournal(page, runtime);
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto(runtime.origin);
  const rows = page.locator('[role="treeitem"][data-task-id]');
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  const title = last.locator('.task-title');
  const date = last.locator('.task-date');
  const beforeHover = await rects(title.or(date));
  await last.hover();
  expect(await rects(title.or(date))).toEqual(beforeHover);
  const trigger = last.getByRole('button', { name: /^Действия задачи: / });
  await trigger.focus();
  expect(await rects(title.or(date))).toEqual(beforeHover);
  const before = await rects(rows);
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await rects(rows)).toEqual(before);
  expect(await menuInViewport(page)).toEqual({
    inside: true,
    onTop: true,
    side: 'above',
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await rects(rows)).toEqual(before);
});

test('U11/U12 row trigger is at least 28px, fits 375px and a 200% zoom viewport', async ({
  page,
  runtime,
}) => {
  await seedJournal(page, runtime);
  for (const size of [
    { width: 375, height: 812 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(runtime.origin);
    const row = page.locator('[role="treeitem"][data-task-id]').first();
    const trigger = row.getByRole('button', { name: /^Действия задачи: / });
    await row.hover();
    const box = (await trigger.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(28);
    expect(box.height).toBeGreaterThanOrEqual(28);
    await trigger.click();
    expect((await menuInViewport(page)).inside).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.keyboard.press('Escape');
  }
});
```

Заголовок и дата строки — `.task-title` (`TaskTree.tsx:266`) и `.task-date` (`:306`). Если при 1280×420 последняя строка дерева не прижата к нижнему краю (дерево короче viewport), уменьшить высоту viewport или досеять синтетические задачи, а не ослаблять ожидание `side: 'above'`.

- [ ] **Step 2: Write the jsdom regression test (U05)**

`tests/client/journal-compact.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App.js';
import { task } from './fixtures.js';
import { mockJournalApp } from './journal-fixtures.js';

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('U05 row menu "Открыть задачу" opens the task exactly like a row click', async () => {
  mockJournalApp();
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Действия задачи: Работа 1' })[0]!,
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  expect(screen.queryByRole('menu')).toBeNull();
  const panel = await screen.findByRole('complementary', { name: 'Задача' });
  await waitFor(() =>
    expect(panel).toContainElement(document.activeElement as HTMLElement),
  );
  const trigger = () =>
    screen.getAllByRole('button', { name: 'Действия задачи: Работа 1' })[0]!;
  await userEvent.click(trigger());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  expect(trigger()).toHaveFocus();
  await userEvent.click(document.getElementById('tab-journal')!);
  await userEvent.click(trigger());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  await waitFor(() =>
    expect(within(panel).getByLabelText('Название задачи')).toHaveFocus(),
  );
});

it('U05 refused row actions keep focus on the trigger', async () => {
  const server = mockJournalApp();
  server.tree.tasks.push(task(2));
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  const trigger = (title: string) =>
    screen.getAllByRole('button', { name: `Действия задачи: ${title}` })[0]!;
  await userEvent.click(trigger('Работа 1'));
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  const panel = await screen.findByRole('complementary', { name: 'Задача' });
  fireEvent.change(within(panel).getByLabelText('Название задачи'), {
    target: { value: 'Несохранённое название' },
  });
  for (const item of ['Открыть задачу', 'Добавить запись']) {
    await userEvent.click(trigger('Работа 2'));
    expect(
      screen.getByRole('menuitem', { name: 'Добавить подзадачу' }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole('menuitem', { name: item }));
    expect(trigger('Работа 2')).toHaveFocus();
    expect(
      screen.getByText(
        'Сначала сохраните или отбросьте несохранённые изменения.',
      ),
    ).toBeInTheDocument();
  }
});
```

Текст уведомления — `strings.unsaved` (`src/client/strings.ts:178`). «Добавить подзадачу» при грязной панели отключена (`disabled` дерева включает `dirty`, `App.tsx:1876-1885`), поэтому отказ проверяется на выборе и журнале другой задачи: `canNavigate()` отклоняет оба. Если вкладка журнала панели монтируется иначе, найти её так же, как в Task 5 (`#tab-journal`).

Тест фиксирует существующее поведение клика по строке (поле названия панели получает `autoFocus`) и может проходить до изменений; он защищает от регрессии при переходе на portal. Хелпер `openProjectJournal` добавляется в Task 3, где он впервые нужен (`@typescript-eslint/no-unused-vars` — ошибка lint). Повторный выбор «Открыть задачу» той же задачи не перемонтирует панель; `selectTask` возвращает `false`, и `ActionMenu` переводит фокус на триггер (§5.1). Если панель была на вкладке «Журнал» (переключена кликом), «Детали» монтируют форму, и `autoFocus` затем переносит фокус в поле названия.

- [ ] **Step 3: Run and confirm failure**

Run: `npx playwright test tests/e2e/action-menus.spec.ts --project=1440x900 && npx vitest run tests/client/journal-compact.test.tsx`
Expected: e2e FAIL. Текущее меню `absolute` внутри строки у последней строки выходит за нижнюю границу viewport или перекрыто, `side` отсутствует; триггер шириной 26 px. jsdom U05 может уже проходить (см. Step 2).

- [ ] **Step 4: Report refused navigation and replace the row menu**

В `src/client/App.tsx` обработчики выбора сообщают результат, семантика не меняется:

- `openTaskJournal(task, trigger): boolean` — `return false` в существующей ранней проверке (`journalLocked || (selected?.id !== task.id && !canNavigate())`), `return true` в конце;
- `selectTask(task): boolean` — `return false` при `!canNavigate()`. Перед существующими setter'ами вычислить `const reselect = selected?.id === task.id;`, setter'ы оставить как есть и вернуть `!reselect`: повторный выбор не перемонтирует панель (`key={selectedTask.id}`), поэтому фокус сразу уходит на триггер. Если панель была на другой вкладке, «Детали» монтируют форму, и её `autoFocus` затем переносит фокус в поле названия; после клавиатурного переключения вкладок (`keyboardTabChange`, `TaskPanel.tsx:303`) `autoFocus` отключён, и фокус остаётся на триггере, а не теряется;
- `selectSubtask(task): boolean` — `return false` при `!canNavigate()`, `return true` в конце;
- `action(value, task): boolean | void` и `subtaskAction(…): boolean | void` — `return false` в существующих проверках `if (!canNavigate()) return;`; в `subtaskAction` последняя ветка `else return action(value, task);`. Остальные пути без изменений.

Типы props (найти `grep -n "onSelect\|onJournal\|onAction" src/client/TaskTree.tsx src/client/TaskTimeline.tsx src/client/TaskPanel.tsx`): `onSelect: (task: Task) => boolean | void`, `onJournal?: ((task: Task, trigger: HTMLElement) => boolean | void) | undefined`, `onAction: (action: TreeAction, task: Task) => boolean | void`. Остальные вызовы (клик и клавиши строки, Gantt, JournalFeed) результат игнорируют, как сейчас; функция с результатом `boolean | void` присваивается props, ожидающим `=> void`.

В `src/client/TaskTree.tsx` удалить `useEffect` закрытия по `pointerdown` (строки ~50-61; `useEffect` остаётся импортированным, если используется ниже), добавить `import { ActionMenu } from './ActionMenu.js';` и заменить весь блок `{onJournal && task.id !== draftTaskId && (<div className="task-row-menu" …>…</div>)}` на:

```tsx
            {onJournal && task.id !== draftTaskId && (
              <ActionMenu
                className="task-row-menu"
                label={`Действия задачи: ${task.title}`}
                open={menuTask === task.id}
                onOpenChange={(open) => setMenuTask(open ? task.id : null)}
                items={[
                  {
                    id: 'open',
                    label: 'Открыть задачу',
                    onSelect: () => onSelect(task),
                  },
                  {
                    id: 'journal',
                    label: 'Добавить запись',
                    onSelect: (trigger) => onJournal(task, trigger),
                  },
                  {
                    id: 'child',
                    label: strings.addChild,
                    disabled,
                    separatorBefore: true,
                    onSelect: () => onAction('child', task),
                  },
                ]}
              />
            )}
```

Результаты передаются как есть: `false` от `App` (отказ или повторный выбор открытой задачи) возвращает фокус на триггер.

Принятое «Добавить подзадачу» возвращает `undefined`: `onAction('child')` сам переносит фокус в быстрый ввод; отказ `canNavigate()` возвращает `false`. «Добавить запись» передаёт результат `openTaskJournal`: принятое действие фокусирует editor асинхронно по токену `journalFocus` (`App.tsx:2003-2015`), и `ActionMenu` в это время фокус не трогает. Существующие тесты `journal-navigation.test.tsx:752` и e2e «Добавить запись» из меню строки (U05) защищают этот путь.

Обработчик строки (`onKeyDown`, `if (event.target !== event.currentTarget) return;`, строка ~171) уже игнорирует клавиши с триггера, поэтому Shift+Enter на `⋯` не создаёт подзадачу; клик по триггеру и пунктам гасит обёртка `ActionMenu`.

- [ ] **Step 5: Replace row menu CSS**

В `src/client/styles/journal.css` удалить правила `.task-row-menu [role='menu']` и `.task-row-menu [role='menuitem']`, а правила кнопки и видимости заменить на:

```css
.task-row-menu > button {
  opacity: 0;
  width: 28px;
  height: 28px;
  margin-block: -1px;
  padding: 0;
}
.task-row:hover .task-row-menu > button,
.task-row:focus-within .task-row-menu > button,
.task-row-menu > button[aria-expanded='true'] {
  opacity: 1;
}
@media (hover: none) {
  .task-row-menu > button {
    opacity: 1;
  }
}
```

`margin-block: -1px` удерживает высоту строки: у `.task-row` `min-height: 38px` и `padding-block: 6px`, на содержимое остаётся 26 px. `.task-row-menu { margin-inline-end: 96px; … }` пока остаётся: `.add-child` удаляется только в Task 7. Если в файле уже есть правило `(hover: none)` для `.task-row-menu`, объединить с ним.

- [ ] **Step 6: Adapt row-scoped menu queries**

Меню больше не потомок строки:

- `tests/e2e/task-journal.spec.ts:510`: `await expect(row.getByRole('menu')).toBeVisible();` → `await expect(page.getByRole('menu')).toBeVisible();`
- `tests/e2e/journal-drafts.spec.ts:575`: `await row.getByRole('menuitem', { name: 'Добавить запись' }).click();` → `await page.getByRole('menuitem', { name: 'Добавить запись' }).click();`

Найти оставшиеся случаи, включая многострочные цепочки: `grep -rn -B2 "getByRole('menu" tests`. Для строк дерева заменить поиск внутри строки на `page.`/`screen.`. Карточки записей — в Task 3.

- [ ] **Step 7: Run affected tests**

Run: `npx playwright test tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts && npx vitest run tests/client/journal-compact.test.tsx tests/client/journal-navigation.test.tsx tests/client/journal.test.tsx tests/client/action-menu.test.tsx tests/client/inline-add.test.tsx`
Expected: PASS. Если jsdom-тест `row menu journal focus waits for mounted editor…` (`journal-navigation.test.tsx:752`) падает из-за фокуса, проверить, что `onJournal` получает `trigger` из `onSelect`, а не из `closest('.task-row-menu')`.

- [ ] **Step 8: Format, typecheck, lint, commit**

Run: `npx prettier --write src/client/TaskTree.tsx src/client/App.tsx src/client/TaskTimeline.tsx src/client/TaskPanel.tsx src/client/styles/journal.css tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/client/journal-compact.test.tsx && npm run typecheck && npm run lint && npm run format:check`

```bash
git add src/client/TaskTree.tsx src/client/App.tsx src/client/TaskTimeline.tsx src/client/TaskPanel.tsx src/client/styles/journal.css tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/client/journal-compact.test.tsx
git commit -m "refactor: render task row actions in floating menu"
```

---

### Task 3: Journal entry menu and compact feed

**Files:**
- Modify: `src/client/JournalFeed.tsx` (outside-close effect lines ~41-52; header/menu JSX lines ~296-385; delete confirmation ~396-425)
- Modify: `src/client/styles/journal.css` (`.journal-feed`, `.journal-entry*`, `.journal-task-link`, `.journal-body`)
- Modify: `tests/helpers/journal-e2e.ts` (`editEntry`)
- Modify: `tests/e2e/task-journal.spec.ts:88-89,100-101`, `tests/e2e/journal-drafts.spec.ts:146,184,262`
- Modify: `tests/e2e/action-menus.spec.ts`, `tests/client/journal-compact.test.tsx`

**Interfaces:**
- Consumes: `ActionMenu` (Task 1); existing `controller.openEdit`, `controller.askDelete`.
- Produces: `.journal-entry-menu` wrapper; trigger keeps `data-journal-menu={entry.id}` and name `Действия записи <workDate>`; кнопка «Отмена удаления» получает `data-journal-cancel-delete`; DOM `section[data-journal-entry] > h3? + article > header` сохраняется (на неё опирается `journalGeometry`).

- [ ] **Step 1: Add failing e2e tests**

Дописать в `tests/e2e/action-menus.spec.ts` (добавить импорты `createJournalEntry`, `openProjectJournal`, `projectFeed`, `entryCard` из `../helpers/journal-e2e.js`):

```ts
async function seedEntries(
  page: Page,
  runtime: Parameters<typeof seedJournal>[1],
) {
  const { tree, summaryId, deepId } = await seedJournal(page, runtime);
  let revision = 0;
  const ids: string[] = [];
  for (const [day, taskId] of [
    ['2026-10-07', summaryId],
    ['2026-10-08', deepId],
    ['2026-10-10', summaryId],
    ['2026-10-10', deepId],
  ] as const) {
    const result = await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      taskId,
      revision,
      `Синтетическая запись ${day} ${'длинный текст '.repeat(12)}`,
      day,
    );
    if (result.kind !== 'saved') throw new Error('Missing saved entry');
    revision = result.journalRevision;
    ids.push(result.entry.id);
  }
  return { tree, ids };
}

test('U03/U04 entry menu floats without resizing entries and flips at the bottom edge', async ({
  page,
  runtime,
}) => {
  const { ids } = await seedEntries(page, runtime);
  await page.setViewportSize({ width: 1280, height: 520 });
  await openProjectJournal(page, runtime.origin);
  const entries = projectFeed(page).locator('[data-journal-entry-id]');
  await expect(entries).toHaveCount(4);
  const oldest = entryCard(page, ids[0]!);
  await oldest.scrollIntoViewIfNeeded();
  const before = await rects(entries);
  const scrollTop = () =>
    projectFeed(page)
      .locator('[data-journal-scroll]')
      .evaluate((node) => Math.round(node.scrollTop));
  const top = await scrollTop();
  const trigger = oldest.getByRole('button', { name: /^Действия записи / });
  await trigger.click();
  await expect(
    page.getByRole('menuitem', { name: 'Удалить запись' }),
  ).toBeVisible();
  expect(await rects(entries)).toEqual(before);
  expect(await scrollTop()).toBe(top);
  expect(await menuInViewport(page)).toEqual({
    inside: true,
    onTop: true,
    side: 'above',
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await rects(entries)).toEqual(before);
  expect(await scrollTop()).toBe(top);
});

test('U11/U12 entry trigger is at least 28px, its menu fits 375px and a 200% zoom viewport', async ({
  page,
  runtime,
}) => {
  const { ids } = await seedEntries(page, runtime);
  for (const size of [
    { width: 375, height: 812 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize(size);
    await openProjectJournal(page, runtime.origin);
    const trigger = entryCard(page, ids[3]!).getByRole('button', {
      name: /^Действия записи /,
    });
    await trigger.hover();
    const box = (await trigger.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(28);
    expect(box.height).toBeGreaterThanOrEqual(28);
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect((await menuInViewport(page)).inside).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.keyboard.press('Escape');
  }
});
```

Если при 1280×520 последняя запись не прижата к нижнему краю ленты (лента короче viewport), увеличить число записей в `seedEntries` до появления прокрутки, а не ослаблять ожидание `side: 'above'`.

- [ ] **Step 2: Add failing jsdom focus test (U05)**

Дописать в `tests/client/journal-compact.test.tsx` хелпер и тест:

```tsx
async function openProjectJournal() {
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  await screen.findByText('Original synthetic text');
}

it('U05 entry menu moves focus into the editor or the safe delete choice', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const feed = document.querySelector<HTMLElement>(
    '[data-journal-feed="project"]',
  )!;
  const menu = () =>
    within(feed).getByRole('button', { name: 'Действия записи 2024-02-29' });
  await userEvent.click(menu());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Редактировать запись' }),
  );
  await waitFor(() =>
    expect(within(feed).getByLabelText('Текст записи')).toHaveFocus(),
  );
  await userEvent.click(
    within(feed).getByRole('button', { name: 'Закрыть редактор' }),
  );
  await userEvent.click(menu());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Удалить запись' }),
  );
  await waitFor(() =>
    expect(
      within(feed).getByRole('button', { name: 'Отмена удаления' }),
    ).toHaveFocus(),
  );
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx playwright test tests/e2e/action-menus.spec.ts --project=1440x900 -g "U03/U04 entry" && npx vitest run tests/client/journal-compact.test.tsx -t U05`
Expected: FAIL: `rects(entries)` меняется после открытия меню (меню в потоке карточки), `side` отсутствует; после выбора пунктов фокус теряется.

- [ ] **Step 4: Replace the entry menu**

В `src/client/JournalFeed.tsx`:

1. Удалить `useEffect` закрытия меню по `pointerdown` (строки ~41-52).
2. Добавить `import { ActionMenu } from './ActionMenu.js';`.
3. Добавить рядом с `restoreMenu` функцию переноса фокуса после отрисовки:

```tsx
  const focusInEntry = (id: string, selector: string) => {
    const owned = document.activeElement;
    requestAnimationFrame(() => {
      // Same guards as restoreMenu: a hidden feed or a later focus choice wins.
      if (
        root.current?.closest('[hidden]') ||
        (document.activeElement !== owned &&
          document.activeElement !== document.body)
      )
        return;
      root.current
        ?.querySelector<HTMLElement>(
          `[data-journal-entry-id="${id}"] ${selector}`,
        )
        ?.focus();
    });
  };
```

4. Заменить кнопку `data-journal-menu` внутри `<header>` и весь следующий за `</header>` блок `{menu === entry.id && (<div role="menu" …>…</div>)}` на один элемент внутри `<header>` после ссылки на задачу:

```tsx
                <ActionMenu
                  className="journal-entry-menu"
                  label={`Действия записи ${entry.workDate}`}
                  open={menu === entry.id}
                  onOpenChange={(open) => setMenu(open ? entry.id : null)}
                  disabled={!coherent || blocked}
                  triggerData={{ 'data-journal-menu': entry.id }}
                  items={[
                    {
                      id: 'edit',
                      label: 'Редактировать запись',
                      onSelect: () => {
                        setEditing(
                          controller.openEdit(
                            entry,
                            state.page!.journalRevision,
                          ),
                        );
                        focusInEntry(
                          entry.id,
                          '[data-journal-editor] textarea',
                        );
                      },
                    },
                    {
                      id: 'delete',
                      label: 'Удалить запись',
                      tone: 'danger',
                      separatorBefore: true,
                      onSelect: () => {
                        controller.askDelete(
                          entry,
                          state.page!.journalRevision,
                        );
                        focusInEntry(entry.id, '[data-journal-cancel-delete]');
                      },
                    },
                  ]}
                />
```

5. Кнопке «Отмена удаления» в блоке подтверждения добавить атрибут `data-journal-cancel-delete`.

Сверить точные условия `disabled` старой кнопки-триггера (строка ~315) и перенести их без изменений. `restoreMenu`, `finishDelete`, подтверждение удаления и inline-редактор не меняются: они находят триггер по `[data-journal-menu="id"]`, а триггер остаётся в карточке. Атрибут `data-journal-entry-id` у секции записи уже есть (на него опирается `entryCard`).

- [ ] **Step 5: Compact feed CSS**

В `src/client/styles/journal.css` заменить правила `.journal-feed { overflow… padding: 0 1rem 1rem; }`, `.journal-entry`, `.journal-entry h3`, `.journal-entry article`, `.journal-entry header`, `.journal-task-link`, `.journal-body` на:

```css
.journal-feed {
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding: 0 0 var(--leaf-space-4);
}
.journal-entry {
  max-width: 960px;
  margin: 0;
}
.journal-entry h3 {
  display: flex;
  align-items: center;
  gap: var(--leaf-space-3);
  margin: var(--leaf-space-4) 0 var(--leaf-space-1);
  color: var(--leaf-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.journal-entry h3::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--leaf-border);
}
.journal-entry article {
  position: relative;
  padding: 10px 40px 10px 20px;
  border-bottom: 1px solid var(--leaf-border);
}
.journal-entry article::before {
  content: '';
  position: absolute;
  top: 17px;
  left: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--leaf-accent);
}
.journal-task-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--leaf-accent);
  font-size: 13px;
  font-weight: 600;
  text-align: start;
}
.journal-body {
  margin: 2px 0 0;
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.journal-entry-menu {
  position: absolute;
  top: 6px;
  right: 4px;
}
.journal-entry-menu > button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
}
.journal-entry article:hover .journal-entry-menu > button,
.journal-entry article:focus-within .journal-entry-menu > button,
.journal-entry-menu > button[aria-expanded='true'] {
  opacity: 1;
}
@media (hover: none) {
  .journal-entry-menu > button {
    opacity: 1;
  }
}
```

Повторное объявление `.journal-feed { position: relative; }` ниже в файле сохранить. `.task-journal .journal-feed { padding: 0.5rem 0; }` сохранить. Выравнивание ленты с toolbar проверяется в Task 4, когда «Добавить запись» становится первой кнопкой.

- [ ] **Step 6: Adapt card-scoped menu queries**

- `tests/helpers/journal-e2e.ts` `editEntry`: `await card.getByRole('menuitem', { name: 'Редактировать запись' }).click();` → `await card.page().getByRole('menuitem', { name: 'Редактировать запись' }).click();`
- `tests/e2e/task-journal.spec.ts:88-89,100-101`, `tests/e2e/journal-drafts.spec.ts:146,184,262`: `card.getByRole('menuitem', …)` и многострочные цепочки `entryCard(...)\n  .getByRole('menuitem', …)` → `page.getByRole('menuitem', …)`.

Проверка: `grep -rn -B2 "getByRole('menuitem'" tests` — перед каждым совпадением стоит `page`, `screen` или `card.page()`, а не карточка или строка.

- [ ] **Step 7: Run affected tests**

Run: `npx playwright test tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/journal-navigation.spec.ts && npx vitest run tests/client/journal-compact.test.tsx tests/client/journal.test.tsx tests/client/journal-navigation.test.tsx tests/client/journal-drafts.test.tsx tests/client/journal-coherence.test.tsx tests/client/journal-context.test.tsx`
Expected: PASS. `journalGeometry` продолжает находить `article` и `.journal-controls`.

- [ ] **Step 8: Format, typecheck, lint, commit**

Run: `npx prettier --write src/client/JournalFeed.tsx src/client/styles/journal.css tests/helpers/journal-e2e.ts tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/client/journal-compact.test.tsx && npm run typecheck && npm run lint && npm run format:check`

```bash
git add src/client/JournalFeed.tsx src/client/styles/journal.css tests/helpers/journal-e2e.ts tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/client/journal-compact.test.tsx
git commit -m "feat: compact journal feed with floating entry menu"
```

---

### Task 4: Project journal toolbar

**Files:**
- Modify: `src/client/ProjectJournal.tsx` (toolbar JSX lines ~133-215)
- Modify: `src/client/styles/journal.css` (`.journal-notice`, `.journal-controls`)
- Modify: `tests/client/journal.test.tsx:137`, `tests/e2e/task-journal.spec.ts:175`
- Modify: `tests/client/journal-compact.test.tsx`, `tests/e2e/action-menus.spec.ts`

**Interfaces:**
- Produces: `export function periodLabel(query: JournalProjectQuery): string` в `ProjectJournal.tsx`; кнопка периода с доступным именем `Период: <periodLabel>`.

- [ ] **Step 1: Write failing tests**

Дописать в `tests/client/journal-compact.test.tsx` (`import { periodLabel } from '../../src/client/ProjectJournal.js';`):

```tsx
it('formats the applied period', () => {
  expect(periodLabel({})).toBe('Все даты');
  expect(periodLabel({ from: '2026-10-01' })).toBe('с 01.10.2026');
  expect(periodLabel({ to: '2026-10-10' })).toBe('по 10.10.2026');
  expect(periodLabel({ from: '2026-10-01', to: '2026-10-10' })).toBe(
    '01.10.2026 – 10.10.2026',
  );
});

it('U06 shows reset only for an applied period, labels the applied range and reset clears it', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Добавить запись' }),
  ).toHaveTextContent('+');
  await userEvent.click(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  );
  fireEvent.change(screen.getByLabelText('С даты'), {
    target: { value: '2026-10-01' },
  });
  expect(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Применить' }));
  await screen.findByRole('button', { name: 'Период: с 01.10.2026' });
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
  expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  ).toHaveFocus();
});

it('U06 shows reset for an applied search query', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  fireEvent.change(screen.getByLabelText('Поиск записей'), {
    target: { value: 'Original' },
  });
  await screen.findByRole('button', { name: 'Сбросить' });
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull(),
  );
});
```

Если черновик дат в popover появляется только после «Применить» иначе, чем здесь, свериться с существующим тестом периода в `tests/client/journal.test.tsx:137-147`. Если сброс поиска в шапке не очищает поле «Поиск записей», так и оставить: требование касается применённого запроса.

Дописать в `tests/e2e/action-menus.spec.ts` тест выравнивания (U07):

```ts
test('U07 feed dates align with the first toolbar action', async ({
  page,
  runtime,
}) => {
  await seedEntries(page, runtime);
  await openProjectJournal(page, runtime.origin);
  const align = await projectFeed(page).evaluate((node) => {
    const add = node
      .querySelector('[data-journal-add]')!
      .getBoundingClientRect();
    const date = node
      .querySelector('[data-journal-date]')!
      .getBoundingClientRect();
    return { add: Math.round(add.x), date: Math.round(date.x) };
  });
  expect(Math.abs(align.add - align.date)).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/client/journal-compact.test.tsx -t "U06|formats" && npx playwright test tests/e2e/action-menus.spec.ts --project=1440x900 -g U07`
Expected: FAIL: `periodLabel` не экспортирован, кнопки `Период: Все даты` нет, «Добавить запись» не первая в toolbar.

- [ ] **Step 3: Implement toolbar changes**

В `src/client/ProjectJournal.tsx` над компонентом:

```tsx
const displayDate = (value: string) => value.split('-').reverse().join('.');
export function periodLabel(query: JournalProjectQuery) {
  if (query.from && query.to)
    return `${displayDate(query.from)} – ${displayDate(query.to)}`;
  if (query.from) return `с ${displayDate(query.from)}`;
  if (query.to) return `по ${displayDate(query.to)}`;
  return 'Все даты';
}
```

Внутри `<form className="journal-controls">`:

1. Перенести кнопку `data-journal-add` («Добавить запись», `className="primary"`) первой в форме, без изменения её props; содержимое — `<span aria-hidden="true">+ </span>Добавить запись`.
2. Кнопку периода: текст `{periodLabel(query)}` — по применённому `query`, не по черновику `filters`; добавить `aria-label={`Период: ${periodLabel(query)}`}`, удалить суффикс `' •'`.
3. Кнопку «Сбросить» обернуть условием и вернуть фокус на период:

```tsx
        {(query.q || query.from || query.to) && (
          <button
            type="button"
            onClick={() => {
              setFilters({});
              setInvalid(false);
              onQuery({});
              periodTrigger.current?.focus();
            }}
          >
            Сбросить
          </button>
        )}
```

Сверить с текущим обработчиком «Сбросить» (строки ~195-210) и сохранить его остальные действия.

В `src/client/styles/journal.css` заменить `.journal-notice { min-height: 21px; margin: 0 0 4px; }` на:

```css
.journal-notice {
  margin: 0;
  font-size: 12px;
}
```

Горизонтальный padding `.journal-controls` привести к `padding-inline` ленты (`0`, Task 3), чтобы первая дата и «Добавить запись» начинались с одного края. Если у вида журнала общий padding контейнера, достаточно убрать собственный padding у toolbar.

- [ ] **Step 4: Update existing period queries**

- `tests/client/journal.test.tsx:137`: `{ name: 'Период' }` → `{ name: 'Период: Все даты' }`.
- `tests/e2e/task-journal.spec.ts:175`: `{ name: 'Период', exact: true }` → `{ name: /^Период: / }`.

Проверка: `grep -rn "name: 'Период'" tests` пуст.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/client/journal-compact.test.tsx tests/client/journal.test.tsx tests/client/journal-navigation.test.tsx && npx playwright test tests/e2e/task-journal.spec.ts tests/e2e/action-menus.spec.ts`
Expected: PASS.

- [ ] **Step 6: Format, typecheck, lint, commit**

Run: `npx prettier --write src/client/ProjectJournal.tsx src/client/styles/journal.css tests/client/journal-compact.test.tsx tests/client/journal.test.tsx tests/e2e/task-journal.spec.ts tests/e2e/action-menus.spec.ts && npm run typecheck && npm run lint && npm run format:check`

```bash
git add src/client/ProjectJournal.tsx src/client/styles/journal.css tests/client/journal-compact.test.tsx tests/client/journal.test.tsx tests/e2e/task-journal.spec.ts tests/e2e/action-menus.spec.ts
git commit -m "feat: single-row project journal toolbar with conditional reset"
```

---

### Task 5: Compact task composer

**Files:**
- Modify: `src/client/JournalEditor.tsx` (props, form layout lines ~34-140)
- Modify: `src/client/TaskJournal.tsx` (pass `placeholder`, `compactIdle`; focus after save/clear)
- Modify: `src/client/styles/journal.css` (`.journal-editor*`)
- Modify: `tests/client/journal-compact.test.tsx`

**Interfaces:**
- Produces: `JournalEditor` props `placeholder?: string` и `compactIdle?: boolean`. Пустое состояние при `compactIdle`: `!draft.entryId && draft.body === '' && !controller.mutationError && !conflict && !controller.uncertain && controller.pending?.key !== draft.key` — скрывает только «Сохранить запись». «Очистить черновик» видна при `draft.dirty || draft.body !== ''`: `dirty` не сбрасывается после стирания текста (`use-journal.ts:443`), а такой черновик защищён D21 и должен оставаться сбрасываемым. После сохранения или очистки фокус переносится в поле текста нового черновика.
- Modal проекта `compactIdle` не получает: без R2 он сохраняет все кнопки (§5.7 спецификации), поэтому `tests/client/journal.test.tsx:381-401` и `tests/e2e/task-journal.spec.ts:256` в этой задаче не меняются.

- [ ] **Step 1: Write failing test**

Дописать в `tests/client/journal-compact.test.tsx` (`import { api } from '../../src/client/api.js';`):

```tsx
async function openTaskJournal() {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Работа 1' })[0]!,
  );
  await waitFor(() =>
    expect(document.getElementById('tab-journal')).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  return screen.getByRole('complementary', { name: 'Задача' });
}

it('U08 untouched task composer has no actions; erased text keeps only clear', async () => {
  const panel = await openTaskJournal();
  const body = within(panel).getByLabelText('Текст записи');
  const save = () =>
    within(panel).queryByRole('button', { name: 'Сохранить запись' });
  const clear = () =>
    within(panel).queryByRole('button', { name: 'Очистить черновик' });
  expect(body).toHaveAttribute(
    'placeholder',
    'Что сделали или узнали по задаче?',
  );
  expect(save()).toBeNull();
  expect(clear()).toBeNull();
  const hint = document.getElementById(body.getAttribute('aria-describedby')!)!;
  expect(hint).toHaveClass('sr-only');
  expect(hint).toHaveTextContent('Нужны дата и непустой текст');
  fireEvent.change(body, { target: { value: 'Проверил сборку' } });
  expect(save()).toBeEnabled();
  expect(clear()).toBeInTheDocument();
  expect(hint).not.toHaveClass('sr-only');
  fireEvent.change(body, { target: { value: '' } });
  expect(save()).toBeNull();
  expect(clear()).toBeInTheDocument();
});

it('U08 a changed date with empty text shows clear; empty or invalid date shows the hint', async () => {
  const panel = await openTaskJournal();
  const date = within(panel).getByLabelText('Дата записи');
  const body = within(panel).getByLabelText('Текст записи');
  const hint = document.getElementById(body.getAttribute('aria-describedby')!)!;
  fireEvent.change(date, { target: { value: '01.10.2026' } });
  expect(
    within(panel).getByRole('button', { name: 'Очистить черновик' }),
  ).toBeInTheDocument();
  expect(
    within(panel).queryByRole('button', { name: 'Сохранить запись' }),
  ).toBeNull();
  expect(hint).toHaveClass('sr-only');
  fireEvent.change(date, { target: { value: '31.02.2026' } });
  expect(hint).not.toHaveClass('sr-only');
  fireEvent.change(date, { target: { value: '' } });
  expect(hint).not.toHaveClass('sr-only');
});

it('U08 save and clear return focus to the text field', async () => {
  const panel = await openTaskJournal();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const body = () => within(panel).getByLabelText('Текст записи');
  fireEvent.change(body(), { target: { value: 'Проверил сборку' } });
  await userEvent.click(
    within(panel).getByRole('button', { name: 'Сохранить запись' }),
  );
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledOnce());
  await waitFor(() => expect(body()).toHaveFocus());
  expect(body()).toHaveValue('');
  fireEvent.change(body(), { target: { value: 'Черновик' } });
  await userEvent.click(
    within(panel).getByRole('button', { name: 'Очистить черновик' }),
  );
  await waitFor(() => expect(body()).toHaveFocus());
  expect(body()).toHaveValue('');
});

it('U08 Ctrl+Enter saves and a failed save keeps the text', async () => {
  const panel = await openTaskJournal();
  const body = within(panel).getByLabelText('Текст записи');
  vi.mocked(api.journalCreate).mockRejectedValueOnce(new Error('synthetic'));
  fireEvent.change(body, { target: { value: 'Проверил сборку' } });
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledOnce());
  await within(panel).findByRole('alert');
  expect(body).toHaveValue('Проверил сборку');
  expect(
    within(panel).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeInTheDocument();
});

it('U08 the edit editor always shows save and close', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const feed = document.querySelector<HTMLElement>(
    '[data-journal-feed="project"]',
  )!;
  await userEvent.click(
    within(feed).getByRole('button', { name: 'Действия записи 2024-02-29' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Редактировать запись' }),
  );
  fireEvent.change(within(feed).getByLabelText('Текст записи'), {
    target: { value: '' },
  });
  expect(
    within(feed).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeInTheDocument();
  expect(
    within(feed).getByRole('button', { name: 'Закрыть редактор' }),
  ).toBeInTheDocument();
});
```

`new Error('synthetic')` — не `ApiError`, поэтому это путь uncertain: появятся alert «Результат сохранения неизвестен…» и «Повторить сохранение», а «Сохранить запись» останется в DOM (disabled). Тест проверяет именно сохранение текста и наличие кнопки; не заменять отказ на ошибку валидации. `CalendarDateInput` принимает `ДД.ММ.ГГГГ`, вызывает `onChange` на `change` и отдаёт сырую строку для невалидной даты (`CalendarDateInput.tsx:5-11`).

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/client/journal-compact.test.tsx -t U08`
Expected: FAIL: нет placeholder, «Сохранить запись» присутствует при пустом тексте, подсказка не `.sr-only`.

- [ ] **Step 3: Implement composer layout**

В `src/client/JournalEditor.tsx`:

1. Добавить props `placeholder?: string` и `compactIdle?: boolean` (по умолчанию `false`) в деструктуризацию и тип.
2. После `const conflict = …` добавить:

```tsx
  const idle =
    compactIdle &&
    !draft.entryId &&
    draft.body === '' &&
    !controller.mutationError &&
    !conflict &&
    !controller.uncertain &&
    controller.pending?.key !== draft.key;
  const showClear = !compactIdle || draft.dirty || draft.body !== '';
  const hintVisible =
    !compactIdle ||
    draft.body !== '' ||
    !calendarDateSchema.safeParse(draft.workDate).success;
```

Импорт: `import { calendarDateSchema } from '../shared/contracts.js';` (тот же, что в `CalendarDateInput.tsx:2`).

3. Порядок внутри `<form>`: `{taskPicker}`, поле текста, подсказка, alert'ы и конфликт, затем подвал с датой и действиями. Заменить блоки `CalendarDateInput`, `<label>…textarea…</label>`, `<p id={id}…>` на:

```tsx
      {taskPicker}
      <label>
        <span className={compactIdle ? 'sr-only' : undefined}>
          Текст записи
        </span>
        <textarea
          data-journal-body
          value={draft.body}
          rows={compactIdle ? 3 : 5}
          placeholder={placeholder}
          disabled={locked}
          aria-describedby={id}
          onChange={(event) =>
            controller.changeDraft(draft.key, { body: event.target.value })
          }
        />
      </label>
      <p id={id} className={hintVisible ? 'journal-hint' : 'journal-hint sr-only'}>
        {draft.body.length}/10000 · Нужны дата и непустой текст. Ctrl/Cmd+Enter
        — сохранить.
      </p>
```

4. Блоки `unavailableTaskIds`, `mutationError` и `JournalConflict` оставить сразу после подсказки без изменений.
5. Заменить `<div className="journal-editor-actions">…</div>` на подвал, где дата и действия в одной строке:

```tsx
      <div className="journal-editor-footer">
        <CalendarDateInput
          label="Дата записи"
          value={draft.workDate}
          disabled={locked}
          invalid={!draft.workDate}
          descriptionId={id}
          onChange={(value) =>
            controller.changeDraft(draft.key, { workDate: value ?? '' })
          }
        />
        <div className="journal-editor-actions">
          {/* «Сохранить запись» обёрнута в {!idle && (…)},
              «Очистить черновик» — в {showClear && (…)};
              «Повторить сохранение» и «Закрыть редактор» — без изменений */}
        </div>
      </div>
```

Кнопки внутри `journal-editor-actions` переносятся из текущего блока без изменения props и обработчиков. Обработчик Ctrl/Cmd+Enter на `<form>` не меняется.

В `src/client/TaskJournal.tsx` передать `placeholder="Что сделали или узнали по задаче?"` и `compactIdle` в `JournalEditor` создания. Inline-редактор записи в `JournalFeed` props не получает. В `onSaved` (вызывается и после сохранения, и после очистки) после `setKey(...)` вернуть фокус в поле текста, если пользователь не увёл его в другое место:

```tsx
  const focusComposer = () =>
    requestAnimationFrame(() => {
      const node = root.current,
        active = document.activeElement;
      if (
        !node ||
        node.closest('[hidden]') ||
        (active !== document.body && !node.contains(active))
      )
        return;
      node
        .querySelector<HTMLTextAreaElement>('[data-journal-editor] textarea')
        ?.focus({ preventScroll: true });
    });
```

`onSaved={() => { setKey(controller.openCreate(task.projectId, task.id, today)); focusComposer(); }}`.

В `src/client/styles/journal.css` заменить `.journal-editor textarea { … min-height: 110px; }` и добавить подвал:

```css
.journal-editor textarea {
  resize: vertical;
  width: 100%;
  min-height: 72px;
}
.journal-editor-footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--leaf-space-2);
  align-items: end;
  justify-content: space-between;
}
.journal-editor .journal-hint {
  margin: 0;
  padding: 0;
}
```

- [ ] **Step 4: Check tests depending on composer buttons**

Найти утверждения о кнопках пустого composer задачи: `grep -rn -B3 -A3 "Очистить черновик\|Сохранить запись" tests/client tests/e2e`. Менять только те, что относятся к **пустому черновику создания в панели задачи**: `toBeDisabled()` → `expect(queryByRole(...)).toBeNull()`. Утверждения modal проекта, inline-редактора и непустых черновиков не меняются. Каждую правку перечислить в коммите.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/client && npx playwright test tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/journal-navigation.spec.ts`
Expected: PASS.

- [ ] **Step 6: Format, typecheck, lint, commit**

Run: `npx prettier --write src/client/JournalEditor.tsx src/client/TaskJournal.tsx src/client/styles/journal.css tests/client/journal-compact.test.tsx && npm run typecheck && npm run lint && npm run format:check`

```bash
git add src/client/JournalEditor.tsx src/client/TaskJournal.tsx src/client/styles/journal.css tests/client/journal-compact.test.tsx
git commit -m "feat: compact journal composer actions until text is entered"
```

Если в Step 4 менялись другие тесты, добавить их файлы в `git add` явным списком.

---

### Task 6: [R2] Inline project composer

**Gate:** R2 принято владельцем 2026-10-12.

**Files:**
- Modify: `src/client/ProjectJournal.tsx` (dialog effect lines ~85-104; dialog JSX lines ~237-298)
- Modify: `src/client/styles/journal.css` (`.journal-dialog*` → `.journal-composer`)
- Modify: `tests/client/journal-compact.test.tsx`, `tests/client/journal.test.tsx` (modal-тесты: `:44-70`, `:112-136`, `:381-401`, `:410-420`)
- Modify: e2e, использующие `getByRole('dialog', { name: 'Новая запись журнала' })` (`tests/e2e/task-journal.spec.ts:250-280` и найденные grep)

**Interfaces:**
- Produces: `<section aria-label="Новая запись журнала" class="journal-composer">` (role `region`) между toolbar и лентой; `JournalTaskPicker` и `chooseTask(locator, path)` работают с любым `Locator`.

- [ ] **Step 1: Write failing tests**

Дописать в `tests/client/journal-compact.test.tsx`:

```tsx
it('U09 inline project composer requires a task and text, keeps its draft and returns focus', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const add = screen.getByRole('button', { name: 'Добавить запись' });
  await userEvent.click(add);
  expect(screen.queryByRole('dialog')).toBeNull();
  const composer = screen.getByRole('region', {
    name: 'Новая запись журнала',
  });
  expect(
    within(composer).getByRole('button', { name: 'Выбрать задачу' }),
  ).toHaveFocus();
  const body = within(composer).getByLabelText('Текст записи');
  expect(body).toHaveAttribute('placeholder', 'Что сделали или узнали?');
  expect(
    within(composer).queryByRole('button', { name: 'Сохранить запись' }),
  ).toBeNull();
  fireEvent.change(body, { target: { value: '   ' } });
  expect(
    within(composer).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeDisabled();
  fireEvent.change(body, { target: { value: 'Черновик проекта' } });
  expect(
    within(composer).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeDisabled();
  fireEvent.keyDown(body, { key: 'Escape' });
  await waitFor(() => expect(add).toHaveFocus());
  expect(
    screen.queryByRole('region', { name: 'Новая запись журнала' }),
  ).toBeNull();
  await userEvent.click(add);
  expect(screen.getByLabelText('Текст записи')).toHaveValue(
    'Черновик проекта',
  );
});

it('U09 composer keys do not reach window shortcuts: Escape keeps the task panel, Ctrl+Z does not undo', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Работа 1' })[0]!,
  );
  const panel = await screen.findByRole('complementary', { name: 'Задача' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  const composer = screen.getByRole('region', {
    name: 'Новая запись журнала',
  });
  const onWindow = vi.fn();
  window.addEventListener('keydown', onWindow);
  const picker = within(composer).getByRole('button', {
    name: 'Выбрать задачу',
  });
  fireEvent.keyDown(picker, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(picker, { key: 'Escape' });
  window.removeEventListener('keydown', onWindow);
  expect(onWindow).not.toHaveBeenCalled();
  expect(api.command).not.toHaveBeenCalled();
  expect(panel).toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Новая запись журнала' }),
  ).toBeNull();
});
```

Если «Добавить запись» при открытой панели задачи находится не только в ленте проекта, искать его внутри `[data-journal-feed="project"]`/`#project-view-journal`.

```tsx
it('U09 switching projects closes the inline composer; each project keeps its own draft', async () => {
  const server = mockJournalApp();
  const projectB = '44444444-4444-4444-8444-444444444444';
  server.projects.push({
    ...server.projects[0]!,
    id: projectB,
    title: 'Synthetic B',
  });
  // Project journal "Добавить запись" is disabled for a project without tasks.
  server.tree.tasks.push(task(3, { projectId: projectB }));
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Черновик проекта A' },
  });
  await userEvent.click(screen.getByRole('button', { name: /Synthetic B/ }));
  await screen.findByRole('heading', { name: 'Synthetic B' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  expect(
    screen.queryByRole('region', { name: 'Новая запись журнала' }),
  ).toBeNull();
  const add = screen.getByRole('button', { name: 'Добавить запись' });
  await waitFor(() => expect(add).toBeEnabled());
  await userEvent.click(add);
  expect(screen.getByLabelText('Текст записи')).toHaveValue('');
});
```

Импорт `task` из `./fixtures.js` уже добавлен в Task 2.

Переключение проекта — по образцу `tests/client/journal-navigation.test.tsx:680-706`. Смена проекта не спрашивает подтверждения для черновика журнала (`canNavigate`, `App.tsx:467-486`).

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/client/journal-compact.test.tsx -t U09`
Expected: FAIL: открывается `dialog`, region не найден.

- [ ] **Step 3: Replace dialog with inline composer**

В `src/client/ProjectJournal.tsx`:

1. `const dialog = useRef<HTMLDialogElement>(null)` → `const composer = useRef<HTMLElement>(null)`; в `closeAfterSave` заменить `dialog.current?.contains(active)` на `composer.current?.contains(active)`.
2. Удалить `useEffect` с `showModal`, `document.body.style.overflow` и `paddingRight` (строки ~85-104) и заменить его эффектом начального фокуса:

```tsx
  const [focusRequest, setFocusRequest] = useState(0);
  const ready = !!(key && draft && metadata);
  useEffect(() => {
    const node = composer.current;
    if (!ready || !node) return;
    (draft?.taskId
      ? node.querySelector<HTMLElement>('[data-journal-body]')
      : node.querySelector<HTMLElement>('button')
    )?.focus();
  }, [ready, focusRequest]);
```

Первая кнопка composer — триггер `JournalTaskPicker` («Выбрать задачу»): picker стоит первым в форме. `ready` включает `metadata`, поэтому фокус ставится и тогда, когда metadata пришла после клика.

3. Закрывать composer при смене проекта. Обычная загрузка проекта сбрасывает `tree` (`App.tsx:518`), и `ProjectJournal` перемонтируется. Но `key` хранится в его состоянии и не привязан к `projectId`, а загрузка с `preserveDraft` дерево не сбрасывает. Поэтому добавить явную страховку. Черновик остаётся в памяти под ключом своего проекта (D21):

```tsx
  const shownProject = useRef(projectId);
  useEffect(() => {
    if (shownProject.current === projectId) return;
    shownProject.current = projectId;
    setKey(null);
  }, [projectId]);
```

4. `onClick` кнопки «Добавить запись»:

```tsx
          onClick={() => {
            setKey(controller.openCreate(projectId, null, today));
            setFocusRequest((n) => n + 1);
          }}
```

5. Перенести блок composer сразу после `</form>` и сообщений об ошибке периода и пустом проекте — до `journal-hint` (если R3 ещё не применён) и до `journal-notice` — и заменить `<dialog …>…</dialog>` на:

```tsx
      {key && draft && metadata && (
        <section
          ref={composer}
          className="journal-composer"
          aria-label="Новая запись журнала"
          onKeyDown={(event) => {
            // Like the former <dialog>: composer keys never reach window
            // shortcuts (Escape closing the task panel, Ctrl/Cmd+Z undo).
            event.stopPropagation();
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            if (controller.writing || controller.pending) return;
            close();
          }}
        >
          <JournalEditor
            draft={draft}
            controller={controller}
            disabled={disabled || !coherent}
            placeholder="Что сделали или узнали?"
            compactIdle
            onSaved={closeAfterSave}
            onCancel={() => close()}
            taskPicker={
              <JournalTaskPicker
                metadata={metadata}
                value={draft.taskId}
                onChange={(taskId) =>
                  controller.changeDraft(draft.key, { taskId })
                }
                disabled={
                  disabled ||
                  !coherent ||
                  controller.writing ||
                  !!controller.pending
                }
              />
            }
          />
        </section>
      )}
```

Ловушка Tab и заголовок `<h2>Новая запись</h2>` удаляются вместе с `<dialog>`; имя региона даёт `aria-label`. Убедиться, что `close()` возвращает фокус на «Добавить запись» (сейчас это делает обработчик закрытия dialog, строки ~75-84); если возврат был привязан к событию `close` у `<dialog>`, перенести его в `close()`.

6. Escape во вложенных popover: `JournalTaskPicker` уже вызывает `stopPropagation()` и `preventDefault()` на Escape (`JournalTaskPicker.tsx:55-59`), поэтому до composer он не дойдёт. Проверить календарь `CalendarDateInput`: если он обрабатывает Escape и не вызывает `preventDefault()`, добавить его. Это единственное допустимое изменение этих файлов в задаче.

В `src/client/styles/journal.css` удалить `.journal-dialog` и `.journal-dialog::backdrop`, добавить:

```css
.journal-composer {
  max-width: 960px;
  max-height: 45vh;
  overflow: auto;
  margin: var(--leaf-space-2) 0;
  padding: var(--leaf-space-3) var(--leaf-space-4);
  border: 1px solid var(--leaf-border);
  border-radius: 10px;
  background: var(--leaf-surface-muted);
}
@media (max-width: 600px) {
  .journal-composer {
    padding: var(--leaf-space-2);
  }
}
```

- [ ] **Step 4: Migrate dialog-based tests**

Найти: `grep -rln "Новая запись журнала\|journal-dialog\|:modal\|getByRole('dialog')" tests`.

Правила замены:
- `getByRole('dialog', { name: 'Новая запись журнала' })` и `getByRole('dialog')` для project create → `getByRole('region', { name: 'Новая запись журнала' })`. Переменную `dialog` можно не переименовывать.
- `expect(await dialog.evaluate((n) => n.matches(':modal'))).toBe(true);` → удалить.
- Шаги Tab-trap удалить: в `tests/e2e/task-journal.spec.ts:256-261` (`last.focus(); Tab; dialog contains activeElement`) и в `tests/client/journal.test.tsx:381-401` (`first`/`last` и два `fireEvent.keyDown(…Tab…)`). В jsdom-тесте `:381-401` кнопку «Очистить черновик» искать **после** ввода текста (`within(dialog).getByRole('button', { name: 'Очистить черновик' })`), т. к. в пустом composer её нет; переименовать тест в `'project composer clear confirmation preserves draft on Cancel and requires no plan command'`.
- `tests/client/journal.test.tsx:112-136` и `:410-420`: тесты сами выставляют `document.body.style.overflow = 'auto'` и `paddingRight = '3px'`; проверки `toBe('auto')` / `toBe('3px')` **оставить** — они доказывают, что composer не трогает стили body. Переименовать «modal» в названиях тестов в «composer».
- `expect(await journalGeometry(page)).toEqual(before)` при **открытом** composer → точное сравнение только anchor и неподвижных элементов. `pick` объявить один раз сразу после `const before = await journalGeometry(page)`, до цикла `for (const close of …)`: он нужен и в проходе сохранения (Step 5):

```ts
  const pick = (g: Awaited<ReturnType<typeof journalGeometry>>) => ({
    id: g.id,
    offset: g.offset,
    controlsX: g.controlsX,
    controlsY: g.controlsY,
    controlsWidth: g.controlsWidth,
    headerY: g.headerY,
    headerHeight: g.headerHeight,
  });
  expect(pick(await journalGeometry(page))).toEqual(pick(before));
```

  (лента сдвигается вниз на высоту composer, но её scroll-контейнер не прокручивается, поэтому id и смещение anchor относительно контейнера, toolbar и шапка совпадают точно). После закрытия — полное `toEqual(before)` остаётся.
- `toBeHidden()` / `not.toBeInTheDocument()` для dialog после сохранения или Escape — то же для region.

- [ ] **Step 5: U09b — anchor stays fixed through open, Escape and save**

В тесте `tests/e2e/task-journal.spec.ts` с длинной прокрученной лентой проходы Escape/cancel (строки ~250-268) уже мигрированы в Step 4. Существующий проход с успешным сохранением (строки ~269-283: `chooseTask(dialog, 'Этап P')`, затем сравнение `after` с `before` с допуском offset < 0.1 CSS px) **не дублировать**: в нём сразу после `add.click()` и до выбора задачи добавить `expect(pick(await journalGeometry(page))).toEqual(pick(before));`. Существующие проверки после закрытия сохранить. Тест идёт в обоих проектах Playwright (1440×900 и 1280×800).

Дописать в `tests/e2e/action-menus.spec.ts` (U11 для composer):

```ts
test('U11 open inline composer has no horizontal scroll at 375px', async ({
  page,
  runtime,
}) => {
  await seedEntries(page, runtime);
  await page.setViewportSize({ width: 375, height: 812 });
  await openProjectJournal(page, runtime.origin);
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Новая запись журнала' }),
  ).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/client && npx playwright test tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/journal-navigation.spec.ts tests/e2e/action-menus.spec.ts`
Expected: PASS.

- [ ] **Step 7: Format, typecheck, lint, commit**

Run: `npx prettier --write <изменённые файлы> && npm run typecheck && npm run lint && npm run format:check`

```bash
git add src/client/ProjectJournal.tsx src/client/styles/journal.css tests/client/journal-compact.test.tsx tests/client/journal.test.tsx tests/e2e/task-journal.spec.ts tests/e2e/action-menus.spec.ts
git commit -m "feat: inline project journal composer instead of modal"
```

Добавить в `git add` явным списком остальные мигрированные тесты из Step 4 и `CalendarDateInput.tsx`, если он менялся. Не использовать `git add tests` целиком.

---

### Task 7: [R1] Remove duplicate `+ Подзадача`

**Gate:** R1 (C29) принято владельцем 2026-10-12.

**Files:**
- Modify: `src/client/TaskTree.tsx` (menu condition; button `.add-child` lines ~398-410)
- Modify: `src/client/strings.ts:120` (`addChildShort`)
- Modify: `src/client/styles/planning.css:628-639`, `src/client/styles/journal.css` (`.task-row-menu` margin)
- Modify: `tests/client/inline-add.test.tsx:46-49,259-262`, `tests/e2e/inline-add.spec.ts:101`, `tests/e2e/fs-dependencies.spec.ts:350-355,377-382`, `tests/e2e/task-journal.spec.ts:478-513`
- Modify: `tests/e2e/action-menus.spec.ts`

**Interfaces:**
- Consumes: меню строки Task 2 (пункт «Добавить подзадачу» вызывает `onAction('child', task)`).
- Produces: `ActionMenu` в каждой строке `TaskTree`, кроме draft-строки; пункт «Добавить запись» только при `onJournal`.

- [ ] **Step 1: Write failing test**

Дописать в `tests/e2e/action-menus.spec.ts`:

```ts
test('U10 rows have one action trigger and create children from the menu or Shift+Enter', async ({
  page,
  runtime,
}) => {
  const { tree } = await seedJournal(page, runtime);
  const id = tree.tasks.find((t) => t.title === 'Без дат')!.id;
  await page.goto(runtime.origin);
  await expect(page.locator('.add-child')).toHaveCount(0);
  const row = page.locator(`[role="treeitem"][data-task-id="${id}"]`);
  await row
    .getByRole('button', { name: 'Действия задачи: Без дат', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Добавить подзадачу' }).click();
  await expect(page.getByLabel('Новая задача', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await row.focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByLabel('Новая задача', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Гант', exact: true }).click();
  await expect(page.locator('.add-child')).toHaveCount(0);
  await row.click();
  await page.getByRole('tab', { name: 'Подзадачи', exact: true }).click();
  await expect(page.locator('.add-child')).toHaveCount(0);
});
```

Имена кнопки вида («Гант») и вкладки взять из `tests/e2e/fs-dependencies.spec.ts:345,371`, если они отличаются.

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/action-menus.spec.ts -g U10 --project=1440x900`
Expected: FAIL: `.add-child` count is not 0.

- [ ] **Step 3: Remove the button and render the menu in every row**

- `src/client/TaskTree.tsx`:
  - условие `{onJournal && task.id !== draftTaskId && (` → `{task.id !== draftTaskId && (`;
  - пункт `journal` включать только при `onJournal`: `...(onJournal ? [{ id: 'journal', label: 'Добавить запись', onSelect: (trigger: HTMLButtonElement) => onJournal(task, trigger) }] : [])` (возврат `boolean | void` из Task 2 сохраняется);
  - удалить весь `<button type="button" className="add-child" …>{strings.addChildShort}</button>`.
- `src/client/strings.ts`: удалить `addChildShort: '+ Подзадача',`.
- `src/client/styles/planning.css`: удалить правила `.add-child` и `.task-row:hover .add-child, .task-row:focus-within .add-child`.
- `src/client/styles/journal.css`: в `.task-row-menu` заменить `margin-inline-end: 96px;` на `margin-inline-end: var(--leaf-space-2);`.

Проверка: `grep -rn "add-child\|addChildShort" src` пуст.

- [ ] **Step 4: Migrate tests that used the row button**

Кнопка `Добавить подзадачу: <title>` заменяется меню строки:

- e2e клики (`inline-add.spec.ts:101` и любые найденные grep): вместо `page.getByRole('button', { name: 'Добавить подзадачу: X' }).click()`:

```ts
  await page
    .getByRole('button', { name: 'Действия задачи: X', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Добавить подзадачу' }).click();
```

- e2e проверки видимости при hover (`fs-dependencies.spec.ts:350-355` в цикле по «Список»/«Гант» и `:377-382` в дереве подзадач): заменить `getByRole('button', { name: 'Добавить подзадачу: B', exact: true })` на `getByRole('button', { name: 'Действия задачи: B', exact: true })`, ожидание `toHaveCSS('opacity', '1')` сохранить.
- jsdom (`inline-add.test.tsx:46-49` с `TaskTree` и `:259-262` с `TaskTimeline`; `onJournal` в них не передаётся — после Step 3 меню всё равно есть):

```tsx
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия задачи: Работа C' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Добавить подзадачу' }),
  );
```

  В `:259-262` использовать `within(row)` для триггера; следующая проверка `expect(onSelect).not.toHaveBeenCalled()` подтверждает, что клик по пункту не выбирает строку. Тест на строке 46 — синхронный; сделать его `async`.
- `tests/e2e/task-journal.spec.ts:478-513` («row journal menu has an independent pointer hit target beside quick child action»): удалить вычисление `b`/`overlap` по `.add-child`, оставить проверки `width`, `height`, `hitMenu`, заменить `row.getByRole('menu')` на `page.getByRole('menu')` (если не сделано в Task 2) и переименовать тест в `'row action trigger has its own pointer hit target'`.

Проверка: `grep -rnE "Добавить подзадачу: |add-child" tests` пуст. Точное имя `'Добавить подзадачу'` относится к пункту меню и кнопке панели и остаётся.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/client && npx playwright test tests/e2e/action-menus.spec.ts tests/e2e/inline-add.spec.ts tests/e2e/fs-dependencies.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/task-tree.spec.ts tests/e2e/subtasks.spec.ts`
Expected: PASS.

- [ ] **Step 6: Format, typecheck, lint, commit**

Run: `npx prettier --write <изменённые файлы> && npm run typecheck && npm run lint && npm run format:check`

```bash
git add src/client/TaskTree.tsx src/client/strings.ts src/client/styles/planning.css src/client/styles/journal.css tests/client/inline-add.test.tsx tests/e2e/inline-add.spec.ts tests/e2e/fs-dependencies.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/action-menus.spec.ts
git commit -m "feat: single action menu per task row without duplicate subtask button"
```

---

### Task 8: [R3] Remove persistent undo hint row

**Gate:** R3 принято владельцем 2026-10-12.

**Files:**
- Modify: `src/client/ProjectJournal.tsx`, `src/client/TaskJournal.tsx`, `src/client/JournalFeed.tsx` (`journalUndoCopy`)
- Modify: `tests/e2e/action-menus.spec.ts`

- [ ] **Step 1: Write failing test**

Дописать в тест `U07 feed dates align…` в `tests/e2e/action-menus.spec.ts` после проверки `align`:

```ts
  const gap = await projectFeed(page).evaluate((node) => {
    const controls = node
      .querySelector('.journal-controls')!
      .getBoundingClientRect();
    const date = node
      .querySelector('[data-journal-date]')!
      .getBoundingClientRect();
    return Math.round(date.top - controls.bottom);
  });
  expect(gap).toBeLessThanOrEqual(24);
  await expect(
    page.getByText('Записи редактируются и удаляются отдельно'),
  ).toHaveCount(0);
```

Проверка `toHaveCount(0)` покрывает оба журнала: панель задачи смонтирована только при выборе задачи, поэтому дополнительно открыть журнал любой задачи (клик по ссылке задачи в записи) и повторить `toHaveCount(0)`.

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/action-menus.spec.ts -g U07 --project=1440x900`
Expected: FAIL: подпись присутствует, `gap` больше 24.

- [ ] **Step 3: Remove the hint**

- `src/client/ProjectJournal.tsx`: удалить `<p className="journal-hint">{journalUndoCopy}</p>` и `journalUndoCopy` из импорта.
- `src/client/TaskJournal.tsx`: то же.
- `src/client/JournalFeed.tsx`: удалить `export const journalUndoCopy = …`.

Проверка: `grep -rn journalUndoCopy src tests` пуст; `grep -rn "Записи редактируются и удаляются отдельно" tests` — найденные утверждения о наличии подписи заменить на `toHaveCount(0)`. Доступное имя кнопки отмены «Отменить изменение плана» (`strings.undo`) не меняется.

- [ ] **Step 4: Run tests and commit**

Run: `npx playwright test tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts && npx vitest run tests/client`
Expected: PASS.

Run: `npx prettier --write <изменённые файлы> && npm run typecheck && npm run lint && npm run format:check`

```bash
git add src/client/ProjectJournal.tsx src/client/TaskJournal.tsx src/client/JournalFeed.tsx tests/e2e/action-menus.spec.ts
git commit -m "feat: drop persistent journal undo hint row"
```

Добавить явным списком тесты, изменённые в Step 3.

---

### Task 9: Documentation, status and full verification

**Files:**
- Modify: `docs/UI.md`, `docs/ACCEPTANCE.md`
- Modify: `docs/DECISIONS.md` (C29 при R1; уточнение D21 при R2/R3)
- Modify: `docs/superpowers/specs/2026-10-10-task-journal-design.md`
- Modify: `docs/superpowers/specs/2026-10-12-journal-menu-ux-design.md` (статус)
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Update decisions (only accepted ones)**

При R1 добавить строку после C28 в `docs/DECISIONS.md`:

```markdown
| C29 | 2026-10-12: в строках дерева задач, левой части Ганта и дерева подзадач в панели одна точка вторичных действий `⋯` («Открыть задачу», «Добавить запись», «Добавить подзадачу»); отдельная кнопка «+ Подзадача» удалена. Уточняет C21 и C24 только в части кнопки строки: Shift+Enter, Tab/Shift+Tab, Alt+D, сроки и preview C21 сохраняются, кнопка «Добавить подзадачу» в панели остаётся. Меню открывается поверх строк без изменения их геометрии. СПЕЦИФИКАЦИЯ. |
```

Дата `2026-10-12` — дата ответа владельца. Вместо `СПЕЦИФИКАЦИЯ` вставить markdown-ссылку с текстом «Спецификация» на `superpowers/specs/2026-10-12-journal-menu-ux-design.md` (путь относительно `docs/DECISIONS.md`).

При R2 и/или R3 дописать в конец строки D21 уточнение с явной пометкой «Подтверждено владельцем 2026-10-12:», чтобы подтверждённое решение не смешивалось с рабочими defaults D21:
- R2: «Composer проекта встроен под toolbar вместо native modal; лента сохраняет первый видимый anchor.»
- R3: «Постоянная подпись про Undo удалена в журнале проекта и задачи; разделение передаёт доступное имя кнопки „Отменить изменение плана“.»

Добавить ссылку на спецификацию 2026-10-12. Не принятые решения не записывать.

- [ ] **Step 2: Update UI.md, ACCEPTANCE.md and journal spec**

Места перечислены в §8 спецификации 2026-10-12:

- `docs/ACCEPTANCE.md`: уточнение 2026-10-09 («+ Подзадача» и Shift+Enter сохраняют создание) — заменить на меню строки и Shift+Enter со ссылкой на C29 (только при R1); строка J14 — «Native modal/focus trap» заменить на встроенный composer, геометрия при открытом composer — id/offset/toolbar/header exact (только при R2).
- `docs/UI.md`:
  - уточнение C21 (2026-10-08), уточнение владельца от 2026-10-09 и фраза «Меню строки имеет отдельную pointer-зону рядом с быстрым добавлением ребёнка»: упоминания «+ Подзадача» заменить ссылкой на C29 (только при R1);
  - раздел «Журнал проекта и задачи»: одно плавающее меню `⋯`, компактная лента без карточек, toolbar с условной «Сбросить», composer задачи без пустых действий;
  - при R2 — абзацы о native modal, drafts task/modal/edit и возврате фокуса из modal переписать на встроенный composer.
- `docs/superpowers/specs/2026-10-10-task-journal-design.md`: добавить строку «Уточнено дизайном 2026-10-12» в виде markdown-ссылки на `2026-10-12-journal-menu-ux-design.md` (тот же каталог):
  - §6, абзац «Журнальный CRUD не входит в кнопку Undo…» — только при R3;
  - §7, абзацы «Project create открывает диалог…», «Project/task entry delete…», «Journal create/edit drafts…» и строки J14/J15 — только при R2;
  - §7, абзац «TaskTree сейчас не имеет общего row menu…» — всегда (общее плавающее меню), с упоминанием C29 при R1;
  - §7, абзац о plain-text карточках записей — всегда (компактная лента).
- В новой спецификации заменить строку статуса на `Статус: реализовано; решения R1–R3: <принято/отклонено по каждому, с датой>. Результаты — в [STATUS](../../STATUS.md).`

- [ ] **Step 3: Update STATUS.md**

Добавить раздел по правилам AGENTS.md: факты, затронутые файлы, принятые/отклонённые R1–R3, выполненные проверки с результатом passed / failed / not run, ограничения (меню закрывается, когда триггер уходит из видимой области; Tab возвращает фокус на триггер; fallback фокуса после удаления последней записи в панели задачи не изменён), следующая задача. Без личных путей, имён аккаунтов и транскриптов.

- [ ] **Step 4: Full verification**

Run each and record the result:

```bash
npm run verify
npm run format:check
npm run test:e2e
npm run check:package
npm run check:kit
npm run security:workspace
```

`verify` уже включает typecheck, lint, все vitest-тесты (`npm test`) и build, поэтому `test:unit`/`test:integration` отдельно не запускаются. Expected: все проходят. Если браузерное окружение недоступно, `test:e2e` отмечается в STATUS как **not run** с причиной, а не как passed. Перед коммитом документации — `npm run security:staged` (или полный `npm run preflight`) после `git add`.

- [ ] **Step 5: Real-result screenshots (synthetic only)**

Скриншоты снимаются Playwright на синтетическом runtime e2e, без `npm run dev` и без реальных данных:

1. Создать временный файл `tests/e2e/zz-screens.tmp.spec.ts`, который использует `test`, `seedJournal`, `createJournalEntry`, `openProjectJournal` из `../helpers/journal-e2e.js` (как `action-menus.spec.ts`) и делает `page.screenshot({ path: \`${process.env.TMPDIR ?? '/tmp'}/leaf-screens/<имя>.png\` })` для: меню строки, меню записи, журнала проекта, журнала задачи и (при R2) открытого composer, в viewport 1440×900 и 375×812.
2. Run: `npx playwright test tests/e2e/zz-screens.tmp.spec.ts --project=1440x900`.
3. Удалить временный spec и убедиться, что `git status` его не показывает. Скриншоты остаются вне репозитория и **не** коммитятся.

- [ ] **Step 6: Commit docs**

```bash
git add docs/UI.md docs/ACCEPTANCE.md docs/DECISIONS.md docs/STATUS.md docs/superpowers/specs/2026-10-10-task-journal-design.md docs/superpowers/specs/2026-10-12-journal-menu-ux-design.md
npm run security:staged
git commit -m "docs: record compact journal menus and owner decisions"
```

---

## Self-review

- Spec coverage: §5.1 → Task 1; §5.2 → Tasks 2, 7; §5.3 и §5.4 → Task 3; §5.5 → Task 4; §5.6 → Task 5; §5.7 → Task 6; R3 → Task 8; §6 → Tasks 1–3, 6 (28 px, 375 px, 720×450); §8 → Task 9.
- Acceptance: U01 → Task 1; U02 → Task 1; U03/U04 → Tasks 2, 3; U05 → Tasks 2, 3 (jsdom; «Открыть задачу» — регрессия существующего поведения клика) и существующий e2e-сценарий «Добавить запись» из меню строки (`task-journal.spec.ts:300-340`, Task 2 Step 7); U06 → Task 4; U07 → Task 4 (+ Task 8 при R3); U08 → Task 5; U09/U09b → Task 6; U10 → Task 7; U11 → Tasks 2, 3, 6; U12 → Tasks 2, 3; U13 → Task 9.
- Типы и имена: `ActionMenuItem`, `ActionMenu` props, `placeMenu`, `MenuPlacement`, `periodLabel`, `placeholder`, `compactIdle` одинаковы во всех задачах.
- Порядок: Tasks 1–5 не зависят от решений владельца; 6–8 изолированы gate и могут выполняться в любом порядке после 5 (Task 6 использует `placeholder`/`compactIdle` из Task 5 и порядок toolbar из Task 4; Task 8 дописывает тест U07 из Task 4); Task 9 последний.
