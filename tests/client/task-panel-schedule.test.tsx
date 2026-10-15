// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import {
  PlanFields,
  type PlanFieldsHandle,
} from '../../src/client/PlanFields.js';
import { taskScheduleLabel } from '../../src/client/task-panel-view.js';
import type { SourceFields } from '../../src/shared/contracts.js';
afterEach(cleanup);
it.each([
  [null, null, null, 'all-days', 'Без дат'],
  [null, null, 3, 'weekdays', 'Без дат · 3 раб. дня'],
  [null, null, 1, 'all-days', 'Без дат · 1 день'],
  ['2026-10-09', null, null, 'all-days', 'Начало: 9 окт.'],
  [null, '2026-10-12', 2, 'all-days', 'Окончание: 12 окт. · 2 дня'],
  ['2026-10-09', '2026-10-12', null, 'weekdays', '9–12 окт.'],
  ['2026-10-09', '2026-10-12', 2, 'weekdays', '9–12 окт. · 2 раб. дня'],
] as const)(
  'labels actual source %s/%s/%s',
  (inputStart, inputFinish, durationDays, calendar, expected) => {
    expect(
      taskScheduleLabel({ inputStart, inputFinish, durationDays }, calendar),
    ).toBe(expected);
  },
);
function SynchronousEditor({
  calendar = 'weekdays' as 'weekdays' | 'all-days',
}) {
  const [plan, setPlan] = useState<SourceFields>({
    inputStart: '2026-10-09',
    inputFinish: null,
    durationDays: 2,
  });
  const latest = useRef(plan);
  latest.current = plan;
  const fields = useRef<PlanFieldsHandle>(null);
  const save = vi.fn();
  return (
    <>
      <PlanFields
        ref={fields}
        task={{ status: 'doing' }}
        plan={plan}
        calendar={calendar}
        summary={false}
        disabled={false}
        onChange={(p) => {
          latest.current = p;
          setPlan(p);
        }}
      />
      <button
        onClick={() => {
          if (fields.current?.finishInput()) save(latest.current);
        }}
      >
        Done
      </button>
      <output>{JSON.stringify(plan)}</output>
    </>
  );
}
it.each([
  ['weekdays', '2026-10-13'],
  ['all-days', '2026-10-13'],
] as const)('finishes current raw synchronously for %s', (calendar, finish) => {
  render(<SynchronousEditor calendar={calendar} />);
  fireEvent.focus(screen.getByLabelText('Начало'));
  fireEvent.change(screen.getByLabelText('Начало'), {
    target: { value: '12.10.2026' },
  });
  expect(screen.getByLabelText('Окончание')).toHaveValue('');
  fireEvent.click(screen.getByText('Done'));
  expect(screen.getByLabelText('Окончание')).toHaveValue(
    finish.split('-').reverse().join('.'),
  );
});

import userEvent from '@testing-library/user-event';
import { act, waitFor } from '@testing-library/react';
import {
  TaskPanel,
  type PanelTab,
  type TaskPanelActions,
} from '../../src/client/TaskPanel.js';
import { optionalTreeFixture, task, emptySchedule } from './fixtures.js';
import type { ComponentProps } from 'react';
import type { ProjectTree } from '../../src/shared/contracts.js';
function panelTree(overrides: Partial<ReturnType<typeof task>> = {}) {
  return {
    ...optionalTreeFixture(),
    tasks: [
      task(1, {
        title: 'Синтетическая задача',
        inputStart: '2026-10-09',
        inputFinish: '2026-10-12',
        durationDays: 2,
        ...overrides,
      }),
    ],
    schedule: structuredClone(emptySchedule),
  };
}
function Panel(props: Partial<ComponentProps<typeof TaskPanel>>) {
  const [tree] = useState(() => props.tree ?? panelTree());
  const [tab, onTab] = useState<PanelTab>('details');
  return (
    <TaskPanel
      task={tree.tasks[0]!}
      tree={tree}
      tasks={tree.tasks}
      removed={false}
      onDependency={vi.fn(async () => true)}
      onNeighbor={vi.fn()}
      onShow={vi.fn()}
      backTask={null}
      onBack={vi.fn()}
      collapsed={new Set()}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
      onAction={vi.fn()}
      onMove={vi.fn()}
      onSave={vi.fn(async () => null)}
      onDirty={vi.fn()}
      onClose={vi.fn()}
      busy={false}
      retry={false}
      conflict={false}
      locked={false}
      feedback={null}
      {...props}
      tab={tab}
      onTab={onTab}
    />
  );
}
async function openDates(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
}
it('preserves invalid raw, error, DOM and dirty across Escape and tabs; footer repairs the addressed field', async () => {
  const user = userEvent.setup(),
    onClose = vi.fn(),
    onDirty = vi.fn();
  render(<Panel onClose={onClose} onDirty={onDirty} />);
  await openDates(user);
  const input = screen.getByLabelText('Начало');
  await user.click(input);
  fireEvent.change(input, { target: { value: '31.02.2026' } });
  expect(onDirty).toHaveBeenLastCalledWith(true);
  await user.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await user.click(screen.getByRole('tab', { name: 'Журнал' }));
  await user.click(screen.getByRole('button', { name: 'Исправить сроки' }));
  await waitFor(() => expect(input).toHaveFocus());
  expect(screen.getByLabelText('Начало')).toBe(input);
  expect(input).toHaveValue('31.02.2026');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toBeVisible();
});
it('protects pending same-source input, finishes synchronously for registered save and resets without stale blur', async () => {
  const user = userEvent.setup(),
    onDirty = vi.fn(),
    onSave = vi.fn(async () => null);
  let actions: TaskPanelActions | null = null;
  render(
    <Panel
      onSave={onSave}
      onDirty={onDirty}
      registerActions={(a) => {
        actions = a;
      }}
    />,
  );
  await openDates(user);
  const input = screen.getByLabelText('Начало');
  await user.click(input);
  fireEvent.change(input, { target: { value: '2026-10-09' } });
  expect(onDirty).toHaveBeenLastCalledWith(true);
  act(() => actions!.reset());
  fireEvent.blur(input);
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect(input).toHaveValue('09.10.2026');
  await user.click(input);
  fireEvent.change(input, { target: { value: '12.10.2026' } });
  await act(async () => {
    await actions!.save();
  });
  expect(onSave).toHaveBeenLastCalledWith({
    inputStart: '2026-10-12',
    inputFinish: '2026-10-13',
  });
});
it.each([
  ['10.10.2026', 'Начало'],
  ['31.02.2026', 'Начало'],
  ['08.10.2026', 'Окончание'],
] as const)('keeps invalid date %s local and addressed', async (raw, label) => {
  const user = userEvent.setup();
  render(<Panel />);
  await openDates(user);
  const field = screen.getByLabelText(label);
  await user.click(field);
  fireEvent.change(field, { target: { value: raw } });
  await user.click(screen.getByRole('button', { name: 'Готово' }));
  expect(screen.getByRole('dialog', { name: 'Сроки задачи' })).toBeVisible();
  expect(field).toHaveValue(raw);
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
});
it.each(['0', '1.5'])(
  'retains invalid duration %s and clear all removes validation',
  async (raw) => {
    const user = userEvent.setup();
    render(<Panel />);
    await openDates(user);
    const field = screen.getByLabelText('Длительность, рабочих дней');
    await user.click(field);
    fireEvent.change(field, { target: { value: raw } });
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await user.click(
      screen.getByRole('button', { name: 'Очистить все сроки' }),
    );
    expect(field).toHaveValue(null);
    expect(screen.getByLabelText('Начало')).toHaveValue('');
    expect(screen.getByLabelText('Окончание')).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  },
);
it('shows summary only from both computed endpoints and no own editor', () => {
  const tree = panelTree();
  tree.tasks.push(task(2, { parentId: tree.tasks[0]!.id }));
  tree.schedule.summaries[tree.tasks[0]!.id] = {
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    knownLeafCount: 0,
    totalLeafCount: 1,
  };
  const view = render(<Panel tree={tree} />);
  expect(
    screen.getByRole('button', {
      name: 'Сроки задачи: Сводные сроки не определены',
    }),
  ).toBeDisabled();
  expect(screen.queryByLabelText('Начало')).toBeNull();
  tree.schedule.summaries[tree.tasks[0]!.id] = {
    startDate: '2026-10-09',
    finishDate: '2026-10-12',
    calendarSpanDays: 2,
    knownLeafCount: 1,
    totalLeafCount: 1,
    containsCritical: false,
  };
  view.rerender(<Panel tree={{ ...tree }} />);
  expect(
    screen.getByRole('button', { name: 'Сроки задачи: 9–12 окт.' }),
  ).toBeDisabled();
});
it('keeps done dates locked until explicit doing and supplies a deleted reason', async () => {
  const user = userEvent.setup();
  const tree = panelTree({ status: 'done' });
  const view = render(<Panel tree={tree} />);
  expect(screen.getByRole('button', { name: /^Сроки задачи:/ })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Статус'), 'doing');
  await openDates(user);
  expect(screen.getByLabelText('Начало')).toBeEnabled();
  view.rerender(<Panel tree={tree} removed />);
  expect(screen.getByRole('button', { name: /^Сроки задачи:/ })).toBeDisabled();
  expect(screen.getByLabelText('Начало')).toBeDisabled();
});
it('retries the sent operation despite newer invalid raw and preserves it after frozen acknowledgement', async () => {
  const user = userEvent.setup(),
    tree = panelTree();
  let resolve!: (tree: ProjectTree | null) => void;
  const onSave = vi.fn(
    () =>
      new Promise<ProjectTree | null>((r) => {
        resolve = r;
      }),
  );
  const view = render(<Panel tree={tree} onSave={onSave} />);
  await openDates(user);
  await user.selectOptions(screen.getByLabelText('Статус'), 'doing');
  await openDates(user);
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await act(async () => resolve(null));
  const field = screen.getByLabelText('Начало');
  await user.click(field);
  fireEvent.change(field, { target: { value: '31.02.2026' } });
  await user.tab();
  expect(field).toHaveAttribute('aria-invalid', 'true');
  view.rerender(<Panel tree={tree} onSave={onSave} retry locked />);
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(
    screen.getByRole('button', { name: 'Повторить сохранение' }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить сохранение' }));
  const ack = structuredClone(tree);
  ack.tasks[0]!.status = 'doing';
  ack.project.revision++;
  await act(async () => resolve(ack));
  expect(field).toHaveValue('31.02.2026');
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText('Сохранено', { exact: true })).toBeNull();
});

it.each([
  ['weekdays', '12.10.2026'],
  ['all-days', '10.10.2026'],
] as const)(
  'uses literal Friday duration completion for %s',
  (calendar, expected) => {
    render(<SynchronousEditor calendar={calendar} />);
    const start = screen.getByLabelText('Начало');
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: '2026-10-09' } });
    expect(screen.getByLabelText('Окончание')).toHaveValue('');
    fireEvent.click(screen.getByText('Done'));
    expect(screen.getByLabelText('Окончание')).toHaveValue(expected);
  },
);

it('registered repair completes pending duration and focuses its current structured error', async () => {
  const user = userEvent.setup();
  let actions: TaskPanelActions | null = null;
  render(
    <Panel
      registerActions={(a) => {
        actions = a;
      }}
    />,
  );
  await openDates(user);
  const duration = screen.getByLabelText('Длительность, рабочих дней');
  await user.click(duration);
  fireEvent.change(duration, { target: { value: '1.5' } });
  act(() => actions!.focusInvalid());
  await waitFor(() => expect(duration).toHaveFocus());
  expect(duration).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Длительность:');
});

it('Today and Tomorrow use project day and preserve explicit weekend errors without snapping', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-09T02:30:00Z'));
    const tree = panelTree();
    tree.project.timezone = 'Pacific/Honolulu';
    render(<Panel tree={tree} />);
    fireEvent.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    expect(screen.getByLabelText('Начало')).toHaveValue('08.10.2026');
    expect(screen.getByLabelText('Окончание')).toHaveValue('09.10.2026');
    fireEvent.click(screen.getByRole('button', { name: 'Завтра' }));
    expect(screen.getByLabelText('Начало')).toHaveValue('09.10.2026');
    expect(screen.getByLabelText('Окончание')).toHaveValue('12.10.2026');
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    cleanup();
    render(<Panel tree={tree} />);
    fireEvent.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    expect(screen.getByLabelText('Начало')).toHaveValue('10.10.2026');
    expect(screen.getByLabelText('Начало')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  } finally {
    vi.useRealTimers();
  }
});
