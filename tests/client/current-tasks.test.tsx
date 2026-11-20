// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { CurrentTasks } from '../../src/client/CurrentTasks.js';
import {
  currentGroups,
  defaultCurrentCollapsed,
} from '../../src/client/current-view.js';
import { task } from './fixtures.js';
afterEach(cleanup);
it('exposes five count buttons, labelled regions, defaults, keyboard disclosure and empty messages', async () => {
  function Test() {
    const [collapsed, setCollapsed] = useState(defaultCurrentCollapsed);
    return (
      <CurrentTasks
        groups={currentGroups([], 'weekdays', '2026-11-06')}
        collapsed={collapsed}
        onOpen={vi.fn()}
        onToggle={(id) =>
          setCollapsed((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
    );
  }
  render(<Test />);
  expect(screen.getAllByRole('button')).toHaveLength(5);
  expect(screen.getByText('Нет незавершённых конечных задач')).toBeVisible();
  expect(
    screen
      .getAllByText('Нет задач')
      .filter((node) => !node.closest('[hidden]')),
  ).toHaveLength(3);
  const later = screen.getByRole('button', { name: 'Позже 0' });
  expect(later).toHaveAttribute('aria-controls', 'current-region-later');
  expect(later).toHaveAttribute('aria-expanded', 'false');
  later.focus();
  await userEvent.keyboard('{Enter}');
  expect(later).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('region', { name: 'Позже 0' })).toBeVisible();
  await userEvent.keyboard(' ');
  expect(later).toHaveAttribute('aria-expanded', 'false');
});
it('opens native rows by click/Enter/Space with plain status, complete path and explicit dates', async () => {
  const onOpen = vi.fn();
  const parent = task(1, { title: 'Этап' });
  const today = task(2, {
    parentId: parent.id,
    inputFinish: '2026-11-06',
    status: 'doing',
  });
  render(
    <CurrentTasks
      groups={currentGroups(
        [parent, today, task(3, { inputFinish: '2026-11-05' }), task(4)],
        'weekdays',
        '2026-11-06',
      )}
      collapsed={new Set()}
      onOpen={onOpen}
      onToggle={vi.fn()}
    />,
  );
  const row = document.getElementById(`current-task-${today.id}`)!;
  expect(within(row).getByText('Этап')).toBeVisible();
  expect(within(row).getByLabelText('В работе')).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(within(row).getByText('Окончание: 06.11.2026')).toBeVisible();
  expect(within(row).getByText('Сегодня')).toBeVisible();
  expect(
    screen.getByText('Просрочено', { selector: '.current-urgency' }),
  ).toBeVisible();
  expect(screen.getAllByText('Без окончания').length).toBeGreaterThan(0);
  await userEvent.click(row);
  await userEvent.keyboard('{Enter} ');
  expect(onOpen).toHaveBeenCalledTimes(3);
  expect(onOpen).toHaveBeenLastCalledWith(today, 'today');
});
it('renders every one of 80 long rows without truncating their DOM text or pagination', () => {
  const title = 'Длинное название '.repeat(30);
  render(
    <CurrentTasks
      groups={currentGroups(
        Array.from({ length: 80 }, (_, i) =>
          task(i + 1, { title: `${title}${i}`, inputFinish: '2026-11-06' }),
        ),
        'weekdays',
        '2026-11-06',
      )}
      collapsed={defaultCurrentCollapsed()}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  expect(screen.getAllByRole('button')).toHaveLength(85);
  expect(
    document.getElementById(`current-task-${task(80).id}`),
  ).toHaveTextContent(`${title}79`);
});
