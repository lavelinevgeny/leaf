// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App.js';
import { api, ApiError } from '../../src/client/api.js';

const notice =
  'Публичное демо: данные общие для всех посетителей и сбрасываются при каждом запуске сервера. Не вводите личные данные.';
const guest = { authenticated: false, setupRequired: false, demoMode: true };
beforeEach(() => {
  vi.spyOn(api, 'session').mockResolvedValue(guest);
  vi.spyOn(api, 'projects').mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('requires explicit keyboard entry and preserves the notice and demo mode after logout', async () => {
  const enter = vi
    .spyOn(api, 'enterDemo')
    .mockResolvedValue({ ...guest, authenticated: true });
  vi.spyOn(api, 'logout').mockResolvedValue(guest);
  render(<App />);
  const button = await screen.findByRole('button', { name: 'Открыть демо' });
  expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
  expect(screen.getByText(notice)).toBeVisible();
  expect(enter).not.toHaveBeenCalled();
  button.focus();
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByText('Создайте первый проект.')).toBeVisible();
  expect(screen.getByText(notice)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
  expect(
    await screen.findByRole('button', { name: 'Открыть демо' }),
  ).toBeEnabled();
  expect(enter).toHaveBeenCalledOnce();
});
it('disables entry while loading and supports retry after an entry error', async () => {
  let reject!: (error: Error) => void;
  const enter = vi
    .spyOn(api, 'enterDemo')
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue({ ...guest, authenticated: true });
  render(<App />);
  await userEvent.click(
    await screen.findByRole('button', { name: 'Открыть демо' }),
  );
  expect(screen.getByRole('button', { name: 'Открыть демо' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Загрузка');
  reject(new ApiError('DEMO_LIMIT', 'Достигнут лимит демо.', 409));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Достигнут лимит демо.',
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Открыть демо' })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Открыть демо' }));
  expect(await screen.findByText('Создайте первый проект.')).toBeVisible();
  expect(enter).toHaveBeenCalledTimes(2);
});
it('retries failed session discovery before offering entry', async () => {
  vi.mocked(api.session).mockRejectedValueOnce(
    new ApiError('NETWORK_ERROR', 'Сеть недоступна'),
  );
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Сеть недоступна');
  expect(
    screen.queryByRole('button', { name: 'Открыть демо' }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(
    await screen.findByRole('button', { name: 'Открыть демо' }),
  ).toBeVisible();
});
it.each([false, true])(
  'preserves normal authentication without the demo flag (setup=%s)',
  async (setupRequired) => {
    vi.mocked(api.session).mockResolvedValue({
      authenticated: false,
      setupRequired,
    });
    render(<App />);
    if (setupRequired)
      expect(await screen.findByText(/Аккаунт ещё не создан/)).toBeVisible();
    else expect(await screen.findByLabelText('Пароль')).toBeVisible();
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Открыть демо' }),
    ).not.toBeInTheDocument();
  },
);
it('shows a demo write limit while leaving project reads available', async () => {
  vi.mocked(api.session).mockResolvedValue({ ...guest, authenticated: true });
  vi.spyOn(api, 'createProject').mockRejectedValue(
    new ApiError('DEMO_LIMIT', 'Достигнут лимит демо: проектов.', 409),
  );
  render(<App />);
  await userEvent.click(
    await screen.findByRole('button', { name: 'Новый проект' }),
  );
  await userEvent.type(
    screen.getByLabelText('Название проекта'),
    'Синтетический проект',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Создать проект' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Достигнут лимит демо: проектов.',
  );
  expect(api.projects).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await waitFor(() => expect(api.projects).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Создайте первый проект.')).toBeVisible();
});

it('retains explicit demo entry after an expired session', async () => {
  vi.mocked(api.session).mockResolvedValue({ ...guest, authenticated: true });
  vi.mocked(api.projects).mockRejectedValueOnce(
    new ApiError('UNAUTHORIZED', 'Сессия завершена', 401),
  );
  vi.spyOn(api, 'enterDemo').mockResolvedValue({
    ...guest,
    authenticated: true,
  });
  render(<App />);
  expect(
    await screen.findByRole('button', { name: 'Открыть демо' }),
  ).toBeVisible();
  expect(screen.getByText(notice)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Открыть демо' }));
  expect(await screen.findByText('Создайте первый проект.')).toBeVisible();
});
it('posts the strict empty demo payload and validates the returned session', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ...guest, authenticated: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  expect(await api.enterDemo()).toEqual({ ...guest, authenticated: true });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/auth/demo',
    expect.objectContaining({
      method: 'POST',
      body: '{}',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});
