// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanFields } from '../../src/client/PlanFields.js';
import { planOf } from '../../src/client/planning-view.js';
import { computed, task } from './fixtures.js';
afterEach(cleanup);
describe('explicit planning fields', () => {
  it('keeps a single input start as the Auto notBefore constraint on an explicit mode change', () => {
    const a = task(1, { inputStart: '2026-10-09' });
    const onChange = vi.fn();
    render(
      <PlanFields
        task={a}
        plan={planOf(a)}
        calendar="weekdays"
        summary={false}
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Режим планирования'), {
      target: { value: 'auto' },
    });
    expect(onChange).toHaveBeenCalledWith({
      mode: 'auto',
      durationDays: 0,
      notBefore: '2026-10-09',
      deadline: null,
    });
  });
  it('keeps Auto computed dates distinct and converts edited finish into working duration', () => {
    const a = task(1, { planMode: 'auto', durationDays: 2 });
    const onChange = vi.fn();
    render(
      <PlanFields
        task={a}
        plan={planOf(a)}
        computed={computed()}
        calendar="weekdays"
        summary={false}
        disabled={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('2026-10-09')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Рассчитанное окончание'), {
      target: { value: '2026-10-13' },
    });
    expect(onChange).toHaveBeenCalledWith({
      mode: 'auto',
      durationDays: 3,
      notBefore: null,
      deadline: null,
    });
    fireEvent.change(screen.getByLabelText('Рассчитанное окончание'), {
      target: { value: '2026-10-10' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/рабоч/);
  });
  it('switches Auto to Fixed using the current computed interval only on explicit selection', () => {
    const a = task(1, { planMode: 'auto', durationDays: 2 });
    const onChange = vi.fn();
    render(
      <PlanFields
        task={a}
        plan={planOf(a)}
        computed={computed()}
        calendar="weekdays"
        summary={false}
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Режим планирования'), {
      target: { value: 'fixed' },
    });
    expect(onChange).toHaveBeenCalledWith({
      mode: 'fixed',
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
      deadline: null,
    });
  });
  it('retains one-date notes and offers explicit Fixed for a pair', () => {
    const a = task(1, { inputStart: '2026-10-09', inputFinish: '2026-10-12' });
    const onChange = vi.fn();
    render(
      <PlanFields
        task={a}
        plan={planOf(a)}
        calendar="weekdays"
        summary={false}
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Закрепить интервал' }));
    expect(onChange).toHaveBeenCalledWith({
      mode: 'fixed',
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
      deadline: null,
    });
  });
  it('locks summary and completed work and explains the explicit return to work', () => {
    const a = task(1, { planMode: 'auto', durationDays: 2, status: 'done' });
    const view = render(
      <PlanFields
        task={a}
        plan={planOf(a)}
        computed={computed()}
        calendar="weekdays"
        summary={false}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Режим планирования')).toBeDisabled();
    expect(screen.getByText(/Верните завершённую/)).toBeInTheDocument();
    view.rerender(
      <PlanFields
        task={a}
        plan={planOf(a)}
        calendar="weekdays"
        summary
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByLabelText('Режим планирования'),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Сводная задача/)).toBeInTheDocument();
  });
});
