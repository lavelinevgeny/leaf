// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { QuickAdd, type AddContext } from '../../src/client/QuickAdd.js';
import { optionalTreeFixture, task } from './fixtures.js';
import type { SourceFields } from '../../src/shared/contracts.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function Editor({
  create = vi.fn(async () => true),
  parentPlan = null,
  acknowledgement = 0,
}: {
  create?: (
    title: string,
    context: AddContext,
    plan: SourceFields,
    predecessorIds: string[],
  ) => Promise<boolean>;
  parentPlan?: SourceFields | null;
  acknowledgement?: number;
}) {
  const [predecessorIds, setPredecessorIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [plan, setPlan] = useState<SourceFields>({
    inputStart: null,
    inputFinish: null,
    durationDays: 1,
  });
  return (
    <QuickAdd
      acknowledgement={acknowledgement}
      tree={{ ...optionalTreeFixture(), tasks: [task(1, { title: 'A' })] }}
      predecessorIds={predecessorIds}
      onPredecessors={setPredecessorIds}
      tasks={[]}
      context={{ parentId: null }}
      onContext={vi.fn()}
      title={title}
      onTitle={setTitle}
      onCreate={create}
      busy={false}
      blocked={false}
      plan={plan}
      onPlan={setPlan}
      calendar="weekdays"
      timezone="Europe/Moscow"
      parentPlan={parentPlan}
    />
  );
}
it('creates with one day and empty dates; clearing duration submits null', async () => {
  const create = vi.fn(async () => true);
  render(<Editor create={create} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Новая задача'), 'Работа');
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  expect(screen.getByLabelText('Длительность, рабочих дней')).toHaveValue('1');
  expect(screen.getByLabelText('Начало')).toHaveValue('');
  expect(screen.getByLabelText('Окончание')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  expect(create).toHaveBeenLastCalledWith(
    'Работа',
    { parentId: null },
    { inputStart: null, inputFinish: null, durationDays: 1 },
    [],
  );
  await user.clear(screen.getByLabelText('Длительность, рабочих дней'));
  await user.tab();
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  expect(create).toHaveBeenLastCalledWith(
    'Работа',
    { parentId: null },
    { inputStart: null, inputFinish: null, durationDays: null },
    [],
  );
});

it('unsolicited acknowledgement preserves schedule focus and keeps the existing schedule popover open', async () => {
  const view = render(<Editor acknowledgement={0} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  expect(screen.getByLabelText('Начало', { exact: true })).toBeVisible();
  view.rerender(<Editor acknowledgement={1} />);
  expect(screen.getByLabelText('Начало', { exact: true })).toBeVisible();
  expect(
    screen.getByLabelText('Новая задача', { exact: true }),
  ).not.toHaveFocus();
});
it('Alt+D opens keyboard-accessible presets; invalid Today stays blocked across reopening and a valid parent preset recovers', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T09:00:00Z'));
  const create = vi.fn(async () => true);
  render(
    <Editor
      create={create}
      parentPlan={{
        inputStart: '2026-10-08',
        inputFinish: '2026-10-09',
        durationDays: 2,
      }}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Новая задача'), 'Черновик');
  await user.keyboard('{Alt>}d{/Alt}');
  expect(screen.getByLabelText('Начало')).toHaveFocus();
  await user.tab();
  expect(screen.getByLabelText('Календарь: Начало')).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Сегодня: Начало' }));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Добавить задачу' }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  expect(
    screen.getByRole('button', { name: 'Добавить задачу' }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /^Как у родителя/ }));
  expect(screen.getByRole('button', { name: 'Добавить задачу' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Готово' }));
  expect(
    screen.getByRole('button', { name: 'Сроки новой задачи' }),
  ).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  expect(create).toHaveBeenLastCalledWith(
    'Черновик',
    { parentId: null },
    { inputStart: '2026-10-08', inputFinish: '2026-10-09', durationDays: 2 },
    [],
  );
});
it('Today uses project timezone and linked fields locally; failed create keeps the draft', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T22:30:00Z'));
  const create = vi.fn(async () => false);
  render(<Editor create={create} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Новая задача'), 'Работа');
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  await user.click(screen.getByRole('button', { name: 'Сегодня: Начало' }));
  expect(screen.getByLabelText('Начало')).toHaveValue('09.10.2026');
  expect(screen.getByLabelText('Окончание')).toHaveValue('09.10.2026');
  expect(create).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  expect(create).toHaveBeenCalledWith(
    'Работа',
    { parentId: null },
    { inputStart: '2026-10-09', inputFinish: '2026-10-09', durationDays: 1 },
    [],
  );
  expect(screen.getByLabelText('Начало')).toHaveValue('09.10.2026');
  expect(screen.getByLabelText('Новая задача')).toHaveValue('Работа');
});
it('does not normalize weekend Today and blocks invalid submission', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T09:00:00Z'));
  const create = vi.fn(async () => true);
  render(<Editor create={create} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Новая задача'), 'Работа');
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  await user.click(screen.getByRole('button', { name: 'Сегодня: Начало' }));
  expect(screen.getByLabelText('Начало')).toHaveValue('10.10.2026');
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Добавить задачу' }),
  ).toBeDisabled();
  fireEvent.submit(screen.getByLabelText('Новая задача').closest('form')!);
  expect(create).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  expect(
    screen.getByRole('button', { name: 'Добавить задачу' }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  await user.click(
    screen.getByRole('button', { name: 'Очистить быстрый ввод' }),
  );
  await user.type(screen.getByLabelText('Новая задача'), 'Новая работа');
  expect(screen.getByRole('button', { name: 'Добавить задачу' })).toBeEnabled();
});

it('keeps predecessor IDs after rejection and inner Enter/Escape do not submit or clear the form', async () => {
  const create = vi.fn(async () => false);
  render(<Editor create={create} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Новая задача'), 'B');
  await user.keyboard('{Alt>}l{/Alt}');
  await user.type(screen.getByRole('searchbox'), 'A');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(create).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Убрать предшественника: A' }),
  ).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(
    screen.getByRole('button', { name: 'После окончания новой задачи' }),
  ).toHaveFocus();
  expect(screen.getByLabelText('Новая задача')).toHaveValue('B');
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  expect(create).toHaveBeenCalledExactlyOnceWith(
    'B',
    { parentId: null },
    { inputStart: null, inputFinish: null, durationDays: 1 },
    [task(1).id],
  );
  await user.click(
    screen.getByRole('button', { name: 'После окончания новой задачи' }),
  );
  expect(
    screen.getByRole('button', { name: 'Убрать предшественника: A' }),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Закрыть выбор предшественников' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Очистить быстрый ввод' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'После окончания новой задачи' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Убрать предшественника: A' }),
  ).not.toBeInTheDocument();
});

it('explicit QuickSchedule reset clears an unfinished duration buffer without changing clear semantics', async () => {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  const duration = screen.getByLabelText('Длительность, рабочих дней');
  await user.clear(duration);
  await user.type(duration, '-');
  await user.tab();
  expect(duration).toHaveValue('-');
  expect(duration).toHaveAttribute('aria-invalid', 'true');
  await user.click(screen.getByRole('button', { name: 'Сбросить' }));
  expect(duration).toHaveValue('');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps unfinished lexical duration through Escape/reopen, repairs the same numeric source, and clears it on explicit draft reset', async () => {
  const create = vi.fn(async () => true),
    user = userEvent.setup();
  render(<Editor create={create} />);
  await user.type(screen.getByLabelText('Новая задача'), 'Работа');
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  const duration = screen.getByLabelText('Длительность, рабочих дней');
  await user.clear(duration);
  await user.type(duration, '1e');
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  expect(screen.getByLabelText('Длительность, рабочих дней')).toBe(duration);
  expect(duration).toHaveValue('1e');
  expect(duration).toHaveAttribute('aria-invalid', 'true');
  expect(
    screen.getByRole('button', { name: 'Добавить задачу' }),
  ).toBeDisabled();
  expect(create).not.toHaveBeenCalled();
  await user.clear(duration);
  await user.type(duration, '1');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Добавить задачу' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  expect(create).toHaveBeenCalledWith(
    'Работа',
    { parentId: null },
    { inputStart: null, inputFinish: null, durationDays: 1 },
    [],
  );
  await user.click(duration);
  await user.clear(duration);
  await user.type(duration, '1e');
  await user.click(
    screen.getByRole('button', { name: 'Очистить быстрый ввод' }),
  );
  expect(screen.getByRole('dialog', { name: 'Сроки задачи' })).toBeVisible();
  expect(duration).toHaveValue('1');
  expect(duration).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('a late creation acknowledgement preserves newer invalid raw even when the parsed source stayed identical', async () => {
  let resolve!: (saved: boolean) => void;
  const create = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    ),
    user = userEvent.setup();
  render(<Editor create={create} />);
  await user.type(screen.getByLabelText('Новая задача'), 'Работа');
  await user.click(screen.getByRole('button', { name: 'Сроки новой задачи' }));
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  const duration = screen.getByLabelText('Длительность, рабочих дней');
  await user.click(duration);
  fireEvent.change(duration, { target: { value: '1e' } });
  await act(async () => resolve(true));
  expect(duration).toHaveValue('1e');
  expect(duration).toHaveAttribute('aria-invalid', 'true');
  expect(
    screen.getByRole('button', { name: 'Добавить задачу' }),
  ).toBeDisabled();
});

it('K01 plus focuses without replacing or submitting the draft', async () => {
  const create = vi.fn(async () => true),
    user = userEvent.setup();
  render(<Editor create={create} />);
  const input = screen.getByLabelText('Новая задача', { exact: true });
  await user.type(input, 'Черновик');
  const plus = screen.getByRole('button', { name: 'Перейти к вводу задачи' });
  expect(plus).toHaveAttribute('type', 'button');
  await user.click(plus);
  expect(input).toHaveFocus();
  plus.focus();
  await user.keyboard('{Enter}');
  expect(input).toHaveFocus();
  plus.focus();
  await user.keyboard(' ');
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Черновик');
  expect(create).not.toHaveBeenCalled();
});
it('K07 cancels composition Enter and submits the next separate Enter', async () => {
  const create = vi.fn(async () => true);
  render(<Editor create={create} />);
  const input = screen.getByLabelText('Новая задача');
  fireEvent.change(input, { target: { value: 'Составленный текст' } });
  fireEvent.compositionStart(input);
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(
    false,
  );
  fireEvent.submit(input.closest('form')!);
  expect(create).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  input.focus();
  await userEvent.keyboard('{Enter}');
  expect(create).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  'K06 external focus permanently cancels late restore (blur: %s)',
  async (blur) => {
    let resolve!: (value: boolean) => void;
    const create = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    render(
      <>
        <Editor create={create} />
        <button>Вне ввода</button>
      </>,
    );
    const input = screen.getByLabelText('Новая задача'),
      user = userEvent.setup();
    await user.type(input, 'Работа');
    await user.keyboard('{Enter}');
    const outside = screen.getByRole('button', { name: 'Вне ввода' });
    outside.focus();
    if (blur) outside.blur();
    await act(async () => resolve(true));
    expect(document.activeElement).toBe(blur ? document.body : outside);
  },
);

function FocusEditor({
  create,
  busy = false,
  blocked = false,
  active = true,
  acknowledgement = 0,
  parentId = task(1).id,
  hidden = false,
  inputId = 'quick-task',
  submitBlockedReason,
}: {
  create: () => Promise<boolean>;
  busy?: boolean;
  blocked?: boolean;
  active?: boolean;
  acknowledgement?: number;
  parentId?: string;
  hidden?: boolean;
  inputId?: string;
  submitBlockedReason?: string | undefined;
}) {
  const [title, onTitle] = useState('Черновик'),
    [plan, onPlan] = useState<SourceFields>({
      inputStart: '2026-10-05',
      inputFinish: null,
      durationDays: 3,
    }),
    [predecessorIds, onPredecessors] = useState([task(3).id]);
  return (
    <>
      <div hidden={hidden}>
        <QuickAdd
          inputId={inputId}
          {...(submitBlockedReason ? { submitBlockedReason } : {})}
          active={active}
          acknowledgement={acknowledgement}
          tree={optionalTreeFixture()}
          tasks={[task(1), task(2)]}
          context={{ parentId, afterId: task(2).id }}
          onContext={vi.fn()}
          title={title}
          onTitle={onTitle}
          plan={plan}
          onPlan={onPlan}
          predecessorIds={predecessorIds}
          onPredecessors={onPredecessors}
          calendar="weekdays"
          timezone="Europe/Moscow"
          busy={busy}
          blocked={blocked}
          onCreate={create}
        />
      </div>
      <button>Вне ввода</button>
    </>
  );
}
it.each([
  'outside',
  'body',
  'context',
  'inactive',
  'hidden',
  'unmount',
  'stay',
] as const)('K06 controlled pending restoration: %s', async (mode) => {
  let resolve!: (value: boolean) => void;
  const create = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    ),
    user = userEvent.setup();
  const view = render(<FocusEditor create={create} />),
    input = screen.getByLabelText('Новая задача');
  input.focus();
  await user.keyboard('{Enter}');
  input.blur();
  view.rerender(<FocusEditor create={create} busy />);
  if (mode === 'outside' || mode === 'body') {
    const outside = screen.getByRole('button', { name: 'Вне ввода' });
    outside.focus();
    if (mode === 'body') outside.blur();
  } else input.blur();
  if (mode === 'context')
    view.rerender(<FocusEditor create={create} busy parentId={task(2).id} />);
  if (mode === 'inactive')
    view.rerender(<FocusEditor create={create} busy active={false} />);
  if (mode === 'hidden')
    view.rerender(<FocusEditor create={create} busy hidden />);
  if (mode === 'unmount') view.unmount();
  await act(async () => resolve(true));
  if (mode !== 'unmount')
    view.rerender(
      <FocusEditor
        create={create}
        acknowledgement={1}
        parentId={mode === 'context' ? task(2).id : task(1).id}
        active={mode !== 'inactive'}
        hidden={mode === 'hidden'}
      />,
    );
  if (mode === 'stay') expect(input).toHaveFocus();
  else expect(input).not.toHaveFocus();
});
it('K01 controlled plus preserves all source fields and respects busy/blocked', async () => {
  const create = vi.fn(async () => true),
    user = userEvent.setup(),
    view = render(<FocusEditor create={create} />);
  const plus = screen.getByRole('button', { name: 'Перейти к вводу задачи' });
  await user.click(plus);
  await user.keyboard('{Enter}');
  expect(create).toHaveBeenCalledWith(
    'Черновик',
    { parentId: task(1).id, afterId: task(2).id },
    { inputStart: '2026-10-05', inputFinish: null, durationDays: 3 },
    [task(3).id],
  );
  view.rerender(<FocusEditor create={create} busy />);
  expect(plus).toBeDisabled();
  view.rerender(<FocusEditor create={create} blocked />);
  expect(plus).toBeDisabled();
});
it('K02 non-inline Escape hides the visible hint while keeping title', async () => {
  render(<Editor />);
  const user = userEvent.setup(),
    input = screen.getByLabelText('Новая задача');
  await user.type(input, 'Черновик');
  expect(screen.getByText(/Enter — добавить/)).toBeVisible();
  await user.keyboard('{Escape}');
  expect(input).toHaveValue('Черновик');
  expect(screen.queryByText(/Enter — добавить/)).toBeNull();
  input.blur();
  await user.click(input);
  expect(screen.getByText(/Esc — выйти/)).toBeVisible();
});

it('K01 independent editors focus only their title while submit reason stays enforced', async () => {
  const create = vi.fn(async () => true),
    user = userEvent.setup();
  render(
    <>
      <FocusEditor create={create} inputId="quick-task" />
      <FocusEditor
        create={create}
        inputId="quick-subtask"
        submitBlockedReason="Сначала сохранить"
      />
    </>,
  );
  const inputs = screen.getAllByLabelText('Новая задача'),
    buttons = screen.getAllByRole('button', { name: 'Перейти к вводу задачи' });
  await user.click(buttons[1]!);
  expect(inputs[1]).toHaveFocus();
  expect(inputs[0]).toHaveValue('Черновик');
  await user.keyboard('{Enter}');
  expect(create).not.toHaveBeenCalled();
  buttons[0]!.focus();
  await user.keyboard(' ');
  expect(inputs[0]).toHaveFocus();
});
