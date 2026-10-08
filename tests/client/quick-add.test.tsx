// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { QuickAdd, type AddContext } from '../../src/client/QuickAdd.js';
import type { SourceFields } from '../../src/shared/contracts.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function Editor({
  create = vi.fn(async () => true),
  parentPlan = null,
}: {
  create?: (
    title: string,
    context: AddContext,
    plan: SourceFields,
  ) => Promise<boolean>;
  parentPlan?: SourceFields | null;
}) {
  const [title, setTitle] = useState('');
  const [plan, setPlan] = useState<SourceFields>({
    inputStart: null,
    inputFinish: null,
    durationDays: 1,
  });
  return (
    <QuickAdd
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
  expect(screen.getByLabelText('Длительность, рабочих дней')).toHaveValue(1);
  expect(screen.getByLabelText('Начало')).toHaveValue('');
  expect(screen.getByLabelText('Окончание')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  expect(create).toHaveBeenLastCalledWith(
    'Работа',
    { parentId: null },
    { inputStart: null, inputFinish: null, durationDays: 1 },
  );
  await user.clear(screen.getByLabelText('Длительность, рабочих дней'));
  await user.tab();
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }));
  expect(create).toHaveBeenLastCalledWith(
    'Работа',
    { parentId: null },
    { inputStart: null, inputFinish: null, durationDays: null },
  );
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
