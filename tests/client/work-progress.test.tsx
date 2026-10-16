// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App.js';
import { api } from '../../src/client/api.js';
import { project } from './fixtures.js';
import { mockJournalApp } from './journal-fixtures.js';

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openComposer() {
  mockJournalApp();
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(
    screen.getAllByRole('treeitem', { name: /^Работа 1,/ })[0]!,
  );
  const panel = screen.getByRole('complementary', { name: 'Задача' });
  await userEvent.click(within(panel).getByRole('tab', { name: 'Ход работы' }));
  const body = await within(panel).findByLabelText('Текст записи');
  await waitFor(() => expect(body).toBeEnabled());
  return {
    panel,
    body,
    date: within(panel).getByLabelText('Дата записи', { exact: true }),
  };
}

it('names the task tab Ход работы, retains project Журнал and starts with two rows', async () => {
  const { panel, body } = await openComposer();
  expect(within(panel).getByRole('tab', { name: 'Ход работы' })).toBeVisible();
  expect(body).toHaveAttribute('rows', '2');
  expect(screen.getByRole('tab', { name: 'Журнал' })).toBeVisible();
  expect(
    within(panel).queryByRole('button', { name: 'Сохранить запись' }),
  ).toBeNull();
});

it('preserves composer height while hidden and synchronously remeasures its changed metrics on reveal', async () => {
  let measuredHeight = 200;
  const observers = new Map<Element, () => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe(node: Element) {
        observers.set(node, this.callback);
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.closest('[hidden]') ? 0 : measuredHeight;
    },
  );
  const { panel, body } = await openComposer();
  const journal = body.closest<HTMLElement>('.task-journal')!;
  const initial = body.style.height;
  expect(parseFloat(initial)).toBeGreaterThanOrEqual(200);
  journal.hidden = true;
  act(() => observers.get(body.parentElement!)!());
  expect(body.style.height).toBe(initial);
  journal.hidden = false;
  await userEvent.click(
    within(panel).getByRole('tab', { name: 'Задача' }),
  );
  measuredHeight = 300;
  await userEvent.click(
    within(panel).getByRole('tab', { name: 'Ход работы' }),
  );
  expect(parseFloat(body.style.height)).toBe(parseFloat(initial) + 100);
});

it('Enter adds a newline and Ctrl+Enter sends the exact original body and date once', async () => {
  const { panel, body, date } = await openComposer();
  fireEvent.change(date, { target: { value: '29.02.2024' } });
  const original = '  Первая строка\n\n  Вторая строка\n';
  fireEvent.change(body, { target: { value: original.slice(0, -1) } });
  await userEvent.click(body);
  await userEvent.keyboard('{End}{Enter}');
  expect(body).toHaveValue(original);
  expect(api.journalCreate).not.toHaveBeenCalled();
  const save = within(panel).getByRole('button', { name: 'Сохранить запись' });
  expect(save).toHaveAttribute('title', 'Сохранить запись');
  expect(save.querySelector('svg')).toBeInTheDocument();
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledTimes(1));
  expect(api.journalCreate).toHaveBeenCalledWith(
    project.id,
    expect.objectContaining({ body: original, workDate: '2024-02-29' }),
  );
});

it('does not submit during IME composition and supports Cmd+Enter afterwards', async () => {
  const { body, date } = await openComposer();
  fireEvent.change(date, { target: { value: '29.02.2024' } });
  fireEvent.change(body, { target: { value: 'Составляемая запись' } });
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(api.journalCreate).not.toHaveBeenCalled();
  fireEvent.keyDown(body, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledTimes(1));
});

it('keeps invalid dates and over-limit text visible without losing or sending the draft', async () => {
  const { panel, body, date } = await openComposer();
  const original = '  Не потерять\n\n  исходный текст  ';
  fireEvent.change(body, { target: { value: original } });
  fireEvent.change(date, { target: { value: '31.02.2024' } });
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  expect(api.journalCreate).not.toHaveBeenCalled();
  expect(body).toHaveValue(original);
  expect(date).toHaveValue('31.02.2024');
  expect(date).toHaveAttribute('aria-invalid', 'true');
  expect(
    within(panel).getByText(/Нужны дата и непустой текст/),
  ).not.toHaveClass('sr-only');
  fireEvent.change(date, { target: { value: '29.02.2024' } });
  fireEvent.change(body, { target: { value: 'я'.repeat(10001) } });
  expect(within(panel).getByText(/10001\/10000/)).not.toHaveClass('sr-only');
  expect(
    within(panel).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeDisabled();
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  expect(api.journalCreate).not.toHaveBeenCalled();
  expect(body).toHaveValue('я'.repeat(10001));
});
