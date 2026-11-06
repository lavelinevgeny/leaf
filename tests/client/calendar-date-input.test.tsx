// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import userEvent from '@testing-library/user-event';
import {
  CalendarDateInput,
  type CalendarDateInputHandle,
} from '../../src/client/CalendarDateInput.js';
afterEach(cleanup);
function Input({
  referenceToday,
  today,
  change = () => {},
  commit = () => {},
}: {
  referenceToday?: string;
  today?: string;
  change?: (value: string | null) => void;
  commit?: (value: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const ref = useRef<CalendarDateInputHandle>(null);
  return (
    <>
      <CalendarDateInput
        ref={ref}
        label="Начало"
        value={value}
        {...(referenceToday ? { referenceToday } : {})}
        {...(today ? { today } : {})}
        descriptionId="external"
        onChange={(value) => {
          setValue(value);
          change(value);
        }}
        onCommit={commit}
      />
      <span id="external">Описание</span>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => ref.current?.commit()}
      >
        Commit
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => ref.current?.reset()}
      >
        Reset
      </button>
    </>
  );
}
it('freezes the reference year through an edit and refreshes after Enter', async () => {
  const user = userEvent.setup();
  const view = render(<Input referenceToday="2026-12-31" />);
  const input = screen.getByLabelText('Начало');
  await user.click(input);
  fireEvent.change(input, { target: { value: '7.11' } });
  view.rerender(<Input referenceToday="2027-01-01" />);
  expect(input).toHaveValue('7.11');
  expect(screen.getByText('Без года — 2026')).toBeVisible();
  await user.keyboard('{Enter}');
  expect(input).toHaveValue('07.11.2026');
  await user.click(input);
  expect(screen.getByText('Без года — 2027')).toBeVisible();
  expect(input).toHaveAccessibleDescription('Описание Без года — 2027');
});
it('explicit focused commit normalizes and starts a fresh period; reset refreshes too', async () => {
  const user = userEvent.setup();
  const view = render(<Input referenceToday="2026-12-31" />);
  const input = screen.getByLabelText('Начало');
  await user.click(input);
  fireEvent.change(input, { target: { value: '7.11' } });
  view.rerender(<Input referenceToday="2027-01-01" />);
  await user.click(screen.getByText('Commit'));
  expect(input).toHaveValue('07.11.2026');
  fireEvent.change(input, { target: { value: '8.11' } });
  expect(screen.getByText('Без года — 2027')).toBeVisible();
  await user.click(screen.getByText('Reset'));
  fireEvent.change(input, { target: { value: '9.11' } });
  await user.click(screen.getByText('Commit'));
  expect(input).toHaveValue('09.11.2027');
});
it('keeps invalid raw bytes across blur/refocus and supports correction and clearing', async () => {
  const user = userEvent.setup();
  render(<Input referenceToday="2026-11-06" />);
  const input = screen.getByLabelText('Начало');
  await user.click(input);
  fireEvent.change(input, { target: { value: ' 31.2 ' } });
  await user.tab();
  expect(input).toHaveValue(' 31.2 ');
  await user.click(input);
  expect(input).toHaveValue(' 31.2 ');
  fireEvent.change(input, { target: { value: '7.11' } });
  await user.tab();
  expect(input).toHaveValue('07.11.2026');
  await user.click(input);
  fireEvent.change(input, { target: { value: '  ' } });
  await user.tab();
  expect(input).toHaveValue('');
});
it('reference changes and focus without edits do not invoke callbacks', async () => {
  const user = userEvent.setup();
  const change = vi.fn(),
    commit = vi.fn();
  const view = render(
    <Input referenceToday="2026-12-31" change={change} commit={commit} />,
  );
  await user.click(screen.getByLabelText('Начало'));
  view.rerender(
    <Input referenceToday="2027-01-01" change={change} commit={commit} />,
  );
  await user.tab();
  expect(change).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
it('today alone preserves legacy parsing and picker/Today each commit once', async () => {
  const user = userEvent.setup(),
    commit = vi.fn();
  render(<Input today="2026-11-06" commit={commit} />);
  const input = screen.getByLabelText('Начало');
  await user.click(input);
  await user.type(input, '7.11');
  await user.tab();
  expect(input).toHaveValue('7.11');
  expect(screen.queryByText(/Без года/)).not.toBeInTheDocument();
  commit.mockClear();
  fireEvent.change(screen.getByLabelText('Календарь: Начало'), {
    target: { value: '2026-11-08' },
  });
  expect(commit).toHaveBeenCalledExactlyOnceWith('2026-11-08');
  commit.mockClear();
  await user.click(screen.getByRole('button', { name: 'Сегодня: Начало' }));
  expect(commit).toHaveBeenCalledExactlyOnceWith('2026-11-06');
});
