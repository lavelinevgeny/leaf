// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
// jsdom has no native modal implementation; browsers exercise showModal in E2E.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectControls } from '../../src/client/ProjectControls.js';
import { App } from '../../src/client/App.js';
import { project, task, emptySchedule } from './fixtures.js';
const other = {
  ...project,
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Другой демо-проект',
};
const tree = {
  contractVersion: 2,
  project,
  tasks: [task(1)],
  canUndo: false,
  dependencies: [],
  schedule: emptySchedule,
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          url === '/api/auth/session'
            ? { authenticated: true, setupRequired: false }
            : url === '/api/projects'
              ? [project, other]
              : tree,
        ),
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function openSettings() {
  render(<App />);
  const opener = await screen.findByRole('button', {
    name: 'Действия проекта',
  });
  await userEvent.click(opener);
  await userEvent.click(
    screen.getByRole('button', { name: 'Настройки проекта' }),
  );
  return opener;
}
it('mounts forms on demand and returns keyboard menu focus without writes', async () => {
  render(<App />);
  await screen.findByRole('heading', { name: project.title });
  expect(screen.queryByLabelText('Часовой пояс проекта')).toBeNull();
  expect(screen.queryByLabelText('Название проекта')).toBeNull();
  const requests = fetchMock.mock.calls.length;
  const opener = screen.getByRole('button', { name: 'Действия проекта' });
  opener.focus();
  await userEvent.keyboard('{Enter}');
  expect(
    screen.getByRole('button', { name: 'Настройки проекта' }),
  ).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(opener).toHaveFocus();
  expect(fetchMock.mock.calls).toHaveLength(requests);
});
it('contains Tab, preserves dirty Escape draft and explicitly discards it', async () => {
  const opener = await openSettings();
  const dialog = screen.getByRole('dialog', { name: 'Настройки проекта' });
  const input = within(dialog).getByLabelText('Часовой пояс проекта');
  await userEvent.type(input, '/invalid');
  await userEvent.keyboard('{Escape}');
  expect(input).toHaveValue('UTC/invalid');
  const close = within(dialog).getByRole('button', { name: 'Закрыть' });
  close.focus();
  await userEvent.tab();
  expect(within(dialog).getByRole('combobox')).toHaveFocus();
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Отбросить изменения' }),
  );
  screen.getByRole('button', { name: 'Закрыть' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(opener).toHaveFocus();
});
it('saves settings atomically and closes only the clean dialog', async () => {
  const opener = await openSettings();
  await userEvent.selectOptions(screen.getByLabelText('Календарь'), 'all-days');
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ...tree,
          project: { ...project, calendarType: 'all-days', revision: 1 },
        }),
      ),
    ),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить настройки проекта' }),
  );
  expect(
    screen.getByRole('button', { name: 'Сохранить настройки проекта' }),
  ).toBeDisabled();
  const write = fetchMock.mock.calls.find(
    ([, init]) => init?.method === 'POST',
  );
  expect(JSON.parse(write?.[1].body).command).toEqual({
    type: 'project.schedule',
    changes: { calendarType: 'all-days', timezone: 'UTC' },
  });
  screen.getByRole('button', { name: 'Закрыть' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(opener).toHaveFocus();
});
it('keeps uncertain draft and makes the existing retry available inside the modal', async () => {
  await openSettings();
  await userEvent.clear(screen.getByLabelText('Часовой пояс проекта'));
  await userEvent.type(
    screen.getByLabelText('Часовой пояс проекта'),
    'Europe/Moscow',
  );
  fetchMock.mockImplementationOnce(() =>
    Promise.reject(new TypeError('synthetic offline')),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить настройки проекта' }),
  );
  const dialog = screen.getByRole('dialog', { name: 'Настройки проекта' });
  expect(within(dialog).getByText(/Нет связи с сервером/)).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: 'Повторить' }),
  ).toBeEnabled();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByLabelText('Часовой пояс проекта')).toHaveValue(
    'Europe/Moscow',
  );
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ...tree,
          project: { ...project, timezone: 'Europe/Moscow', revision: 1 },
        }),
      ),
    ),
  );
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Повторить' }),
  );
  const writes = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === 'POST',
  );
  expect(writes).toHaveLength(2);
  expect(writes[1]![1].body).toBe(writes[0]![1].body);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeEnabled(),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Сохранить настройки проекта' }),
    ).toBeDisabled(),
  );
  screen.getByRole('button', { name: 'Закрыть' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('guards project switching and task selection while settings are dirty without a write', async () => {
  await openSettings();
  await userEvent.type(
    screen.getByLabelText('Часовой пояс проекта'),
    '/invalid',
  );
  const requests = fetchMock.mock.calls.length;
  await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1,/ }));
  expect(screen.queryByRole('complementary', { name: 'Задача' })).toBeNull();
  expect(screen.getByLabelText('Часовой пояс проекта')).toHaveValue(
    'UTC/invalid',
  );
  await userEvent.click(
    screen.getByRole('button', { name: /Другой демо-проект/ }),
  );
  expect(screen.getByRole('heading', { name: project.title })).toBeVisible();
  expect(fetchMock.mock.calls).toHaveLength(requests);
});
it('closes stale clean settings when switching projects', async () => {
  await openSettings();
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(new Response(JSON.stringify({ ...tree, project: other }))),
  );
  await userEvent.click(
    screen.getByRole('button', { name: /Другой демо-проект/ }),
  );
  await screen.findByRole('heading', { name: other.title });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByLabelText('Часовой пояс проекта')).toBeNull();
});
it('preserves failed settings and allows explicit discard after a definite rejection', async () => {
  await openSettings();
  await userEvent.type(
    screen.getByLabelText('Часовой пояс проекта'),
    '/invalid',
  );
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          message: 'Проверьте часовой пояс.',
        }),
        { status: 400 },
      ),
    ),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить настройки проекта' }),
  );
  expect(
    within(screen.getByRole('dialog')).getByText('Проверьте часовой пояс.'),
  ).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByLabelText('Часовой пояс проекта')).toHaveValue(
    'UTC/invalid',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Отбросить изменения' }),
  );
  screen.getByRole('button', { name: 'Закрыть' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('shows recovery feedback after a failed switch unmounts clean settings', async () => {
  await openSettings();
  fetchMock.mockImplementationOnce(() =>
    Promise.reject(new TypeError('synthetic offline')),
  );
  await userEvent.click(
    screen.getByRole('button', { name: /Другой демо-проект/ }),
  );
  expect(await screen.findByText(/Нет связи с сервером/)).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(new Response(JSON.stringify({ ...tree, project: other }))),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByRole('heading', { name: other.title });
  expect(screen.queryByText(/Нет связи с сервером/)).toBeNull();
});

it('clears visibility only on unmount and uses the latest callback after rerender', async () => {
  const firstVisibility = vi.fn();
  const nextVisibility = vi.fn();
  const props = {
    project,
    disabled: false,
    dirty: false,
    onSave: vi.fn(async () => true),
    onDirty: vi.fn(),
    rename: null,
    onRenameChange: vi.fn(),
    onRename: vi.fn(),
    onOpen: () => true,
    onVisibility: firstVisibility,
    feedback: null,
  };
  const view = render(<ProjectControls {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия проекта' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Настройки проекта' }),
  );
  firstVisibility.mockClear();
  view.rerender(
    <ProjectControls
      {...props}
      onVisibility={nextVisibility}
      feedback={<p>Сообщение проекта</p>}
    />,
  );
  expect(firstVisibility).not.toHaveBeenCalled();
  expect(nextVisibility.mock.calls).toEqual([[true]]);
  expect(screen.getByRole('dialog')).toBeVisible();
  view.unmount();
  expect(nextVisibility.mock.calls).toEqual([[true], [false]]);
});
