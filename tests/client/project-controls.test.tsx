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
  await screen.findByRole('heading', { name: project.title });
  const opener = activeOpener();
  await userEvent.click(opener);
  await userEvent.click(
    screen.getByRole('button', { name: 'Настройки проекта' }),
  );
  return opener;
}
function activeOpener() {
  return within(document.querySelector('.project-item.active')!).getByRole(
    'button',
    { name: 'Действия проекта' },
  );
}
function otherOpener() {
  return within(
    screen.getByRole('button', { name: /Другой демо-проект/ }).parentElement!,
  ).getByRole('button', { name: 'Действия проекта' });
}
it('loads the inactive project before opening its menu and renames only that project', async () => {
  render(<App />);
  await screen.findByRole('heading', { name: project.title });
  let finishLoad!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () => new Promise<Response>((resolve) => (finishLoad = resolve)),
  );
  const opener = otherOpener();
  opener.focus();
  await userEvent.keyboard('{Enter}');
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
    `/api/projects/${other.id}/tree`,
  );
  expect(
    screen.queryByRole('button', { name: 'Настройки проекта' }),
  ).toBeNull();
  for (const button of screen.getAllByRole('button', {
    name: 'Действия проекта',
  }))
    expect(button).toBeDisabled();
  finishLoad(new Response(JSON.stringify({ ...tree, project: other })));
  await screen.findByRole('heading', { name: other.title });
  expect(
    screen.getByRole('button', { name: 'Настройки проекта' }),
  ).toHaveFocus();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method !== 'GET')).toBe(
    false,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Переименовать проект' }),
  );
  const input = screen.getByLabelText('Название проекта');
  expect(input).toHaveValue(other.title);
  await userEvent.clear(input);
  await userEvent.type(input, 'Переименованный демо-проект');
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ...tree,
          project: {
            ...other,
            title: 'Переименованный демо-проект',
            revision: 1,
          },
        }),
      ),
    ),
  );
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Переименовать проект',
    }),
  );
  await screen.findByRole('heading', { name: 'Переименованный демо-проект' });
  expect(
    fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[0],
  ).toBe(`/api/projects/${other.id}`);
  expect(
    screen.getByRole('button', { name: new RegExp(project.title) }),
  ).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(activeOpener()).toHaveFocus();
});
it('keeps failed inactive-menu loading recoverable without opening the previous project menu', async () => {
  render(<App />);
  await screen.findByRole('heading', { name: project.title });
  fetchMock.mockImplementationOnce(() =>
    Promise.reject(new TypeError('synthetic offline')),
  );
  await userEvent.click(otherOpener());
  expect(await screen.findByText(/Нет связи с сервером/)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Настройки проекта' }),
  ).toBeNull();
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(new Response(JSON.stringify({ ...tree, project: other }))),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByRole('heading', { name: other.title });
  expect(
    screen.getByRole('button', { name: 'Настройки проекта' }),
  ).toHaveFocus();
});
it('refuses an inactive project menu while the current settings draft is dirty', async () => {
  await openSettings();
  await userEvent.type(
    screen.getByLabelText('Часовой пояс проекта'),
    '/invalid',
  );
  const requests = fetchMock.mock.calls.length;
  await userEvent.click(otherOpener());
  expect(screen.getByRole('heading', { name: project.title })).toBeVisible();
  expect(screen.getByLabelText('Часовой пояс проекта')).toHaveValue(
    'UTC/invalid',
  );
  expect(fetchMock.mock.calls).toHaveLength(requests);
});
it('mounts forms on demand and returns keyboard menu focus without writes', async () => {
  render(<App />);
  await screen.findByRole('heading', { name: project.title });
  expect(screen.queryByLabelText('Часовой пояс проекта')).toBeNull();
  expect(screen.queryByLabelText('Название проекта')).toBeNull();
  const requests = fetchMock.mock.calls.length;
  const opener = activeOpener();
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
it('keeps the settings dialog open when parent dirty state has not rendered yet', async () => {
  const onDirty = vi.fn();
  const onSave = vi.fn(async () => true);
  render(
    <ProjectControls
      project={project}
      disabled={false}
      dirty={false}
      onSave={onSave}
      onDirty={onDirty}
      rename={null}
      onRenameChange={vi.fn()}
      onRename={vi.fn()}
      onOpen={() => true}
      onVisibility={vi.fn()}
      feedback={null}
    />,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия проекта' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Настройки проекта' }),
  );
  const timezone = screen.getByLabelText('Часовой пояс проекта');
  await userEvent.clear(timezone);
  await userEvent.type(timezone, 'Europe/Moscow');
  expect(onDirty).toHaveBeenCalledWith(true);
  await userEvent.keyboard('{Escape}');
  expect(
    screen.getByRole('dialog', { name: 'Настройки проекта' }),
  ).toBeVisible();
  expect(timezone).toHaveValue('Europe/Moscow');
  expect(onSave).not.toHaveBeenCalled();
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
