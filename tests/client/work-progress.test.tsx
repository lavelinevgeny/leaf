// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { projectJournalContent } from '../../src/shared/journal-content.js';
import {
  changeJournalField,
  expectJournalFieldValue,
} from './journal-editor-helpers.js';
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
  await waitFor(() => expect(body).toHaveAttribute('contenteditable', 'true'));
  return {
    panel,
    body,
    date: within(panel).getByLabelText('Дата записи', { exact: true }),
  };
}

it('names the task tab Ход работы, retains project Журнал and starts with two rows', async () => {
  const { panel, body } = await openComposer();
  expect(within(panel).getByRole('tab', { name: 'Ход работы' })).toBeVisible();
  expect(body).toHaveAttribute('contenteditable', 'true');
  expect(body).toHaveAttribute('aria-multiline', 'true');
  expect(body).toHaveTextContent('');
  expect(screen.getByRole('tab', { name: 'Журнал' })).toBeVisible();
  expect(
    within(panel).queryByRole('button', { name: 'Сохранить запись' }),
  ).toBeNull();
});

it('collapses project journal previews independently and preserves the original text on refresh', async () => {
  const server = mockJournalApp();
  const original = '\n\nСинтетический абзац A\n  \n\t\nАбзац B\n\n';
  server.entries[0]!.body = original;
  server.entries[0]!.content = { format: 'plain-text', text: original };
  server.entries.push({
    ...server.entries[0]!,
    id: '66666666-6666-4666-8666-666666666666',
    body: '\nДругая синтетическая запись\n\n',
    content: {
      format: 'plain-text',
      text: '\nДругая синтетическая запись\n\n',
    },
  });
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  const feed = document.querySelector<HTMLElement>('#project-view-journal')!;
  await waitFor(() =>
    expect(feed.querySelector('.journal-body')?.textContent).toBe(
      'Синтетический абзац A\n\nАбзац B',
    ),
  );
  const toggles = within(feed).getAllByRole('button', {
    name: 'Показать полностью',
  });
  expect(toggles).toHaveLength(2);
  await userEvent.click(toggles[0]!);
  expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
  expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
  expect(feed.querySelector('.journal-body')?.textContent).toBe(original);
  const reads = vi.mocked(api.journalProject).mock.calls.length;
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() =>
    expect(vi.mocked(api.journalProject).mock.calls.length).toBeGreaterThan(
      reads,
    ),
  );
  await waitFor(() =>
    expect(
      within(feed).getByRole('button', { name: 'Свернуть' }),
    ).toBeEnabled(),
  );
  expect(feed.querySelector('.journal-body')?.textContent).toBe(original);
  await userEvent.click(within(feed).getByRole('button', { name: 'Свернуть' }));
  expect(feed.querySelector('.journal-body')?.textContent).toBe(
    'Синтетический абзац A\n\nАбзац B',
  );
  expect(api.journalUpdate).not.toHaveBeenCalled();
  expect(api.command).not.toHaveBeenCalled();
});

it('keeps the same intrinsic contenteditable and content across hidden panel tabs', async () => {
  const { panel, body } = await openComposer();
  changeJournalField(body, {
    target: { value: 'Синтетический текст\n'.repeat(12) },
  });
  expect(body.style.height).toBe('');
  await userEvent.click(within(panel).getByRole('tab', { name: 'Задача' }));
  expect(body.closest('[hidden]')).not.toBeNull();
  await userEvent.click(within(panel).getByRole('tab', { name: 'Ход работы' }));
  expect(within(panel).getByLabelText('Текст записи')).toBe(body);
  expectJournalFieldValue(body, 'Синтетический текст\n'.repeat(12));
  expect(body.style.height).toBe('');
});

it('Enter adds a newline and Ctrl+Enter sends the exact original body and date once', async () => {
  const { panel, body, date } = await openComposer();
  changeJournalField(date, { target: { value: '29.02.2024' } });
  const original = '  Первая строка\n\n  Вторая строка\n';
  changeJournalField(body, { target: { value: original.slice(0, -1) } });
  const rich = (body as HTMLElement & { editor: Editor }).editor;
  act(() => {
    rich.commands.setTextSelection(rich.state.doc.content.size - 1);
  });
  fireEvent.keyDown(body, { key: 'Enter', code: 'Enter' });
  expectJournalFieldValue(body, original);
  expect(api.journalCreate).not.toHaveBeenCalled();
  const save = within(panel).getByRole('button', { name: 'Сохранить запись' });
  expect(save).toHaveAttribute('title', 'Сохранить запись');
  expect(save.querySelector('svg')).toBeInTheDocument();
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledTimes(1));
  expect(api.journalCreate).toHaveBeenCalledWith(
    project.id,
    expect.objectContaining({
      content: expect.objectContaining({ format: 'rich-text' }),
      workDate: '2024-02-29',
    }),
  );
  const content = vi.mocked(api.journalCreate).mock.calls[0]![1].content;
  expect(projectJournalContent(content, [])).toBe(original);
});

it('does not submit during IME composition and supports Cmd+Enter afterwards', async () => {
  const { body, date } = await openComposer();
  changeJournalField(date, { target: { value: '29.02.2024' } });
  changeJournalField(body, { target: { value: 'Составляемая запись' } });
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(api.journalCreate).not.toHaveBeenCalled();
  fireEvent.keyDown(body, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledTimes(1));
});

it('keeps invalid dates and over-limit text visible without losing or sending the draft', async () => {
  const { panel, body, date } = await openComposer();
  const original = '  Не потерять\n\n  исходный текст  ';
  changeJournalField(body, { target: { value: original } });
  changeJournalField(date, { target: { value: '31.02.2024' } });
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  expect(api.journalCreate).not.toHaveBeenCalled();
  expectJournalFieldValue(body, original);
  expectJournalFieldValue(date, '31.02.2024');
  expect(date).toHaveAttribute('aria-invalid', 'true');
  expect(
    within(panel).getByText(/Нужны дата и непустой текст/),
  ).not.toHaveClass('sr-only');
  changeJournalField(date, { target: { value: '29.02.2024' } });
  changeJournalField(body, { target: { value: 'я'.repeat(10001) } });
  expect(within(panel).getByText(/10001\/10000/)).not.toHaveClass('sr-only');
  expect(
    within(panel).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeDisabled();
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  expect(api.journalCreate).not.toHaveBeenCalled();
  expectJournalFieldValue(body, 'я'.repeat(10001));
});
