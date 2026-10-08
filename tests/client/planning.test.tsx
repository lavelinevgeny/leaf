// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanFields } from '../../src/client/PlanFields.js';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { sourceOf } from '../../src/client/planning-view.js';
import { TaskPanel } from '../../src/client/TaskPanel.js';
import { optionalTreeFixture } from './fixtures.js';
import type { Command, ProjectTree } from '../../src/shared/contracts.js';
import { waitFor } from '@testing-library/react';
import { task } from './fixtures.js';
afterEach(cleanup);
function Editor({
  source = task(1, {
    inputStart: '2026-10-09',
    inputFinish: '2026-10-12',
    durationDays: 2,
  }),
  onChange = vi.fn(),
  calendar = 'weekdays' as 'weekdays' | 'all-days',
}) {
  const [plan, setPlan] = useState(sourceOf(source));
  return (
    <PlanFields
      task={source}
      plan={plan}
      calendar={calendar}
      summary={false}
      disabled={false}
      onChange={(next) => {
        setPlan(next);
        onChange(next);
      }}
    />
  );
}
it('completes dates and duration after blur or Enter, keeps clearing optional', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Editor onChange={onChange} />);
  const start = screen.getByLabelText('Начало');
  const finish = screen.getByLabelText('Окончание');
  const duration = screen.getByLabelText('Длительность, рабочих дней');
  expect(start).toHaveValue('09.10.2026');
  await user.click(start);
  fireEvent.change(start, { target: { value: '12.10.2026' } });
  expect(finish).toHaveValue('12.10.2026');
  await user.tab();
  expect(finish).toHaveValue('13.10.2026');
  expect(duration).toHaveValue(2);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Пересчитано: Окончание',
  );
  await user.click(finish);
  fireEvent.change(finish, { target: { value: '14.10.2026' } });
  await user.keyboard('{Enter}');
  expect(start).toHaveValue('12.10.2026');
  expect(duration).toHaveValue(3);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Пересчитано: Длительность',
  );
  await user.click(duration);
  fireEvent.change(duration, { target: { value: '4' } });
  expect(finish).toHaveValue('14.10.2026');
  await user.tab();
  expect(finish).toHaveValue('15.10.2026');
  await user.click(duration);
  await user.clear(duration);
  await user.tab();
  expect(duration).toHaveValue(null);
  expect(finish).toHaveValue('15.10.2026');
  expect(onChange).toHaveBeenLastCalledWith({
    inputStart: '2026-10-12',
    inputFinish: '2026-10-15',
    durationDays: null,
  });
  await user.click(start);
  await user.clear(start);
  await user.tab();
  expect(start).toHaveValue('');
  expect(finish).toHaveValue('15.10.2026');
  expect(screen.queryByLabelText('Режим планирования')).toBeNull();
  expect(screen.queryByLabelText('Дедлайн')).toBeNull();
});
it('does not fill fields on focus or during unanchored duration input', async () => {
  const user = userEvent.setup();
  render(
    <Editor
      source={task(1, { inputStart: '2026-10-09', inputFinish: '2026-10-12' })}
    />,
  );
  await user.click(screen.getByLabelText('Окончание'));
  await user.tab();
  expect(screen.getByLabelText('Длительность, рабочих дней')).toHaveValue(null);
  cleanup();
  render(<Editor source={task(1)} />);
  await user.type(screen.getByLabelText('Длительность, рабочих дней'), '6');
  await user.tab();
  expect(screen.getByLabelText('Начало')).toHaveValue('');
  expect(screen.getByLabelText('Окончание')).toHaveValue('');
});
it('uses the finish anchor and calendar picker, and reports invalid input without replacing the other fields', async () => {
  const user = userEvent.setup();
  render(
    <Editor source={task(1, { inputFinish: '2026-10-12', durationDays: 2 })} />,
  );
  await user.click(screen.getByLabelText('Длительность, рабочих дней'));
  fireEvent.change(screen.getByLabelText('Длительность, рабочих дней'), {
    target: { value: '3' },
  });
  await user.tab();
  expect(screen.getByLabelText('Начало')).toHaveValue('08.10.2026');
  fireEvent.change(screen.getByLabelText('Календарь: Начало'), {
    target: { value: '2026-10-09' },
  });
  expect(screen.getByLabelText('Окончание')).toHaveValue('13.10.2026');
  await user.click(screen.getByLabelText('Окончание'));
  fireEvent.change(screen.getByLabelText('Окончание'), {
    target: { value: '10.10.2026' },
  });
  await user.tab();
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByLabelText('Начало')).toHaveValue('09.10.2026');
  expect(screen.getByLabelText('Длительность, рабочих дней')).toHaveValue(3);
  expect(screen.getByLabelText('Окончание')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await user.click(screen.getByLabelText('Окончание'));
  await user.clear(screen.getByLabelText('Окончание'));
  await user.tab();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('Окончание')).toHaveValue('');
});
it('labels all-days duration accurately and retains malformed date text until corrected', async () => {
  const user = userEvent.setup();
  render(<Editor calendar="all-days" />);
  expect(screen.getByLabelText('Длительность, дней')).toHaveValue(2);
  await user.click(screen.getByLabelText('Начало'));
  fireEvent.change(screen.getByLabelText('Начало'), {
    target: { value: '31.02.2026' },
  });
  await user.tab();
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByLabelText('Начало')).toHaveValue('31.02.2026');
  await user.click(screen.getByLabelText('Начало'));
  fireEvent.change(screen.getByLabelText('Начало'), {
    target: { value: '09.10.2026' },
  });
  await user.tab();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('Окончание')).toHaveValue('10.10.2026');
});
it('keeps incomplete summary boundaries empty and done source disabled', () => {
  const a = task(1, { status: 'done' });
  const props = {
    task: a,
    plan: sourceOf(a),
    calendar: 'weekdays' as const,
    summary: true,
    disabled: false,
    onChange: vi.fn(),
  };
  const view = render(
    <PlanFields {...props} computed={{ startDate: null, finishDate: null }} />,
  );
  expect(screen.getByLabelText('Начало')).toHaveValue('');
  expect(screen.getByLabelText('Начало')).toBeDisabled();
  view.rerender(<PlanFields {...props} summary={false} />);
  expect(screen.getByLabelText('Длительность, рабочих дней')).toBeDisabled();
  view.rerender(
    <PlanFields {...props} task={{ ...a, status: 'doing' }} summary={false} />,
  );
  expect(screen.getByLabelText('Длительность, рабочих дней')).toBeEnabled();
});

it.each([0, -1, 1.5, 1000001])(
  'retains invalid duration %s without moving dates',
  async (value) => {
    const user = userEvent.setup();
    render(<Editor />);
    const duration = screen.getByLabelText('Длительность, рабочих дней');
    await user.click(duration);
    fireEvent.change(duration, { target: { value: String(value) } });
    await user.tab();
    expect(duration).toHaveValue(value);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByLabelText('Начало')).toHaveValue('09.10.2026');
    expect(screen.getByLabelText('Окончание')).toHaveValue('12.10.2026');
  },
);

it('opens the native picker by keyboard without submitting the form', async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  render(
    <form onSubmit={submit}>
      <Editor />
    </form>,
  );
  const picker = screen.getByLabelText('Календарь: Начало');
  const showPicker = vi.fn();
  Object.defineProperty(picker, 'showPicker', { value: showPicker });
  await user.click(screen.getByLabelText('Начало'));
  await user.tab();
  expect(picker).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(showPicker).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it('does not recommit a focused text buffer after an external discard', async () => {
  const user = userEvent.setup();
  const a = task(1, {
    inputStart: '2026-10-09',
    inputFinish: '2026-10-12',
    durationDays: 2,
  });
  const onChange = vi.fn();
  const props = {
    task: a,
    calendar: 'weekdays' as const,
    summary: false,
    disabled: false,
    onChange,
  };
  const view = render(<PlanFields {...props} plan={sourceOf(a)} />);
  const start = screen.getByLabelText('Начало');
  await user.click(start);
  fireEvent.change(start, { target: { value: '12.10.2026' } });
  view.rerender(
    <PlanFields
      {...props}
      plan={{ ...sourceOf(a), inputStart: '2026-10-12' }}
    />,
  );
  view.rerender(<PlanFields {...props} plan={sourceOf(a)} />);
  onChange.mockClear();
  await user.tab();
  expect(start).toHaveValue('09.10.2026');
  expect(onChange).not.toHaveBeenCalled();
});

function panelProps(
  tree: ProjectTree,
  onSave: (
    changes: Extract<Command, { type: 'task.edit' }>['changes'],
  ) => Promise<ProjectTree | null>,
) {
  return {
    tree,
    task: tree.tasks[1]!,
    tasks: tree.tasks,
    removed: false,
    tab: 'details' as const,
    onTab: vi.fn(),
    onDependency: vi.fn(async () => true),
    onNeighbor: vi.fn(),
    onShow: vi.fn(),
    backTask: null,
    onBack: vi.fn(),
    collapsed: new Set<string>(),
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onAction: vi.fn(),
    onMove: vi.fn(),
    onSave,
    onDirty: vi.fn(),
    onClose: vi.fn(),
    busy: false,
    retry: false,
    conflict: false,
    locked: false,
    feedback: null,
  };
}
function fsPanelFixture() {
  const tree = optionalTreeFixture();
  tree.tasks = [
    task(1, {
      title: 'A',
      inputStart: '2026-10-08',
      inputFinish: '2026-10-09',
    }),
    task(2, {
      title: 'B',
      inputStart: '2026-10-08',
      inputFinish: '2026-10-09',
    }),
  ];
  tree.schedule = { ...tree.schedule, tasks: {}, summaries: {}, display: {} };
  const ack: ProjectTree = {
    ...tree,
    project: { ...tree.project, revision: 1 },
    tasks: [
      tree.tasks[0]!,
      {
        ...tree.tasks[1]!,
        inputStart: '2026-10-12',
        inputFinish: '2026-10-13',
      },
    ],
    dependencies: [
      {
        id: task(90).id,
        projectId: tree.project.id,
        predecessorId: tree.tasks[0]!.id,
        successorId: tree.tasks[1]!.id,
      },
    ],
  };
  return { tree, ack };
}
async function choosePanelA(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'После окончания' }));
  await user.type(screen.getByRole('searchbox'), 'A');
  await user.keyboard('{ArrowDown}{Enter}{Escape}');
}
it('takes canonical Details source and relation baseline from a relation-only Save response', async () => {
  const { tree, ack } = fsPanelFixture();
  const onSave = vi.fn(async () => ack);
  render(<TaskPanel {...panelProps(tree, onSave)} />);
  const user = userEvent.setup();
  await choosePanelA(user);
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await screen.findByText('Сохранено');
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    predecessorIds: [tree.tasks[0]!.id],
  });
  expect(screen.getByLabelText('Начало')).toHaveValue('12.10.2026');
  expect(screen.getByLabelText('Окончание')).toHaveValue('13.10.2026');
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
});
it('keeps a newer full panel draft dirty after deferred Save and reconciles its baseline without claiming success', async () => {
  const { tree, ack } = fsPanelFixture();
  let resolve!: (value: ProjectTree) => void;
  const onSave = vi.fn(
    () =>
      new Promise<ProjectTree>((done) => {
        resolve = done;
      }),
  );
  render(<TaskPanel {...panelProps(tree, onSave)} />);
  const user = userEvent.setup();
  await choosePanelA(user);
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await user.type(screen.getByLabelText('Описание'), 'Новый черновик');
  resolve(ack);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Описание')).toHaveValue('Новый черновик');
  expect(screen.queryByText('Сохранено')).not.toBeInTheDocument();
  expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument();
  onSave.mockImplementationOnce(async () => ack);
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenLastCalledWith({
    description: 'Новый черновик',
    inputStart: '2026-10-08',
    inputFinish: '2026-10-09',
  });
});
it('handles global acknowledged replay without replacing newer edits, then explicit discard restores all canonical fields', async () => {
  const { tree, ack } = fsPanelFixture();
  const p = panelProps(
    tree,
    vi.fn(async () => null),
  );
  const view = render(<TaskPanel {...p} />);
  const user = userEvent.setup();
  await choosePanelA(user);
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await user.type(screen.getByLabelText('Описание'), 'Новый черновик');
  view.rerender(
    <TaskPanel
      {...p}
      task={ack.tasks[1]!}
      tree={ack}
      tasks={ack.tasks}
      saveAcknowledgement={ack}
    />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Описание')).toHaveValue('Новый черновик'),
  );
  expect(screen.queryByText('Сохранено')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Отбросить изменения' }));
  expect(screen.getByLabelText('Начало')).toHaveValue('12.10.2026');
  expect(screen.getByLabelText('Описание')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'После окончания' }));
  expect(
    screen.getByRole('button', { name: 'Убрать предшественника: A' }),
  ).toBeInTheDocument();
});
