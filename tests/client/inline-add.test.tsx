// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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
