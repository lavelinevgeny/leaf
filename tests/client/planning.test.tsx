// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanFields } from '../../src/client/PlanFields.js';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { sourceOf } from '../../src/client/planning-view.js';
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
