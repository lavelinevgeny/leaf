// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TaskViewControl } from '../../src/client/TaskViewControl.js';
import { TaskTimeline } from '../../src/client/TaskTimeline.js';
import { TaskTree } from '../../src/client/TaskTree.js';
import {
  draftTask,
  draftInterval,
  insertDraftRow,
  fridayPlan,
  scheduleChip,
} from '../../src/client/quick-add-view.js';
import { treeRows } from '../../src/client/tree-view.js';
import { optionalTreeFixture, optionalIds } from './fixtures.js';

afterEach(cleanup);
it('opens a child editor with Shift+Enter and a row action', () => {
  const tree = optionalTreeFixture();
  const action = vi.fn();
  render(
    <TaskTree
      tasks={tree.tasks}
      collapsed={new Set()}
      selectedId={null}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
      onAction={action}
    />,
  );
  fireEvent.keyDown(screen.getByRole('treeitem', { name: /^Работа A,/ }), {
    key: 'Enter',
    shiftKey: true,
  });
  expect(action).toHaveBeenLastCalledWith('child', tree.tasks[1]);
  fireEvent.click(
    screen.getByRole('button', { name: 'Добавить подзадачу: Работа C' }),
  );
  expect(action).toHaveBeenLastCalledWith('child', tree.tasks[2]);
});
it('inserts the draft after the parent branch and uses group dates without changing the tree', () => {
  const tree = optionalTreeFixture();
  const before = structuredClone(tree);
  const context = { parentId: optionalIds.p };
  const draft = draftTask(tree, context, '', {
    inputStart: null,
    inputFinish: null,
    durationDays: 2,
  });
  const rows = insertDraftRow(treeRows(tree.tasks, new Set()), draft, context);
  expect(rows.map((row) => row.task.id)).toEqual([
    ...tree.tasks.map((task) => task.id),
    draft.id,
  ]);
  expect(rows.at(-1)?.depth).toBe(1);
  expect(draftInterval(tree, draft, '2026-10-08')).toEqual({
    start: '2026-10-05',
    finish: '2026-10-06',
    kind: 'conditional',
    clipped: false,
  });
  expect(
    draftInterval(tree, { ...draft, parentId: null }, '2026-10-08')?.start,
  ).toBe('2026-10-08');
  expect(tree).toEqual(before);
});
it('keeps a dated draft conditional and formats the selected interval', () => {
  const tree = optionalTreeFixture();
  const plan = {
    inputStart: '2026-10-08',
    inputFinish: '2026-10-09',
    durationDays: 2,
  };
  expect(scheduleChip(plan, 'weekdays')).toBe('8–9 окт · 2 р.д.');
  expect(
    draftInterval(
      tree,
      draftTask(tree, { parentId: null }, 'Draft', plan),
      '2026-10-08',
    )?.kind,
  ).toBe('conditional');
});
it('Until Friday counts working days and starts on Monday after a weekend', () => {
  expect(fridayPlan('2026-10-08', 'weekdays')).toEqual({
    inputStart: '2026-10-08',
    inputFinish: '2026-10-09',
    durationDays: 2,
  });
  expect(fridayPlan('2026-10-10', 'weekdays')).toEqual({
    inputStart: '2026-10-12',
    inputFinish: '2026-10-16',
    durationDays: 5,
  });
  expect(fridayPlan('2026-10-10', 'all-days').durationDays).toBe(7);
});

it('preserves the mounted tree, dirty editor, focus and shared header across view changes', () => {
  const tree = optionalTreeFixture();
  const before = structuredClone(tree);
  const context = { parentId: optionalIds.p };
  const p = {
    tree,
    selectedId: optionalIds.a,
    collapsed: new Set([optionalIds.p]),
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onAction: vi.fn(),
    onPlan: vi.fn(),
    disabled: false,
    show: true,
    reveal: null,
    draft: {
      task: draftTask(tree, context, 'Synthetic draft', {
        inputStart: null,
        inputFinish: null,
        durationDays: 1,
      }),
      context,
      active: true,
      input: (
        <input aria-label="Synthetic editor" defaultValue="Synthetic draft" />
      ),
    },
  };
  const view = render(<TaskTimeline {...p} />);
  const editor = screen.getByRole('textbox', { name: 'Synthetic editor' });
  const taskTree = screen.getByRole('tree', { name: 'Задачи' });
  const selected = screen.getByRole('treeitem', { name: /^Работа A,/ });
  const heading = view.container.querySelector('.timeline-heading');
  editor.focus();
  for (const show of [false, true, false]) {
    view.rerender(<TaskTimeline {...p} show={show} />);
    expect(screen.getByRole('textbox', { name: 'Synthetic editor' })).toBe(
      editor,
    );
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('Synthetic draft');
    expect(screen.getByRole('tree', { name: 'Задачи' })).toBe(taskTree);
    expect(screen.getByRole('treeitem', { name: /^Работа A,/ })).toBe(selected);
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(view.container.querySelector('.timeline-heading')).toBe(heading);
  }
  expect(tree).toEqual(before);
  expect(p.onPlan).not.toHaveBeenCalled();
  expect(p.onToggle).not.toHaveBeenCalled();
});

it('keeps the inline editor, selection and selected tree row on actual pointer switching', async () => {
  const user = userEvent.setup();
  const tree = optionalTreeFixture();
  const context = { parentId: optionalIds.p };
  const blur = vi.fn();
  const p = {
    tree,
    selectedId: optionalIds.a,
    collapsed: new Set<string>(),
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onAction: vi.fn(),
    onPlan: vi.fn(),
    disabled: false,
    reveal: null,
    draft: {
      task: draftTask(tree, context, 'Synthetic draft', {
        inputStart: null,
        inputFinish: null,
        durationDays: 1,
      }),
      context,
      active: true,
      input: (
        <input
          aria-label="Synthetic pointer editor"
          defaultValue="Synthetic draft"
          onBlur={blur}
        />
      ),
    },
  };
  function Timeline() {
    const [show, setShow] = useState(true);
    return (
      <TaskTimeline
        {...p}
        show={show}
        viewControl={<TaskViewControl showGantt={show} onChange={setShow} />}
      />
    );
  }
  const view = render(<Timeline />);
  const editor = screen.getByRole('textbox', {
    name: 'Synthetic pointer editor',
  }) as HTMLInputElement;
  const taskTree = screen.getByRole('tree', { name: 'Задачи' });
  const selected = screen.getByRole('treeitem', { name: /^Работа A,/ });
  const heading = view.container.querySelector('.timeline-heading');
  await user.click(editor);
  editor.setSelectionRange(3, 8);
  for (const name of ['Список', 'Гант']) {
    await user.click(screen.getByRole('button', { name }));
    expect(
      screen.getByRole('textbox', { name: 'Synthetic pointer editor' }),
    ).toBe(editor);
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('Synthetic draft');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 8]);
    expect(screen.getByRole('tree', { name: 'Задачи' })).toBe(taskTree);
    expect(screen.getByRole('treeitem', { name: /^Работа A,/ })).toBe(selected);
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(view.container.querySelector('.timeline-heading')).toBe(heading);
    expect(blur).not.toHaveBeenCalled();
  }
  expect(p.onPlan).not.toHaveBeenCalled();
  expect(p.onToggle).not.toHaveBeenCalled();
});

it('opens the leaf chain action with Alt+L without selection/move and keeps its actual trigger', async () => {
  const tree = optionalTreeFixture(),
    onPredecessors = vi.fn(),
    onSelect = vi.fn(),
    onAction = vi.fn();
  render(
    <TaskTree
      tasks={tree.tasks}
      collapsed={new Set()}
      selectedId={null}
      onToggle={vi.fn()}
      onSelect={onSelect}
      onAction={onAction}
      onPredecessors={onPredecessors}
    />,
  );
  const row = screen.getByRole('treeitem', { name: /^Работа C,/ }),
    trigger = screen.getByRole('button', { name: 'После окончания: Работа C' });
  expect(trigger).toBeInstanceOf(HTMLButtonElement);
  fireEvent.keyDown(row, { key: 'l', altKey: true });
  expect(onPredecessors).toHaveBeenLastCalledWith(tree.tasks[2], trigger);
  await userEvent.click(trigger);
  expect(onPredecessors).toHaveBeenCalledTimes(2);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onAction).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'После окончания: Этап P' }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('treeitem', { name: /^Этап P,/ }), {
    key: 'l',
    altKey: true,
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Выберите конечную работу',
  );
});
