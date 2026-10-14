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
import { periodLabel } from '../../src/client/ProjectJournal.js';
import { task } from './fixtures.js';
import {
  deferred,
  journal5,
  mockJournalApp,
  page5,
} from './journal-fixtures.js';
import type { JournalPage } from '../../src/shared/journal-contracts.js';

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

it('Q01 refused row quick actions keep focus on the action button', async () => {
  const server = mockJournalApp();
  server.tree.tasks.push(task(2));
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  const button = (name: string) => screen.getAllByRole('button', { name })[0]!;
  await userEvent.click(
    screen.getAllByRole('treeitem', { name: /^Работа 1,/ })[0]!,
  );
  const panel = await screen.findByRole('complementary', { name: 'Задача' });
  fireEvent.change(within(panel).getByLabelText('Название задачи'), {
    target: { value: 'Несохранённое название' },
  });
  expect(button('Добавить подзадачу: Работа 2')).toBeDisabled();
  await userEvent.click(button('Добавить запись: Работа 2'));
  expect(button('Добавить запись: Работа 2')).toHaveFocus();
  expect(within(panel).getByLabelText('Название задачи')).toHaveValue(
    'Несохранённое название',
  );
  expect(
    screen.getByText(
      'Сначала сохраните или отбросьте несохранённые изменения.',
    ),
  ).toBeInTheDocument();
});

async function openProjectJournal() {
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  await screen.findByText('Original synthetic text');
}

it('U05 entry menu moves focus into the editor or the safe delete choice', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const feed = document.querySelector<HTMLElement>(
    '[data-journal-feed="project"]',
  )!;
  const menu = () =>
    within(feed).getByRole('button', { name: 'Действия записи 2024-02-29' });
  await userEvent.click(menu());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Редактировать запись' }),
  );
  await waitFor(() =>
    expect(within(feed).getByLabelText('Текст записи')).toHaveFocus(),
  );
  await userEvent.click(
    within(feed).getByRole('button', { name: 'Закрыть редактор' }),
  );
  await userEvent.click(menu());
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Удалить запись' }),
  );
  await waitFor(() =>
    expect(
      within(feed).getByRole('button', { name: 'Отмена удаления' }),
    ).toHaveFocus(),
  );
});

it('U05 a refresh that disables an open entry menu keeps keyboard focus in the feed', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const feed = document.querySelector<HTMLElement>(
    '[data-journal-feed="project"]',
  )!;
  const menu = within(feed).getByRole('button', {
    name: 'Действия записи 2024-02-29',
  });
  menu.focus();
  await userEvent.keyboard('{Enter}');
  expect(
    await screen.findByRole('menuitem', { name: 'Редактировать запись' }),
  ).toHaveFocus();
  // Window refocus refreshes the journal; while the page is loading the feed is
  // not coherent, so the entry trigger becomes disabled and the menu closes.
  const held = deferred<typeof page5>();
  vi.spyOn(api, 'journalProject').mockReturnValue(held.promise);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(menu).toBeDisabled();
  expect(document.body).not.toHaveFocus();
  expect(feed).toHaveFocus();
  await act(async () => held.resolve(page5));
});

it('J14 a refresh that dismisses an entry menu still restores the prepend anchor', async () => {
  const server = mockJournalApp();
  const entries = Array.from({ length: 6 }, (_, index) => ({
    ...journal5,
    id: `33333333-3333-4333-8333-${String(10 - index).padStart(12, '0')}`,
    body: `Synthetic note ${index}`,
  }));
  server.entries = entries;
  // jsdom has no layout: entries are 100px rows stacked in DOM order.
  const nativeRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const feed = this.closest<HTMLElement>('[data-journal-feed]');
      if (feed && this === feed) return new DOMRect(100, 200, 600, 400);
      if (feed && this.dataset.journalEntry) {
        const index = [
          ...feed.querySelectorAll<HTMLElement>('[data-journal-entry]'),
        ].indexOf(this);
        return new DOMRect(100, 200 + index * 100 - feed.scrollTop, 600, 100);
      }
      return nativeRect.call(this);
    },
  );
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  await screen.findByText('Synthetic note 0');
  const feed = document.querySelector<HTMLElement>(
    '[data-journal-feed="project"]',
  )!;
  // Anchor: entry 2, 50px above the feed top.
  feed.scrollTop = 250;
  fireEvent.scroll(feed);
  const anchor = entries[2]!.id;
  const top = () =>
    feed
      .querySelector<HTMLElement>(`[data-journal-entry="${anchor}"]`)!
      .getBoundingClientRect().top;
  expect(top()).toBe(150);
  // Every row shares one work date: take the anchor's own trigger.
  const trigger = feed.querySelector<HTMLButtonElement>(
    `[data-journal-menu="${anchor}"]`,
  )!;
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  expect(
    await screen.findByRole('menuitem', { name: 'Редактировать запись' }),
  ).toHaveFocus();
  const held = deferred<JournalPage>();
  const original = vi.mocked(api.journalProject).getMockImplementation()!;
  vi.mocked(api.journalProject).mockImplementationOnce(() => held.promise);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(trigger).toBeDisabled();
  expect(feed).toHaveFocus();
  // The refreshed page prepends a new entry above the visible anchor.
  server.entries = [
    {
      ...journal5,
      id: '33333333-3333-4333-8333-000000000099',
      body: 'Prepended note',
    },
    ...entries,
  ];
  await act(async () => held.resolve(await original(journal5.projectId, {})));
  await screen.findByText('Prepended note');
  expect(top()).toBe(150);
  expect(feed.scrollTop).toBe(350);
});

it('formats the applied period', () => {
  expect(periodLabel({})).toBe('Все даты');
  expect(periodLabel({ from: '2026-10-01' })).toBe('с 01.10.2026');
  expect(periodLabel({ to: '2026-10-10' })).toBe('по 10.10.2026');
  expect(periodLabel({ from: '2026-10-01', to: '2026-10-10' })).toBe(
    '01.10.2026 – 10.10.2026',
  );
});

it('U06 shows reset only for an applied period, labels the applied range and reset clears it', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();
  const add = screen.getByRole('button', { name: 'Добавить запись' });
  expect(add.firstChild).toBeInstanceOf(HTMLSpanElement);
  expect(add.firstChild).toHaveAttribute('aria-hidden', 'true');
  expect(add.firstChild?.textContent?.trim()).toBe('+');
  await userEvent.click(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  );
  fireEvent.change(screen.getByLabelText('С даты'), {
    target: { value: '2026-10-01' },
  });
  expect(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Применить' }));
  await screen.findByRole('button', { name: 'Период: с 01.10.2026' });
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
  expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  ).toHaveFocus();
});

it('U06 shows reset for an applied search query', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  fireEvent.change(screen.getByLabelText('Поиск записей'), {
    target: { value: 'Original' },
  });
  await screen.findByRole('button', { name: 'Сбросить' });
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull(),
  );
  expect(screen.getByLabelText('Поиск записей')).toHaveValue('');
  expect(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  ).toHaveFocus();
});

it('U06 does not show reset for a whitespace-only search', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  fireEvent.change(screen.getByLabelText('Поиск записей'), {
    target: { value: '   ' },
  });
  expect(screen.getByLabelText('Поиск записей')).toHaveValue('   ');
  expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull();
});

it('U06 closing the period popover without applying clears the period error', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const period = screen.getByRole('button', { name: 'Период: Все даты' });
  for (const dismiss of ['escape', 'toggle'] as const) {
    await userEvent.click(period);
    fireEvent.change(screen.getByLabelText('С даты'), {
      target: { value: '2026-10-10' },
    });
    fireEvent.change(screen.getByLabelText('По дату'), {
      target: { value: '2026-10-01' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Проверьте период',
    );
    if (dismiss === 'escape') {
      fireEvent.keyDown(screen.getByLabelText('По дату'), { key: 'Escape' });
    } else {
      await userEvent.click(period);
    }
    expect(screen.queryByRole('group', { name: 'Период журнала' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(period).toHaveFocus();
  }
});

it('U06 reset closes an open period popover and keeps focus on the period button', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  );
  fireEvent.change(screen.getByLabelText('С даты'), {
    target: { value: '2026-10-01' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Применить' }));
  const period = await screen.findByRole('button', {
    name: 'Период: с 01.10.2026',
  });
  await userEvent.click(period);
  expect(
    screen.getByRole('group', { name: 'Период журнала' }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
  expect(screen.queryByRole('group', { name: 'Период журнала' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  ).toHaveFocus();
});

async function openTaskJournal() {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Работа 1' })[0]!,
  );
  await waitFor(() =>
    expect(document.getElementById('tab-journal')).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  return screen.getByRole('complementary', { name: 'Задача' });
}

it('U08 untouched task composer has no actions; erased text keeps only clear', async () => {
  const panel = await openTaskJournal();
  const body = within(panel).getByLabelText('Текст записи');
  const save = () =>
    within(panel).queryByRole('button', { name: 'Сохранить запись' });
  const clear = () =>
    within(panel).queryByRole('button', { name: 'Очистить черновик' });
  expect(body).toHaveAttribute(
    'placeholder',
    'Что сделали или узнали по задаче?',
  );
  expect(save()).toBeNull();
  expect(clear()).toBeNull();
  const hint = document.getElementById(body.getAttribute('aria-describedby')!)!;
  expect(hint).toHaveClass('sr-only');
  expect(hint).toHaveTextContent('Нужны дата и непустой текст');
  fireEvent.change(body, { target: { value: 'Проверил сборку' } });
  expect(save()).toBeEnabled();
  expect(clear()).toBeInTheDocument();
  expect(hint).not.toHaveClass('sr-only');
  fireEvent.change(body, { target: { value: '' } });
  expect(save()).toBeNull();
  expect(clear()).toBeInTheDocument();
});

it('U08 a changed date with empty text shows clear; empty or invalid date shows the hint', async () => {
  const panel = await openTaskJournal();
  const date = within(panel).getByLabelText('Дата записи');
  const body = within(panel).getByLabelText('Текст записи');
  const hint = document.getElementById(body.getAttribute('aria-describedby')!)!;
  fireEvent.change(date, { target: { value: '01.10.2026' } });
  expect(
    within(panel).getByRole('button', { name: 'Очистить черновик' }),
  ).toBeInTheDocument();
  expect(
    within(panel).queryByRole('button', { name: 'Сохранить запись' }),
  ).toBeNull();
  expect(hint).toHaveClass('sr-only');
  fireEvent.change(date, { target: { value: '31.02.2026' } });
  expect(hint).not.toHaveClass('sr-only');
  fireEvent.change(date, { target: { value: '' } });
  expect(hint).not.toHaveClass('sr-only');
});

it('U08 save and clear return focus to the text field', async () => {
  const panel = await openTaskJournal();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const body = () => within(panel).getByLabelText('Текст записи');
  fireEvent.change(body(), { target: { value: 'Проверил сборку' } });
  await userEvent.click(
    within(panel).getByRole('button', { name: 'Сохранить запись' }),
  );
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledOnce());
  await waitFor(() => expect(body()).toHaveFocus());
  expect(body()).toHaveValue('');
  fireEvent.change(body(), { target: { value: 'Черновик' } });
  await userEvent.click(
    within(panel).getByRole('button', { name: 'Очистить черновик' }),
  );
  await waitFor(() => expect(body()).toHaveFocus());
  expect(body()).toHaveValue('');
});

it('U08 Ctrl+Enter saves and a failed save keeps the text', async () => {
  const panel = await openTaskJournal();
  const body = within(panel).getByLabelText('Текст записи');
  vi.mocked(api.journalCreate).mockRejectedValueOnce(new Error('synthetic'));
  fireEvent.change(body, { target: { value: 'Проверил сборку' } });
  fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledOnce());
  await within(panel).findByRole('alert');
  expect(body).toHaveValue('Проверил сборку');
  expect(
    within(panel).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeInTheDocument();
});

it('U08 Ctrl/Cmd+Enter successful save keeps focus in the empty text field', async () => {
  const panel = await openTaskJournal();
  const body = () => within(panel).getByLabelText('Текст записи');
  const create = vi.mocked(api.journalCreate);
  const original = create.getMockImplementation()!;
  // Browsers ignore focus() on a disabled field; jsdom does not.
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (!(this instanceof HTMLTextAreaElement && this.disabled))
      focus.call(this, options);
  });
  for (const [index, modifier] of (['ctrlKey', 'metaKey'] as const).entries()) {
    const held = deferred<void>();
    create.mockImplementationOnce(async (...args) => {
      await held.promise;
      const saved = await original(...args);
      if (saved.kind === 'saved')
        saved.entry.id = `55555555-5555-4555-8555-00000000000${index}`;
      return saved;
    });
    body().focus();
    fireEvent.change(body(), { target: { value: `Запись ${modifier}` } });
    // A browser drops focus to <body> once the field is disabled during the
    // save; jsdom keeps it there, so leave the field before submitting.
    body().blur();
    fireEvent.keyDown(body(), { key: 'Enter', [modifier]: true });
    await waitFor(() => expect(body()).toBeDisabled());
    expect(document.body).toHaveFocus();
    // Worst-case ordering: the next animation frame runs before React commits
    // the saved state, while the text field is still disabled.
    const frame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(performance.now());
        return 0;
      });
    await act(async () => held.resolve());
    await within(panel).findByText(`Запись ${modifier}`);
    frame.mockRestore();
    await waitFor(() => expect(body()).toHaveFocus());
    expect(body()).toHaveValue('');
    expect(body()).toBeEnabled();
    expect(
      within(panel).queryByRole('button', { name: 'Сохранить запись' }),
    ).toBeNull();
  }
  expect(create).toHaveBeenCalledTimes(2);
});

it('U08 the edit editor always shows save and close', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const feed = document.querySelector<HTMLElement>(
    '[data-journal-feed="project"]',
  )!;
  await userEvent.click(
    within(feed).getByRole('button', { name: 'Действия записи 2024-02-29' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Редактировать запись' }),
  );
  fireEvent.change(within(feed).getByLabelText('Текст записи'), {
    target: { value: '' },
  });
  expect(
    within(feed).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeInTheDocument();
  expect(
    within(feed).getByRole('button', { name: 'Закрыть редактор' }),
  ).toBeInTheDocument();
});

it('U09 inline project composer requires a task and text, keeps its draft and returns focus', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const add = screen.getByRole('button', { name: 'Добавить запись' });
  await userEvent.click(add);
  expect(screen.queryByRole('dialog')).toBeNull();
  const composer = screen.getByRole('region', {
    name: 'Новая запись журнала',
  });
  const picker = within(composer).getByRole('button', {
    name: 'Выбрать задачу',
  });
  expect(picker).toHaveFocus();
  const body = within(composer).getByLabelText('Текст записи');
  expect(body).toHaveAttribute('placeholder', 'Что сделали или узнали?');
  // A repeated press without a chosen task focuses the picker again.
  body.focus();
  await userEvent.click(add);
  expect(picker).toHaveFocus();
  expect(
    within(composer).queryByRole('button', { name: 'Сохранить запись' }),
  ).toBeNull();
  fireEvent.change(body, { target: { value: '   ' } });
  expect(
    within(composer).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeDisabled();
  fireEvent.change(body, { target: { value: 'Черновик проекта' } });
  expect(
    within(composer).getByRole('button', { name: 'Сохранить запись' }),
  ).toBeDisabled();
  fireEvent.keyDown(body, { key: 'Escape' });
  await waitFor(() => expect(add).toHaveFocus());
  expect(
    screen.queryByRole('region', { name: 'Новая запись журнала' }),
  ).toBeNull();
  await userEvent.click(add);
  expect(screen.getByLabelText('Текст записи')).toHaveValue('Черновик проекта');
});

it('U09 composer keys do not reach window shortcuts: Escape keeps the task panel, Ctrl+Z does not undo', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Работа 1' })[0]!,
  );
  const panel = await screen.findByRole('complementary', { name: 'Задача' });
  const projectView = document.getElementById('project-view-journal')!;
  await userEvent.click(
    within(projectView).getByRole('button', { name: 'Добавить запись' }),
  );
  const composer = screen.getByRole('region', {
    name: 'Новая запись журнала',
  });
  const onWindow = vi.fn();
  window.addEventListener('keydown', onWindow);
  const picker = within(composer).getByRole('button', {
    name: 'Выбрать задачу',
  });
  fireEvent.keyDown(picker, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(picker, { key: 'Escape' });
  window.removeEventListener('keydown', onWindow);
  expect(onWindow).not.toHaveBeenCalled();
  expect(api.command).not.toHaveBeenCalled();
  expect(panel).toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Новая запись журнала' }),
  ).toBeNull();
});

it('U09 switching projects closes the inline composer; each project keeps its own draft', async () => {
  const server = mockJournalApp();
  const projectB = '44444444-4444-4444-8444-444444444444';
  server.projects.push({
    ...server.projects[0]!,
    id: projectB,
    title: 'Synthetic B',
  });
  // Project journal "Добавить запись" is disabled for a project without tasks.
  server.tree.tasks.push(task(3, { projectId: projectB }));
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Черновик проекта A' },
  });
  await userEvent.click(screen.getByRole('button', { name: /Synthetic B/ }));
  await screen.findByRole('heading', { name: 'Synthetic B' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  expect(
    screen.queryByRole('region', { name: 'Новая запись журнала' }),
  ).toBeNull();
  const add = screen.getByRole('button', { name: 'Добавить запись' });
  await waitFor(() => expect(add).toBeEnabled());
  await userEvent.click(add);
  expect(screen.getByLabelText('Текст записи')).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: /Демо-проект/ }));
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  const addA = screen.getByRole('button', { name: 'Добавить запись' });
  await waitFor(() => expect(addA).toBeEnabled());
  await userEvent.click(addA);
  expect(screen.getByLabelText('Текст записи')).toHaveValue(
    'Черновик проекта A',
  );
});

it('U09 with a chosen task the composer focuses the text field, also on a repeated add press', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  const add = screen.getByRole('button', { name: 'Добавить запись' });
  await userEvent.click(add);
  const composer = screen.getByRole('region', {
    name: 'Новая запись журнала',
  });
  await userEvent.click(
    within(composer).getByRole('button', { name: 'Выбрать задачу' }),
  );
  fireEvent.keyDown(within(composer).getByRole('combobox'), { key: 'Enter' });
  fireEvent.keyDown(
    within(composer).getByRole('button', { name: 'Работа 1' }),
    { key: 'Escape' },
  );
  await waitFor(() => expect(add).toHaveFocus());
  await userEvent.click(add);
  const body = screen.getByLabelText('Текст записи');
  expect(body).toHaveFocus();
  add.focus();
  await userEvent.click(add);
  expect(body).toHaveFocus();
});

it('U09 the composer and its text survive switching to «Задачи» and back', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Черновик между вкладками' },
  });
  await userEvent.click(screen.getByRole('tab', { name: 'Задачи' }));
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  const composer = screen.getByRole('region', {
    name: 'Новая запись журнала',
  });
  expect(within(composer).getByLabelText('Текст записи')).toHaveValue(
    'Черновик между вкладками',
  );
});

it('U09 applying a period while the composer is open keeps the composer, its text and the period focus', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Черновик при смене периода' },
  });
  const held = deferred<JournalPage>();
  const original = vi.mocked(api.journalProject).getMockImplementation()!;
  vi.mocked(api.journalProject).mockImplementationOnce(() => held.promise);
  await userEvent.click(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  );
  fireEvent.change(screen.getByLabelText('С даты'), {
    target: { value: '2024-03-01' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Применить' }));
  const period = screen.getByRole('button', { name: 'Период: с 01.03.2024' });
  expect(period).toHaveFocus();
  await waitFor(() =>
    expect(api.journalProject).toHaveBeenLastCalledWith(journal5.projectId, {
      from: '2024-03-01',
    }),
  );
  // While the new period loads, the composer stays mounted with its draft;
  // the picker waits for coherent metadata.
  const loading = screen.getByRole('region', {
    name: 'Новая запись журнала',
  });
  expect(within(loading).getByLabelText('Текст записи')).toHaveValue(
    'Черновик при смене периода',
  );
  expect(
    within(loading).getByRole('button', { name: 'Выбрать задачу' }),
  ).toBeDisabled();
  expect(period).toHaveFocus();
  await act(async () =>
    held.resolve(await original(journal5.projectId, { from: '2024-03-01' })),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Добавить запись' }),
    ).toBeEnabled(),
  );
  expect(period).toHaveFocus();
  const composer = screen.getByRole('region', {
    name: 'Новая запись журнала',
  });
  expect(within(composer).getByLabelText('Текст записи')).toHaveValue(
    'Черновик при смене периода',
  );
});
