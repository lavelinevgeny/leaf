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
