// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanFields } from '../../src/client/PlanFields.js';
import { sourceOf } from '../../src/client/planning-view.js';
import { task } from './fixtures.js';
afterEach(cleanup);
it('edits three independent optional source fields, clearing duration to null', () => {
  const a = task(1, { inputStart: '2026-10-09', durationDays: 2 });
  const onChange = vi.fn();
  render(
    <PlanFields
      task={a}
      plan={sourceOf(a)}
      calendar="weekdays"
      summary={false}
      disabled={false}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByLabelText('Окончание'), {
    target: { value: '2026-10-12' },
  });
  expect(onChange).toHaveBeenLastCalledWith({
    inputStart: '2026-10-09',
    inputFinish: '2026-10-12',
    durationDays: 2,
  });
  fireEvent.change(screen.getByLabelText('Длительность, рабочих дней'), {
    target: { value: '' },
  });
  expect(onChange).toHaveBeenLastCalledWith({
    inputStart: '2026-10-09',
    inputFinish: null,
    durationDays: null,
  });
  expect(screen.queryByLabelText('Режим планирования')).toBeNull();
  expect(screen.queryByLabelText('Дедлайн')).toBeNull();
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
