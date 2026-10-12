# Journal Menu UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести меню `⋯` строк дерева и записей журнала на один плавающий доступный компонент, сделать ленты и composer журнала компактными, а после решений владельца R1–R3 убрать дублирующую `+ Подзадача`, modal-composer проекта и постоянную подпись про Undo.

**Architecture:** Чистая функция `placeMenu` считает позицию меню во viewport. `ActionMenu` оставляет триггер в строке, а меню рендерит через `createPortal` в `document.body` с `position: fixed`. `TaskTree` и `JournalFeed` хранят состояние open как сейчас и передают пункты. Остальное — изменения JSX и CSS существующих компонентов журнала. Journal API, journal-state, scheduler и схема БД не меняются.

**Tech Stack:** Existing TypeScript 6, React 19 (`react-dom` `createPortal`), Vite, Vitest + Testing Library (jsdom), Playwright. Node 24.21.0 по `.nvmrc`. Новых пакетов нет.

**Spec:** [Компактные меню действий и журналы — дизайн](../specs/2026-10-12-journal-menu-ux-design.md). Также прочитать: START_HERE.md, AGENTS.md, [спецификацию журнала](../specs/2026-10-10-task-journal-design.md), D21/C21/C24 в [DECISIONS](../../DECISIONS.md), раздел журнала в [UI.md](../../UI.md).

## Global Constraints

- Модель данных, journal API, миграции, `journal-state.ts`, `use-journal.ts`, scheduler, CPM, FS, Undo плана и Гант не меняются.
- Новые npm-зависимости, CDN, шрифты, state-библиотеки не добавляются.
- Высота строк дерева и Ганта не меняется (один синхронизированный flattened-tree).
- Drafts только в памяти; pinned baseline edit/delete, 409, uncertain retry, coherent revisions — без изменений (§5.8 спецификации).
- Тексты пунктов: «Открыть задачу», «Добавить запись», «Добавить подзадачу», «Редактировать запись», «Удалить запись». Имена триггеров: `Действия задачи: <title>`, `Действия записи <workDate>`.
- Задачи 6, 7, 8 выполняются **только** после явного решения владельца R2, R1, R3 соответственно. Без решения задача пропускается и отмечается в STATUS как not done.
- Только синтетические fixtures; никаких реальных данных, скриншотов владельца и PNG архива в репозитории.
- Каждая задача коммитится только после положительного review. Push, deploy и публикация не разрешены.
- Проверки после каждой задачи: `npm run typecheck`, `npm run lint`, `npm run format:check`, затронутые unit- и e2e-файлы. Полный набор — в Task 9.

## File Structure

| Файл | Ответственность | Задачи |
|---|---|---|
| `src/client/menu-position.ts` (new) | Чистый расчёт позиции меню | 1 |
| `src/client/ActionMenu.tsx` (new) | Триггер, portal, клавиатура, закрытие | 1 |
| `src/client/styles/menu.css` (new) | Стили `.action-menu` | 1 |
| `src/client/TaskTree.tsx` | Меню строки через `ActionMenu`; при R1 — удаление `.add-child` | 2, 7 |
| `src/client/JournalFeed.tsx` | Меню записи через `ActionMenu`; разметка записи | 3, 8 |
| `src/client/styles/journal.css` | Компактная лента, toolbar, composer | 2, 3, 4, 5, 6 |
| `src/client/styles/planning.css` | Удаление `.add-child` | 7 |
| `src/client/ProjectJournal.tsx` | Toolbar, встроенный composer | 4, 6, 8 |
| `src/client/JournalEditor.tsx` | Компактный composer | 5 |
| `src/client/TaskJournal.tsx` | Placeholder, подпись | 5, 8 |
| `src/client/strings.ts` | Удаление `addChildShort` | 7 |
| `tests/client/menu-position.test.ts` (new) | U01 | 1 |
| `tests/client/action-menu.test.tsx` (new) | U02 | 1 |
| `tests/client/journal-compact.test.tsx` (new) | U06, U08, U09 | 4, 5, 6 |
| `tests/e2e/action-menus.spec.ts` (new) | U03, U04, U07, U10, U11 | 2, 3, 7, 8 |
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
  - `interface ActionMenuItem { id: string; label: string; onSelect: (trigger: HTMLButtonElement) => void; disabled?: boolean; tone?: 'danger'; separatorBefore?: boolean }`
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
Expected: PASS, 5 tests.

- [ ] **Step 5: Write failing component tests**

`tests/client/action-menu.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ActionMenu,
  type ActionMenuItem,
} from '../../src/client/ActionMenu.js';

afterEach(cleanup);

function Harness({
  items,
  onRow,
}: {
  items: ActionMenuItem[];
  onRow?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="row" onKeyDown={onRow} onClick={onRow}>
      <ActionMenu
        className="test-menu"
        label="Действия: A"
        items={items}
        open={open}
        onOpenChange={setOpen}
        triggerData={{ 'data-test-trigger': 'a' }}
      />
      <button type="button">Снаружи</button>
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

it('opens a portaled menu, focuses the first item and skips disabled items', async () => {
  render(<Harness items={items()} />);
  expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  expect(trigger()).toHaveAttribute('data-test-trigger', 'a');
  await userEvent.click(trigger());
  const menu = screen.getByRole('menu', { name: 'Действия: A' });
  expect(trigger()).toHaveAttribute('aria-expanded', 'true');
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

it.each(['{Escape}', '{Tab}'])(
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

it('keeps menu key and click events away from row handlers and passes the trigger to onSelect', async () => {
  const onSelect = vi.fn();
  const onRow = vi.fn();
  render(<Harness items={items(onSelect)} onRow={onRow} />);
  await userEvent.click(trigger());
  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith(trigger());
  expect(onRow).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('closes on outside pointerdown, ancestor scroll and resize but not on its own pointerdown', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Открыть' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Снаружи' }));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await userEvent.click(trigger());
  fireEvent.scroll(screen.getByTestId('row'));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await userEvent.click(trigger());
  fireEvent(window, new Event('resize'));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('does not open while disabled', async () => {
  function Disabled() {
    const [open, setOpen] = useState(false);
    return (
      <ActionMenu
        className="test-menu"
        label="Действия: A"
        items={items()}
        open={open}
        onOpenChange={setOpen}
        disabled
      />
    );
  }
  render(<Disabled />);
  expect(trigger()).toBeDisabled();
  await userEvent.click(trigger());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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
  onSelect: (trigger: HTMLButtonElement) => void;
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
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  useEffect(() => {
    change.current = onOpenChange;
  });
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
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
  }, [open]);
  useLayoutEffect(() => {
    if (open && placement)
      menu.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus({ preventScroll: true });
  }, [open, placement]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menu.current?.contains(target) || trigger.current?.contains(target))
      )
        return;
      change.current(false);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      change.current(false);
      trigger.current?.focus();
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
    <div
      className={className}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => change.current(!open)}
        {...triggerData}
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={label}
            className="action-menu"
            data-side={placement?.side}
            style={
              placement
                ? { top: placement.top, left: placement.left }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
            onKeyDown={onMenuKeyDown}
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
                    if (button) item.onSelect(button);
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
  color: var(--leaf-text);
  font-size: 14px;
  text-align: start;
  white-space: nowrap;
}
.action-menu [role='menuitem']:hover:not(:disabled),
.action-menu [role='menuitem']:focus-visible {
  background: var(--leaf-accent-soft);
}
.action-menu [role='menuitem'].danger {
  color: var(--leaf-critical);
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

- [ ] **Step 8: Run component tests**

Run: `npx vitest run tests/client/action-menu.test.tsx tests/client/menu-position.test.ts`
Expected: PASS, 10 tests (5 + 5, считая два случая `it.each`). Если jsdom не поддерживает `fireEvent.pointerDown` для PointerEvent, тест всё равно проходит: `fireEvent` создаёт базовый `Event` с тем же типом.

- [ ] **Step 9: Typecheck, lint, format, commit**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: все три без ошибок.

```bash
git add src/client/menu-position.ts src/client/ActionMenu.tsx src/client/styles/menu.css tests/client/menu-position.test.ts tests/client/action-menu.test.tsx
git commit -m "feat: add floating accessible action menu primitive"
```

---

### Task 2: Tree row menu on ActionMenu

**Files:**
- Modify: `src/client/TaskTree.tsx` (state `menuTask` effect lines ~49-61; menu JSX lines ~306-397)
- Modify: `src/client/styles/journal.css` (`.task-row-menu` rules)
- Modify: `tests/e2e/task-journal.spec.ts:510`, `tests/e2e/journal-drafts.spec.ts:575`
- Create: `tests/e2e/action-menus.spec.ts`

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
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
    }),
  );
}
async function menuInViewport(page: Page, name: RegExp) {
  return page.getByRole('menu', { name }).evaluate((node) => {
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
    };
  });
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
  const before = await rects(rows);
  const trigger = last.getByRole('button', { name: /^Действия задачи: / });
  await trigger.click();
  await expect(
    page.getByRole('menu', { name: /^Действия задачи: / }),
  ).toBeVisible();
  expect(await rects(rows)).toEqual(before);
  expect(await menuInViewport(page, /^Действия задачи: /)).toEqual({
    inside: true,
    onTop: true,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await rects(rows)).toEqual(before);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/action-menus.spec.ts --project=1440x900`
Expected: FAIL. Текущее меню `absolute` внутри строки последней строки выходит за нижнюю границу viewport или перекрыто, поэтому `inside` или `onTop` равны `false`.

- [ ] **Step 3: Replace the row menu**

В `src/client/TaskTree.tsx` удалить `useEffect` закрытия по `pointerdown` (строки ~50-61; `useEffect` остаётся импортированным, он используется ниже), добавить `import { ActionMenu } from './ActionMenu.js';` и заменить весь блок `{onJournal && task.id !== draftTaskId && (<div className="task-row-menu" …>…</div>)}` на:

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

- [ ] **Step 4: Replace row menu CSS**

В `src/client/styles/journal.css` удалить правила `.task-row-menu [role='menu']` и `.task-row-menu [role='menuitem']`, а правило видимости заменить на:

```css
.task-row:hover .task-row-menu > button,
.task-row:focus-within .task-row-menu > button,
.task-row-menu > button[aria-expanded='true'] {
  opacity: 1;
}
```

`.task-row-menu { margin-inline-end: 96px; … }` пока остаётся: `.add-child` удаляется только в Task 7.

- [ ] **Step 5: Adapt row-scoped menu queries**

Меню больше не потомок строки:

- `tests/e2e/task-journal.spec.ts:510`: `await expect(row.getByRole('menu')).toBeVisible();` → `await expect(page.getByRole('menu')).toBeVisible();`
- `tests/e2e/journal-drafts.spec.ts:575`: `await row.getByRole('menuitem', { name: 'Добавить запись' }).click();` → `await page.getByRole('menuitem', { name: 'Добавить запись' }).click();`

Найти оставшиеся случаи: `grep -nE "(row|card)\.getByRole\('menu(item)?'" tests -r`. Для строк дерева заменить `row.` на `page.`. Карточки записей — в Task 3.

- [ ] **Step 6: Run affected tests**

Run: `npx playwright test tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts && npx vitest run tests/client/journal-navigation.test.tsx tests/client/journal.test.tsx tests/client/action-menu.test.tsx`
Expected: PASS. Если jsdom-тест `row menu journal focus waits for mounted editor…` (`journal-navigation.test.tsx:752`) падает из-за фокуса, проверить, что `onJournal` получает `trigger` из `onSelect`, а не из `closest('.task-row-menu')`.

- [ ] **Step 7: Typecheck, lint, format, commit**

Run: `npm run typecheck && npm run lint && npm run format:check`

```bash
git add src/client/TaskTree.tsx src/client/styles/journal.css tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts
git commit -m "refactor: render task row actions in floating menu"
```

---

### Task 3: Journal entry menu and compact feed

**Files:**
- Modify: `src/client/JournalFeed.tsx` (outside-close effect lines ~41-52; header/menu JSX lines ~296-381)
- Modify: `src/client/styles/journal.css` (`.journal-feed`, `.journal-entry*`, `.journal-task-link`, `.journal-body`)
- Modify: `tests/helpers/journal-e2e.ts` (`editEntry`)
- Modify: `tests/e2e/task-journal.spec.ts:89,101`, `tests/e2e/journal-drafts.spec.ts:146,184,262`
- Modify: `tests/e2e/action-menus.spec.ts`

**Interfaces:**
- Consumes: `ActionMenu` (Task 1); existing `controller.openEdit`, `controller.askDelete`.
- Produces: `.journal-entry-menu` wrapper; trigger keeps `data-journal-menu={entry.id}` and name `Действия записи <workDate>`; DOM `section[data-journal-entry] > h3? + article > header` сохраняется (на неё опирается `journalGeometry`).

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

test('U03/U04/U07 entry menu floats without resizing entries and the feed aligns with the toolbar', async ({
  page,
  runtime,
}) => {
  const { ids } = await seedEntries(page, runtime);
  await openProjectJournal(page, runtime.origin);
  const entries = projectFeed(page).locator('[data-journal-entry-id]');
  await expect(entries).toHaveCount(4);
  const align = await projectFeed(page).evaluate((node) => {
    const add = [...node.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Добавить запись'))!
      .getBoundingClientRect();
    const date = node.querySelector('[data-journal-date]')!.getBoundingClientRect();
    return { add: Math.round(add.x), date: Math.round(date.x) };
  });
  expect(Math.abs(align.add - align.date)).toBeLessThanOrEqual(1);
  const before = await rects(entries);
  const last = entryCard(page, ids[0]!);
  const trigger = last.getByRole('button', { name: /^Действия записи / });
  await trigger.click();
  await expect(
    page.getByRole('menuitem', { name: 'Удалить запись' }),
  ).toBeVisible();
  expect(await rects(entries)).toEqual(before);
  expect(await menuInViewport(page, /^Действия записи /)).toEqual({
    inside: true,
    onTop: true,
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await rects(entries)).toEqual(before);
});

test('U11 narrow 375px journal and open entry menu have no horizontal scroll', async ({
  page,
  runtime,
}) => {
  const { ids } = await seedEntries(page, runtime);
  await page.setViewportSize({ width: 375, height: 812 });
  await openProjectJournal(page, runtime.origin);
  await entryCard(page, ids[3]!)
    .getByRole('button', { name: /^Действия записи / })
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/action-menus.spec.ts --project=1440x900 -g "U03/U04/U07"`
Expected: FAIL: `align` отличается на ширину центрирования и padding, а `rects(entries)` меняется после открытия меню (меню в потоке карточки).

- [ ] **Step 3: Replace the entry menu**

В `src/client/JournalFeed.tsx`:

1. Удалить `useEffect` закрытия меню по `pointerdown` (строки ~41-52).
2. Добавить `import { ActionMenu } from './ActionMenu.js';`.
3. Заменить кнопку `data-journal-menu` внутри `<header>` и весь следующий за `</header>` блок `{menu === entry.id && (<div role="menu" …>…</div>)}` на один элемент внутри `<header>` после ссылки на задачу:

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
                      onSelect: () =>
                        setEditing(
                          controller.openEdit(
                            entry,
                            state.page!.journalRevision,
                          ),
                        ),
                    },
                    {
                      id: 'delete',
                      label: 'Удалить запись',
                      tone: 'danger',
                      separatorBefore: true,
                      onSelect: () =>
                        controller.askDelete(
                          entry,
                          state.page!.journalRevision,
                        ),
                    },
                  ]}
                />
```

`restoreMenu`, `finishDelete`, подтверждение удаления и inline-редактор не меняются: они находят триггер по `[data-journal-menu="id"]`, а триггер остаётся в карточке.

- [ ] **Step 4: Compact feed CSS**

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

Повторное объявление `.journal-feed { position: relative; }` ниже в файле сохранить. `.task-journal .journal-feed { padding: 0.5rem 0; }` сохранить.

- [ ] **Step 5: Adapt card-scoped menu queries**

- `tests/helpers/journal-e2e.ts` `editEntry`: `await card.getByRole('menuitem', { name: 'Редактировать запись' }).click();` → `await card.page().getByRole('menuitem', { name: 'Редактировать запись' }).click();`
- `tests/e2e/task-journal.spec.ts:89,101`, `tests/e2e/journal-drafts.spec.ts:146,184,262`: `card.getByRole('menuitem', …)` (или цепочка `entryCard(...)…getByRole('menuitem', …)`) → `page.getByRole('menuitem', …)`.

Проверка: `grep -nE "card\)?\.getByRole\('menuitem'" -r tests` не находит совпадений, кроме вызовов через `page`.

- [ ] **Step 6: Run affected tests**

Run: `npx playwright test tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/journal-navigation.spec.ts && npx vitest run tests/client/journal.test.tsx tests/client/journal-navigation.test.tsx tests/client/journal-drafts.test.tsx tests/client/journal-coherence.test.tsx tests/client/journal-context.test.tsx`
Expected: PASS. `journalGeometry` продолжает находить `article` и `.journal-controls`.

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
git add src/client/JournalFeed.tsx src/client/styles/journal.css tests/helpers/journal-e2e.ts tests/e2e/action-menus.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts
git commit -m "feat: compact journal feed with floating entry menu"
```

---

### Task 4: Project journal toolbar

**Files:**
- Modify: `src/client/ProjectJournal.tsx` (toolbar JSX lines ~133-210)
- Modify: `src/client/styles/journal.css` (`.journal-notice`)
- Modify: `tests/client/journal.test.tsx:137`, `tests/e2e/task-journal.spec.ts:175`
- Create: `tests/client/journal-compact.test.tsx`

**Interfaces:**
- Produces: `export function periodLabel(query: JournalProjectQuery): string` в `ProjectJournal.tsx`; кнопка периода с доступным именем `Период: <periodLabel>`.

- [ ] **Step 1: Write failing tests**

`tests/client/journal-compact.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App.js';
import { periodLabel } from '../../src/client/ProjectJournal.js';
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
async function openProjectJournal() {
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  await screen.findByText('Original synthetic text');
}

it('formats the applied period', () => {
  expect(periodLabel({})).toBe('Все даты');
  expect(periodLabel({ from: '2026-10-01' })).toBe('с 01.10.2026');
  expect(periodLabel({ to: '2026-10-10' })).toBe('по 10.10.2026');
  expect(periodLabel({ from: '2026-10-01', to: '2026-10-10' })).toBe(
    '01.10.2026 – 10.10.2026',
  );
});

it('U06 shows reset only for an applied filter and reset clears it', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();
  await userEvent.click(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  );
  fireEvent.change(screen.getByLabelText('С даты'), {
    target: { value: '2026-10-01' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Применить' }));
  const period = await screen.findByRole('button', {
    name: 'Период: с 01.10.2026',
  });
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
  expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  ).toHaveFocus();
  expect(period).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/client/journal-compact.test.tsx`
Expected: FAIL: `periodLabel` не экспортирован, кнопки `Период: Все даты` нет.

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

1. Перенести кнопку `data-journal-add` («Добавить запись», `className="primary"`) первой в форме, без изменения её props.
2. Кнопку периода: текст `{periodLabel(query)}`, добавить `aria-label={`Период: ${periodLabel(query)}`}`, удалить суффикс `' •'`.
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

В `src/client/styles/journal.css` заменить `.journal-notice { min-height: 21px; margin: 0 0 4px; }` на:

```css
.journal-notice {
  margin: 0;
  font-size: 12px;
}
```

- [ ] **Step 4: Update existing period queries**

- `tests/client/journal.test.tsx:137`: `{ name: 'Период' }` → `{ name: 'Период: Все даты' }`.
- `tests/e2e/task-journal.spec.ts:175`: `{ name: 'Период', exact: true }` → `{ name: /^Период: / }`.

Проверка: `grep -rn "name: 'Период'" tests` пуст.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/client/journal-compact.test.tsx tests/client/journal.test.tsx && npx playwright test tests/e2e/task-journal.spec.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
git add src/client/ProjectJournal.tsx src/client/styles/journal.css tests/client/journal-compact.test.tsx tests/client/journal.test.tsx tests/e2e/task-journal.spec.ts
git commit -m "feat: single-row project journal toolbar with conditional reset"
```

---

### Task 5: Compact task composer

**Files:**
- Modify: `src/client/JournalEditor.tsx` (props, form layout lines ~34-140)
- Modify: `src/client/TaskJournal.tsx` (pass `placeholder`)
- Modify: `src/client/styles/journal.css` (`.journal-editor*`)
- Modify: `tests/client/journal-compact.test.tsx`
- Modify: `tests/e2e/task-journal.spec.ts:256` (dialog Tab-trap step)

**Interfaces:**
- Produces: `JournalEditor` prop `placeholder?: string`. Composer idle state: `!draft.entryId && !draft.body && !draft.dirty && !controller.mutationError && !conflict && !controller.uncertain && controller.pending?.key !== draft.key`.

- [ ] **Step 1: Write failing test**

Дописать в `tests/client/journal-compact.test.tsx` (добавить `waitFor`, `within` в импорт Testing Library и `import { api } from '../../src/client/api.js';`):

```tsx
it('U08 task composer hides save/clear while empty and saves with Ctrl+Enter', async () => {
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
  const panel = screen.getByRole('complementary', { name: 'Задача' });
  const body = within(panel).getByLabelText('Текст записи');
  expect(body).toHaveAttribute(
    'placeholder',
    'Что сделали или узнали по задаче?',
  );
  expect(
    within(panel).queryByRole('button', { name: 'Сохранить запись' }),
  ).toBeNull();
  expect(
    within(panel).queryByRole('button', { name: 'Очистить черновик' }),
  ).toBeNull();
  fireEvent.change(body, { target: { value: 'Проверил сборку' } });
  expect(
    within(panel).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeEnabled();
  expect(
    within(panel).getByRole('button', { name: 'Очистить черновик' }),
  ).toBeInTheDocument();
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledOnce());
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/client/journal-compact.test.tsx -t U08`
Expected: FAIL: нет placeholder, «Сохранить запись» присутствует при пустом тексте.

- [ ] **Step 3: Implement composer layout**

В `src/client/JournalEditor.tsx`:

1. Добавить prop `placeholder?: string` в деструктуризацию и тип.
2. После `const conflict = …` добавить:

```tsx
  const idle =
    !draft.entryId &&
    !draft.body &&
    !draft.dirty &&
    !controller.mutationError &&
    !conflict &&
    !controller.uncertain &&
    controller.pending?.key !== draft.key;
```

3. Порядок внутри `<form>`: `{taskPicker}`, затем метка текста, затем подвал. Заменить блоки `CalendarDateInput`, `<label>…textarea…</label>`, `<p id={id}…>` на:

```tsx
      {taskPicker}
      <label>
        <span className="sr-only">Текст записи</span>
        <textarea
          data-journal-body
          value={draft.body}
          rows={3}
          placeholder={placeholder}
          disabled={locked}
          aria-describedby={id}
          onChange={(event) =>
            controller.changeDraft(draft.key, { body: event.target.value })
          }
        />
      </label>
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
        <p id={id} className={draft.body ? 'journal-hint' : 'journal-hint sr-only'}>
          {draft.body.length}/10000 · Нужны дата и непустой текст.
          Ctrl/Cmd+Enter — сохранить.
        </p>
      </div>
```

4. В `<div className="journal-editor-actions">` обернуть кнопку `type="submit"` («Сохранить запись») и кнопку «Очистить черновик» условием `{!idle && (…)}`. Кнопки «Повторить сохранение» и «Закрыть редактор» не меняются.

5. Блоки ошибок, `unavailableTaskIds`, `JournalConflict` и обработчик Ctrl/Cmd+Enter остаются без изменений.

В `src/client/TaskJournal.tsx` передать `placeholder="Что сделали или узнали по задаче?"` в `JournalEditor`.

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
}
.journal-editor-footer .journal-hint {
  margin: 0;
  padding: 0;
}
```

- [ ] **Step 4: Update tests depending on idle buttons**

- `tests/e2e/task-journal.spec.ts:256`: в modal-цикле шаг `const last = dialog.getByRole('button', { name: 'Очистить черновик' });` → `const last = dialog.getByRole('button', { name: 'Закрыть редактор' });`. При пустом черновике «Очистить черновик» не рендерится, последней кнопкой становится «Закрыть редактор».
- Найти утверждения о disabled-кнопке пустого composer: `grep -rnE "Сохранить запись.*\n?.*toBeDisabled|Очистить черновик" tests`. Если утверждение относится к пустому черновику создания, заменить `toBeDisabled()` на `expect(queryByRole(...)).toBeNull()`. Если черновик непустой, оставить как есть.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/client && npx playwright test tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/journal-navigation.spec.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
git add src/client/JournalEditor.tsx src/client/TaskJournal.tsx src/client/styles/journal.css tests/client/journal-compact.test.tsx tests/e2e/task-journal.spec.ts
git commit -m "feat: compact journal composer actions until text is entered"
```

---

### Task 6: [R2] Inline project composer

**Gate:** выполнять только если владелец принял R2. Иначе пропустить и отметить в STATUS.

**Files:**
- Modify: `src/client/ProjectJournal.tsx` (dialog effect lines ~85-100; dialog JSX lines ~232-298)
- Modify: `src/client/styles/journal.css` (`.journal-dialog*` → `.journal-composer`)
- Modify: `tests/client/journal-compact.test.tsx`, `tests/client/journal.test.tsx:44-70,120-136`
- Modify: e2e, использующие `getByRole('dialog', { name: 'Новая запись журнала' })`

**Interfaces:**
- Produces: `<section aria-label="Новая запись журнала" class="journal-composer">` (role `region`) между toolbar и лентой; `JournalTaskPicker` и `chooseTask(locator, path)` работают с любым `Locator`.

- [ ] **Step 1: Write failing test**

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
  const body = within(composer).getByLabelText('Текст записи');
  expect(body).toHaveAttribute('placeholder', 'Что сделали или узнали?');
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
  expect(screen.queryByRole('region', { name: 'Новая запись журнала' })).toBeNull();
  expect(document.body.style.overflow).toBe('');
  await userEvent.click(add);
  expect(screen.getByLabelText('Текст записи')).toHaveValue('Черновик проекта');
});
```

Второе `toBeDisabled` проверяет, что без выбранной задачи сохранить нельзя: черновик проектного ключа создаётся с `taskId: null`.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/client/journal-compact.test.tsx -t U09`
Expected: FAIL: открывается `dialog`, region не найден.

- [ ] **Step 3: Replace dialog with inline composer**

В `src/client/ProjectJournal.tsx`:

1. `const dialog = useRef<HTMLDialogElement>(null)` → `const composer = useRef<HTMLElement>(null)`; в `closeAfterSave` заменить `dialog.current?.contains(active)` на `composer.current?.contains(active)`.
2. Удалить `useEffect` с `showModal`, `document.body.style.overflow` и `paddingRight` (строки ~85-100) и заменить его эффектом фокуса:

```tsx
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (!key || !composer.current) return;
    const node = composer.current;
    (draft?.taskId
      ? node.querySelector<HTMLElement>('[data-journal-body]')
      : node.querySelector<HTMLElement>('button, [data-journal-body]')
    )?.focus();
  }, [key, focusRequest]);
```

3. `onClick` кнопки «Добавить запись»:

```tsx
          onClick={() => {
            setKey(controller.openCreate(projectId, null, today));
            setFocusRequest((n) => n + 1);
          }}
```

4. Перенести блок composer сразу после `</form>` и сообщений об ошибке периода и пустом проекте (до `journal-notice`) и заменить `<dialog …>…</dialog>` на:

```tsx
      {key && draft && metadata && (
        <section
          ref={composer}
          className="journal-composer"
          aria-label="Новая запись журнала"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <JournalEditor
            draft={draft}
            controller={controller}
            disabled={disabled || !coherent}
            placeholder="Что сделали или узнали?"
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

Ловушка Tab удаляется вместе с `<dialog>`.

5. Проверить Escape во вложенных popover: открыть picker («Выбрать задачу») и календарь даты, нажать Escape. Должен закрыться только popover. Если `JournalTaskPicker` или `CalendarDateInput` не вызывают `preventDefault()` на Escape, добавить `event.preventDefault()` в их обработчик Escape. Это единственное допустимое изменение этих файлов в задаче.

В `src/client/styles/journal.css` удалить `.journal-dialog` и `.journal-dialog::backdrop`, добавить:

```css
.journal-composer {
  max-width: 960px;
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

Найти: `grep -rln "Новая запись журнала\|journal-dialog\|:modal\|style.overflow\|paddingRight" tests`.

Правила замены:
- `getByRole('dialog', { name: 'Новая запись журнала' })` → `getByRole('region', { name: 'Новая запись журнала' })`. Переменную `dialog` можно не переименовывать.
- `expect(await dialog.evaluate((n) => n.matches(':modal'))).toBe(true);` → удалить.
- Шаг Tab-trap в `tests/e2e/task-journal.spec.ts` (`last.focus(); Tab; dialog contains activeElement`) → удалить: ловушки больше нет.
- `expect(journalGeometry(page)).toEqual(before)` при **открытом** composer → `const open = await journalGeometry(page); expect({ id: open.id, offset: open.offset, controlsY: open.controlsY, headerY: open.headerY }).toEqual({ id: before.id, offset: before.offset, controlsY: before.controlsY, headerY: before.headerY });` (лента сдвигается вниз на высоту composer, но первый видимый anchor, его смещение и toolbar неподвижны). После закрытия — полное `toEqual(before)` остаётся.
- `tests/client/journal.test.tsx:120-136`: утверждения `document.body.style.overflow` / `paddingRight` → `expect(document.body.style.overflow).toBe('')`.
- `toBeHidden()` / `not.toBeInTheDocument()` для dialog после сохранения или Escape — то же для region.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/client && npx playwright test tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/journal-navigation.spec.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
git add src/client/ProjectJournal.tsx src/client/styles/journal.css tests
git commit -m "feat: inline project journal composer instead of modal"
```

Если в Step 3.5 менялись `JournalTaskPicker.tsx` или `CalendarDateInput.tsx`, добавить их в `git add`.

---

### Task 7: [R1] Remove duplicate `+ Подзадача`

**Gate:** выполнять только если владелец принял R1 (C29). Иначе пропустить и отметить в STATUS.

**Files:**
- Modify: `src/client/TaskTree.tsx` (button `.add-child` lines ~398-410)
- Modify: `src/client/strings.ts:120` (`addChildShort`)
- Modify: `src/client/styles/planning.css:628-639`, `src/client/styles/journal.css` (`.task-row-menu` margin)
- Modify: `tests/client/inline-add.test.tsx:46,260`, `tests/e2e/inline-add.spec.ts:101`, `tests/e2e/fs-dependencies.spec.ts:352,379`, `tests/e2e/task-journal.spec.ts:478-513`
- Modify: `tests/e2e/action-menus.spec.ts`

**Interfaces:**
- Consumes: меню строки Task 2 (пункт «Добавить подзадачу» вызывает `onAction('child', task)`).

- [ ] **Step 1: Write failing test**

Дописать в `tests/e2e/action-menus.spec.ts`:

```ts
test('U10 rows have one action trigger and create children from the menu or Shift+Enter', async ({
  page,
  runtime,
}) => {
  await seedJournal(page, runtime);
  await page.goto(runtime.origin);
  await expect(page.locator('.add-child')).toHaveCount(0);
  const row = page.locator('[role="treeitem"]', { hasText: 'Без дат' });
  await row
    .getByRole('button', { name: 'Действия задачи: Без дат', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Добавить подзадачу' }).click();
  await expect(page.getByLabel('Новая задача', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await row.focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByLabel('Новая задача', { exact: true })).toBeFocused();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/action-menus.spec.ts -g U10 --project=1440x900`
Expected: FAIL: `.add-child` count is not 0.

- [ ] **Step 3: Remove the button**

- `src/client/TaskTree.tsx`: удалить весь `<button type="button" className="add-child" …>{strings.addChildShort}</button>`.
- `src/client/strings.ts`: удалить `addChildShort: '+ Подзадача',`.
- `src/client/styles/planning.css`: удалить правила `.add-child` и `.task-row:hover .add-child, .task-row:focus-within .add-child`.
- `src/client/styles/journal.css`: в `.task-row-menu` заменить `margin-inline-end: 96px;` на `margin-inline-end: var(--leaf-space-2);`.

Проверка: `grep -rn "add-child\|addChildShort" src` пуст.

- [ ] **Step 4: Migrate tests that used the row button**

Кнопка `Добавить подзадачу: <title>` заменяется открытием меню:

- e2e (`inline-add.spec.ts:101`, `fs-dependencies.spec.ts:352,379`): вместо `page.getByRole('button', { name: 'Добавить подзадачу: X' }).click()` использовать:

```ts
  await page
    .getByRole('button', { name: 'Действия задачи: X', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Добавить подзадачу' }).click();
```

Если тест проверял hover-видимость кнопки, проверять тот же сценарий через меню.
- jsdom (`inline-add.test.tsx:46,260`): заменить на

```tsx
  await userEvent.click(
    within(row).getByRole('button', { name: 'Действия задачи: Работа C' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Добавить подзадачу' }),
  );
```

(в строке 46, где нет `row`, использовать `screen` вместо `within(row)`).
- `tests/e2e/task-journal.spec.ts:478-513` («row journal menu has an independent pointer hit target beside quick child action»): удалить вычисление `b`/`overlap` по `.add-child`, оставить проверки `width`, `height`, `hitMenu` и переименовать тест в `'row action trigger has its own pointer hit target'`.

Проверка: `grep -rnE "Добавить подзадачу: |add-child" tests` пуст. Точное имя `'Добавить подзадачу'` относится к кнопке панели и остаётся.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/client && npx playwright test tests/e2e/action-menus.spec.ts tests/e2e/inline-add.spec.ts tests/e2e/fs-dependencies.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/task-tree.spec.ts tests/e2e/subtasks.spec.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
git add src/client/TaskTree.tsx src/client/strings.ts src/client/styles/planning.css src/client/styles/journal.css tests
git commit -m "feat: single action menu per task row without duplicate subtask button"
```

---

### Task 8: [R3] Remove persistent undo hint row

**Gate:** выполнять только если владелец принял R3. Иначе пропустить и отметить в STATUS.

**Files:**
- Modify: `src/client/ProjectJournal.tsx`, `src/client/TaskJournal.tsx`, `src/client/JournalFeed.tsx` (`journalUndoCopy`)
- Modify: `tests/e2e/action-menus.spec.ts`

- [ ] **Step 1: Write failing test**

Дописать в тест `U03/U04/U07…` в `tests/e2e/action-menus.spec.ts` перед `const before = await rects(entries);`:

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

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/action-menus.spec.ts -g U07 --project=1440x900`
Expected: FAIL: подпись присутствует, `gap` больше 24.

- [ ] **Step 3: Remove the hint**

- `src/client/ProjectJournal.tsx`: удалить `<p className="journal-hint">{journalUndoCopy}</p>` и `journalUndoCopy` из импорта.
- `src/client/TaskJournal.tsx`: то же.
- `src/client/JournalFeed.tsx`: удалить `export const journalUndoCopy = …`.

Проверка: `grep -rn journalUndoCopy src tests` пуст. Доступное имя кнопки отмены «Отменить изменение плана» (`strings.undo`) не меняется.

- [ ] **Step 4: Run tests and commit**

Run: `npx playwright test tests/e2e/action-menus.spec.ts && npx vitest run tests/client`
Expected: PASS.

```bash
git add src/client/ProjectJournal.tsx src/client/TaskJournal.tsx src/client/JournalFeed.tsx tests/e2e/action-menus.spec.ts
git commit -m "feat: drop persistent journal undo hint row"
```

---

### Task 9: Documentation, status and full verification

**Files:**
- Modify: `docs/UI.md` (строки про `+ Подзадача` в уточнении C21 и §41; раздел «Журнал проекта и задачи — D21»)
- Modify: `docs/DECISIONS.md` (C29 при R1; уточнение D21 при R2/R3)
- Modify: `docs/superpowers/specs/2026-10-10-task-journal-design.md` (§98, §106, §108: одна строка-ссылка на новую спецификацию)
- Modify: `docs/superpowers/specs/2026-10-12-journal-menu-ux-design.md` (статус)
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Update decisions (only accepted ones)**

При R1 добавить строку после C28 в `docs/DECISIONS.md`:

```markdown
| C29 | 2026-10-12: в строке дерева и левой части Ганта одна точка вторичных действий `⋯` («Открыть задачу», «Добавить запись», «Добавить подзадачу»); отдельная кнопка «+ Подзадача» удалена. Уточняет C21 и C24 только в части кнопки строки: Shift+Enter, Tab/Shift+Tab, Alt+D, сроки и preview C21 сохраняются, кнопка «Добавить подзадачу» в панели остаётся. Меню открывается поверх строк без изменения их геометрии. СПЕЦИФИКАЦИЯ. |
```

Вместо `СПЕЦИФИКАЦИЯ` вставить markdown-ссылку с текстом «Спецификация» на `superpowers/specs/2026-10-12-journal-menu-ux-design.md` (путь относительно `docs/DECISIONS.md`).

При R2 и/или R3 дописать в конец строки D21 (дата `2026-10-12`) уточнение:
- R2: «Composer проекта встроен под toolbar вместо native modal; лента сохраняет первый видимый anchor.»
- R3: «Постоянная подпись про Undo удалена; разделение передаёт доступное имя кнопки „Отменить изменение плана“.»

Добавить ссылку на спецификацию 2026-10-12. Не принятые решения не записывать.

- [ ] **Step 2: Update UI.md and journal spec**

- `docs/UI.md`: в уточнении C21 и абзаце от 2026-10-09 заменить упоминания «+ Подзадача» ссылкой на C29 (только при R1). В разделе журнала описать: одно плавающее меню `⋯`, компактная лента без карточек, toolbar с условной «Сбросить», composer задачи без пустых действий; при R2 — встроенный composer вместо modal.
- `docs/superpowers/specs/2026-10-10-task-journal-design.md`: в начале §98 (только при R3) и §108 (только при R2) добавить строку «Уточнено дизайном 2026-10-12» в виде markdown-ссылки на `2026-10-12-journal-menu-ux-design.md` (тот же каталог).
- В новой спецификации заменить строку статуса на `Статус: реализовано; решения R1–R3: <принято/отклонено по каждому>. Результаты — в [STATUS](../../STATUS.md).`

- [ ] **Step 3: Update STATUS.md**

Добавить раздел по правилам AGENTS.md: факты, затронутые файлы, принятые/отклонённые R1–R3, выполненные проверки с результатом passed / failed / not run, ограничения (закрытие меню при прокрутке, Tab возвращает фокус на триггер), следующая задача. Без личных путей, имён аккаунтов и транскриптов.

- [ ] **Step 4: Full verification**

Run each and record the result:

```bash
npm run verify
npm run format:check
npm run test:unit
npm run test:integration
npm run test:e2e
npm run check:package
npm run check:kit
```

Expected: все проходят. Если браузерное окружение недоступно, `test:e2e` отмечается в STATUS как **not run** с причиной, а не как passed.

- [ ] **Step 5: Real-result screenshots (synthetic only)**

Запустить `npm run dev` с синтетическим seed (как e2e runtime), снять desktop 1440×900 и 375×812: меню строки, меню записи, журнал проекта, журнал задачи и (при R2) открытый composer. Сохранить в `$TMPDIR` для review, **не** коммитить.

- [ ] **Step 6: Commit docs**

```bash
git add docs/UI.md docs/DECISIONS.md docs/STATUS.md docs/superpowers/specs/2026-10-10-task-journal-design.md docs/superpowers/specs/2026-10-12-journal-menu-ux-design.md
git commit -m "docs: record compact journal menus and owner decisions"
```

---

## Self-review

- Spec coverage: §5.1 → Task 1; §5.2 → Tasks 2, 7; §5.3 и §5.4 → Task 3; §5.5 → Task 4; §5.6 → Task 5; §5.7 → Task 6; R3 → Task 8; §7 U01–U12 → Tasks 1–9; §8 → Task 9.
- Типы и имена: `ActionMenuItem`, `ActionMenu` props, `placeMenu`, `MenuPlacement`, `periodLabel`, `placeholder` одинаковы во всех задачах.
- Порядок: Tasks 1–5 не зависят от решений владельца; 6–8 изолированы gate и могут выполняться в любом порядке после 5; Task 9 последний.
