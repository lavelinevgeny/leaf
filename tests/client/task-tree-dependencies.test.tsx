// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskTree } from '../../src/client/TaskTree.js';
import { draftTaskId } from '../../src/client/quick-add-view.js';
import { project, task } from './fixtures.js';
import type { Dependency } from '../../src/shared/contracts.js';
afterEach(cleanup);
const a = task(1),
  target = task(2),
  b = task(3);
const dependencies: Dependency[] = [
  {
    id: 'incoming',
    projectId: project.id,
    predecessorId: a.id,
    successorId: target.id,
  },
  {
    id: 'outgoing',
    projectId: project.id,
    predecessorId: target.id,
    successorId: b.id,
  },
];
function setup(extra: Partial<React.ComponentProps<typeof TaskTree>> = {}) {
  const onSelect = vi.fn(),
    onAction = vi.fn(),
    onDependencies = vi.fn();
  const onPointer = vi.fn();
  const view = render(
    <div onPointerDown={onPointer}>
      <TaskTree
        tasks={[a, target, b]}
        selectedId={null}
        collapsed={new Set()}
        onToggle={vi.fn()}
        onSelect={onSelect}
        onAction={onAction}
        dependencies={dependencies}
        onDependencies={onDependencies}
        {...extra}
      />
    </div>,
  );
  return { ...view, onSelect, onAction, onDependencies, onPointer };
}
it('uses one chain/count from the complete saved graph even with hidden neighbors', async () => {
  const { onSelect, onAction, onDependencies, onPointer } = setup({
    rows: [{ task: target, depth: 0, hasChildren: false }],
  });
  const row = screen.getByRole('treeitem');
  const button = within(row).getByRole('button', {
    name: `Зависимости: ${target.title}`,
  });
  expect(
    within(row).getAllByRole('button', { name: /^Зависимости:/ }),
  ).toHaveLength(1);
  expect(button).toHaveTextContent('2');
  expect(button).toHaveAccessibleDescription('Связей: 2');
  expect(button).toHaveAttribute('tabindex', '0');
  fireEvent.pointerDown(button);
  expect(onPointer).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(button);
  await user.keyboard('{Enter} ');
  expect(onDependencies).toHaveBeenCalledTimes(3);
  expect(onDependencies).toHaveBeenLastCalledWith(target, button);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onAction).not.toHaveBeenCalled();
});
it('omits zero text, explains summary/dirty locks and excludes preview controls', () => {
  const parent = task(4),
    child = task(5, { parentId: parent.id });
  setup({
    tasks: [parent, child, { ...task(6), id: draftTaskId }],
    dependencies: [],
    draftInput: <input aria-label="Preview" />,
    dependencyBlockedReason: 'Сначала сохраните или отмените изменения задачи',
  });
  const summary = screen.getByRole('button', {
    name: `Зависимости: ${parent.title}`,
  });
  expect(summary).toBeDisabled();
  expect(summary).toHaveAccessibleDescription(/Выберите конечную работу/);
  const leaf = screen.getByRole('button', {
    name: `Зависимости: ${child.title}`,
  });
  expect(leaf).toBeDisabled();
  expect(leaf).toHaveAccessibleDescription(/Сначала сохраните/);
  expect(leaf).not.toHaveTextContent('0');
  expect(screen.getAllByRole('button', { name: /^Зависимости:/ })).toHaveLength(
    2,
  );
});

it.each(['Зависимости', 'Добавить подзадачу', 'Добавить запись'])(
  'lets Escape and global Undo bubble from the shared %s action',
  (name) => {
    setup({ onJournal: vi.fn() });
    const button = screen.getByRole('button', {
      name: `${name}: ${target.title}`,
    });
    const keydown = vi.fn();
    window.addEventListener('keydown', keydown);
    try {
      fireEvent.keyDown(button, { key: 'Escape' });
      fireEvent.keyDown(button, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(button, { key: 'z', metaKey: true });
      expect(keydown.mock.calls.map(([event]) => event.key)).toEqual([
        'Escape',
        'z',
        'z',
      ]);
      fireEvent.keyDown(button, { key: 'Enter' });
      fireEvent.keyDown(button, { key: ' ' });
      expect(keydown).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener('keydown', keydown);
    }
  },
);
