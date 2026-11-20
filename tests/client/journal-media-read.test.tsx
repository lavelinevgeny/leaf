// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useJournal } from '../../src/client/use-journal.js';
import { api } from '../../src/client/api.js';
import {
  journalContext,
  journal5,
  page5,
  deferred,
} from './journal-fixtures.js';
import type { JournalDraftKey } from '../../src/client/journal-state.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup() {
  vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  const expired = vi.fn();
  const view = renderHook(({ context }) => useJournal(context), {
    initialProps: { context: journalContext({ onAuthRequired: expired }) },
  });
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  let key: JournalDraftKey;
  act(() => {
    key = view.result.current.openCreate(
      journal5.projectId,
      journal5.taskId,
      '2026-11-15',
    )!;
    view.result.current.changeDraft(key, { body: 'private draft' });
  });
  return { view, key: key!, expired };
}
it.each([false, true])(
  'binary read401 clears same private session after project navigation (download %s)',
  async (download) => {
    const { view, expired } = await setup();
    const response = deferred<Response>();
    const fetch = vi.fn().mockImplementation(() => response.promise);
    vi.stubGlobal('fetch', fetch);
    let read: Promise<Blob | null>;
    act(() => {
      read = view.result.current.readMedia(
        journal5.projectId,
        journal5.taskId,
        journal5.id,
        download,
      );
    });
    view.rerender({
      context: journalContext({
        projectId: '88888888-8888-4888-8888-888888888888',
        onAuthRequired: expired,
      }),
    });
    await act(async () => {
      response.resolve(new Response(null, { status: 401 }));
      expect(await read).toBeNull();
    });
    expect(expired).toHaveBeenCalledOnce();
    expect(view.result.current.drafts.size).toBe(0);
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: 'same-origin',
    });
    expect(fetch.mock.calls[0]![1]).not.toHaveProperty('headers');
  },
);
it('a late binary401 from the cleared session cannot clear a new login or a successful new read', async () => {
  const { view, expired } = await setup();
  const response = deferred<Response>();
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => response.promise)
    .mockResolvedValueOnce(new Response('synthetic', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  let old: Promise<Blob | null>;
  act(() => {
    old = view.result.current.readMedia(
      journal5.projectId,
      journal5.taskId,
      journal5.id,
    );
  });
  act(() => view.result.current.clearPrivateState());
  const newExpired = vi.fn();
  view.rerender({ context: journalContext({ onAuthRequired: newExpired }) });
  let key: JournalDraftKey;
  act(() => {
    key = view.result.current.openCreate(
      journal5.projectId,
      journal5.taskId,
      '2026-11-15',
    )!;
    view.result.current.changeDraft(key, { body: 'new private document' });
  });
  await act(async () => {
    response.resolve(new Response(null, { status: 401 }));
    expect(await old).toBeNull();
  });
  expect(expired).not.toHaveBeenCalled();
  expect(newExpired).not.toHaveBeenCalled();
  expect(view.result.current.getDraft(key!)?.body).toBe('new private document');
  await act(async () =>
    expect(
      await view.result.current.readMedia(
        journal5.projectId,
        journal5.taskId,
        journal5.id,
      ),
    ).toBeInstanceOf(Blob),
  );
});

import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JournalRichBody } from '../../src/client/JournalRichBody.js';
import type { JournalController } from '../../src/client/journal-state.js';
import type { JournalEntryV2 } from '../../src/shared/journal-contracts-v2.js';
import { useJournalImage } from '../../src/client/use-journal-image.js';
const fileEntry: JournalEntryV2 = {
  ...journal5,
  body: '[Файл: synthetic.txt]',
  content: {
    format: 'rich-text',
    documentVersion: 1,
    doc: {
      type: 'doc',
      content: [{ type: 'journalFile', attrs: { mediaId: journal5.id } }],
    },
  },
  media: [
    {
      id: journal5.id,
      kind: 'file',
      fileName: 'synthetic.txt',
      byteLength: 9,
      mediaType: 'application/octet-stream',
    },
  ],
};
const imageEntry: JournalEntryV2 = {
  ...journal5,
  body: '[Изображение: synthetic.webp]',
  content: {
    format: 'rich-text',
    documentVersion: 1,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'journalImage',
          attrs: { mediaId: journal5.id, alt: 'Synthetic image' },
        },
      ],
    },
  },
  media: [
    {
      id: journal5.id,
      kind: 'image',
      fileName: 'synthetic.webp',
      byteLength: 9,
      mediaType: 'image/webp',
      width: 40,
      height: 20,
    },
  ],
};
function BodyHarness({
  entry,
  expired,
}: {
  entry: JournalEntryV2;
  expired: () => void;
}) {
  const controller = useJournal(journalContext({ onAuthRequired: expired }));
  return controller.projectFeed?.page ? (
    <JournalRichBody entry={entry} readMedia={controller.readMedia} />
  ) : (
    <p>Private media cleared</p>
  );
}
it('file download401 invokes the controller auth path and removes the private renderer', async () => {
  vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  const expired = vi.fn();
  render(<BodyHarness entry={fileEntry} expired={expired} />);
  fireEvent.click(await screen.findByRole('button', { name: /synthetic.txt/ }));
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
  expect(screen.getByText('Private media cleared')).toBeVisible();
});
it.each(['initial', 'retry', 'viewer'] as const)(
  'image %s reads check401 through controller and revoke owned URLs',
  async (phase) => {
    vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
    const create = vi.fn().mockReturnValue('blob:synthetic-owned');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: create,
        revokeObjectURL: revoke,
      }),
    );
    const fetch = vi.fn();
    if (phase === 'initial')
      fetch.mockResolvedValue(new Response(null, { status: 401 }));
    else
      fetch
        .mockResolvedValueOnce(
          new Response('synthetic', { status: phase === 'retry' ? 404 : 200 }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const expired = vi.fn();
    render(<BodyHarness entry={imageEntry} expired={expired} />);
    if (phase === 'retry')
      fireEvent.click(
        await screen.findByRole('button', { name: 'Повторить чтение' }),
      );
    if (phase === 'viewer') {
      const open = await screen.findByRole('button', {
        name: 'Открыть изображение',
      });
      await waitFor(() => expect(open).toBeEnabled());
      fireEvent.click(open);
    }
    await waitFor(() => expect(expired).toHaveBeenCalledOnce());
    expect(screen.getByText('Private media cleared')).toBeVisible();
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledTimes(phase === 'viewer' ? 1 : 0),
    );
    expect(
      fetch.mock.calls.every((call) => call[1]?.credentials === 'same-origin'),
    ).toBe(true);
  },
);
it('mounted duplicate images share a single read/URL and release it after the last consumer', async () => {
  const create = vi.fn().mockReturnValue('blob:stable');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: create,
      revokeObjectURL: revoke,
    }),
  );
  const read = vi
    .fn<JournalController['readMedia']>()
    .mockResolvedValue(new Blob(['synthetic']));
  const first = renderHook(() =>
    useJournalImage(read, journal5.projectId, journal5.taskId, journal5.id),
  );
  const second = renderHook(() =>
    useJournalImage(read, journal5.projectId, journal5.taskId, journal5.id),
  );
  await waitFor(() => expect(first.result.current.src).toBe('blob:stable'));
  expect(second.result.current.src).toBe('blob:stable');
  expect(read).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
  first.unmount();
  expect(revoke).not.toHaveBeenCalled();
  second.unmount();
  expect(revoke).toHaveBeenCalledOnce();
  expect(read.mock.calls[0]![4]!.aborted).toBe(true);
});
it('controller image reader identity is stable across draft publication and rotates on private reset', async () => {
  const { view, key } = await setup();
  const first = view.result.current.readMedia;
  act(() => view.result.current.changeDraft(key, { body: 'changed once' }));
  expect(view.result.current.readMedia).toBe(first);
  act(() => view.result.current.clearPrivateState());
  expect(view.result.current.readMedia).not.toBe(first);
});
it('local source preview and normalized server image cannot share a cached URL under the same media ID', async () => {
  const create = vi
    .fn()
    .mockReturnValueOnce('blob:local')
    .mockReturnValueOnce('blob:server');
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: create,
      revokeObjectURL: vi.fn(),
    }),
  );
  const file = new File(['source'], 'source.png', { type: 'image/png' });
  const normalized = new Blob(['normalized'], { type: 'image/webp' });
  const read = vi
    .fn<JournalController['readMedia']>()
    .mockResolvedValue(normalized);
  const local = renderHook(() =>
    useJournalImage(
      read,
      journal5.projectId,
      journal5.taskId,
      journal5.id,
      file,
    ),
  );
  const saved = renderHook(() =>
    useJournalImage(read, journal5.projectId, journal5.taskId, journal5.id),
  );
  await waitFor(() => expect(saved.result.current.src).toBe('blob:server'));
  expect(local.result.current.src).toBe('blob:local');
  expect(create.mock.calls.map((call) => call[0])).toEqual([file, normalized]);
  expect(read).toHaveBeenCalledOnce();
});
it('a late successful viewer read cannot steal focus after the user leaves its opener', async () => {
  vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn().mockReturnValue('blob:owned'),
      revokeObjectURL: vi.fn(),
    }),
  );
  const response = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('synthetic'))
      .mockImplementationOnce(() => response.promise),
  );
  render(
    <>
      <BodyHarness entry={imageEntry} expired={vi.fn()} />
      <button type="button">Other focus</button>
    </>,
  );
  const opener = await screen.findByRole('button', {
    name: 'Открыть изображение',
  });
  await waitFor(() => expect(opener).toBeEnabled());
  opener.focus();
  fireEvent.click(opener);
  screen.getByRole('button', { name: 'Other focus' }).focus();
  await act(async () => response.resolve(new Response('synthetic')));
  expect(
    screen.queryByRole('dialog', { name: 'Просмотр изображения' }),
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Other focus' })).toHaveFocus();
});
