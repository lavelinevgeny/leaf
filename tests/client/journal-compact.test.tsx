// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
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
import { task } from './fixtures.js';
import { mockJournalApp } from './journal-fixtures.js';

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('U05 row menu "Открыть задачу" opens the task exactly like a row click', async () => {
  mockJournalApp();
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Действия задачи: Работа 1' })[0]!,
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  expect(screen.queryByRole('menu')).toBeNull();
  const panel = await screen.findByRole('complementary', { name: 'Задача' });
  await waitFor(() =>
    expect(panel).toContainElement(document.activeElement as HTMLElement),
  );
  const trigger = () =>
    screen.getAllByRole('button', { name: 'Действия задачи: Работа 1' })[0]!;
  await userEvent.click(trigger());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  expect(trigger()).toHaveFocus();
  await userEvent.click(document.getElementById('tab-journal')!);
  await userEvent.click(trigger());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  await waitFor(() =>
    expect(within(panel).getByLabelText('Название задачи')).toHaveFocus(),
  );
});

it('U05 after keyboard tab switching, re-selecting "Открыть задачу" leaves focus on the trigger', async () => {
  mockJournalApp();
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  const trigger = () =>
    screen.getAllByRole('button', { name: 'Действия задачи: Работа 1' })[0]!;
  await userEvent.click(trigger());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  const panel = await screen.findByRole('complementary', { name: 'Задача' });
  await waitFor(() =>
    expect(panel).toContainElement(document.activeElement as HTMLElement),
  );
  document.getElementById('tab-details')!.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(document.getElementById('tab-details')).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await userEvent.click(trigger());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  expect(trigger()).toHaveFocus();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(trigger()).toHaveFocus();
});

it('U05 refused row actions keep focus on the trigger', async () => {
  const server = mockJournalApp();
  server.tree.tasks.push(task(2));
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  const trigger = (title: string) =>
    screen.getAllByRole('button', { name: `Действия задачи: ${title}` })[0]!;
  await userEvent.click(trigger('Работа 1'));
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Открыть задачу' }),
  );
  const panel = await screen.findByRole('complementary', { name: 'Задача' });
  fireEvent.change(within(panel).getByLabelText('Название задачи'), {
    target: { value: 'Несохранённое название' },
  });
  for (const item of ['Открыть задачу', 'Добавить запись']) {
    await userEvent.click(trigger('Работа 2'));
    expect(
      screen.getByRole('menuitem', { name: 'Добавить подзадачу' }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole('menuitem', { name: item }));
    expect(trigger('Работа 2')).toHaveFocus();
    expect(within(panel).getByLabelText('Название задачи')).toHaveValue(
      'Несохранённое название',
    );
    expect(
      screen.getByText(
        'Сначала сохраните или отбросьте несохранённые изменения.',
      ),
    ).toBeInTheDocument();
  }
});
