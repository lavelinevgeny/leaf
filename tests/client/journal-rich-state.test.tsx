// @vitest-environment jsdom
import type { JournalDraftKey } from '../../src/client/journal-state.js';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useJournal } from '../../src/client/use-journal.js';
import { api, ApiError } from '../../src/client/api.js';
import {
  journalContext,
  journal5,
  page5,
  deferred,
} from './journal-fixtures.js';
import type { JournalContent } from '../../src/shared/journal-content.js';
import type { JournalUploadReady } from '../../src/shared/journal-media-contracts.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup() {
  vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  const view = renderHook(({ context }) => useJournal(context), {
    initialProps: { context: journalContext() },
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
  });
  return {
    view,
    key: key!,
  };
}
it('date-only edit retains exact legacy content; rich formatting is authoritative and immutable on retry', async () => {
  const { view } = await setup();
  let key: JournalDraftKey;
  act(() => {
    key = view.result.current.openEdit(journal5, 5)!;
  });
  act(() => view.result.current.changeDraft(key!, { workDate: '2026-11-15' }));
  const write = vi
    .spyOn(api, 'journalUpdate')
    .mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null, true));
  await act(async () => {
    await view.result.current.submit(key!);
  });
  expect(write.mock.calls[0]?.[2]).toHaveProperty('content', journal5.content);
  expect(write.mock.calls[0]?.[2]).not.toHaveProperty('body');
  await act(async () => {
    await view.result.current.retry();
  });
  expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
});
it('keeps the exact rich2 pending operation and draft when transport receives a matching plain frozen1 acknowledgement', async () => {
  const { view, key } = await setup();
  const content: JournalContent = {
    format: 'rich-text',
    documentVersion: 1,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'live rich pending',
              marks: [{ type: 'bold' }],
            },
          ],
        },
      ],
    },
  };
  act(() => view.result.current.changeDraft(key, { content }));
  const legacyAck = {
    journalContractVersion: 1,
    kind: 'saved',
    projectId: journal5.projectId,
    journalRevision: 6,
    entry: {
      id: journal5.id,
      projectId: journal5.projectId,
      taskId: journal5.taskId,
      workDate: '2026-11-15',
      body: 'live rich pending',
      createdAt: journal5.createdAt,
      updatedAt: journal5.updatedAt,
    },
  };
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(legacyAck)));
  const legacy = vi.spyOn(api, 'journalReplayLegacy');
  await act(async () =>
    expect(await view.result.current.submit(key)).toBe(false),
  );
  const pending = view.result.current.pending;
  expect(pending?.input.journalContractVersion).toBe(2);
  expect(view.result.current.uncertain).toBe(true);
  expect(view.result.current.getDraft(key)?.content).toEqual(content);
  await act(async () => expect(await view.result.current.retry()).toBe(false));
  expect(view.result.current.pending).toBe(pending);
  expect(view.result.current.getDraft(key)?.content).toEqual(content);
  expect(fetch.mock.calls).toHaveLength(2);
  expect(fetch.mock.calls[1]![1]!.body).toBe(fetch.mock.calls[0]![1]!.body);
  expect(fetch.mock.calls[1]![1]!.headers).toMatchObject({
    'X-Leaf-Journal-Contract-Version': '2',
  });
  expect(legacy).not.toHaveBeenCalled();
});
it('retains source File and upload identity on uncertainty; removal/Undo restores ready block without reinsertion', async () => {
  const { view, key } = await setup();
  const pending = deferred<JournalUploadReady>();
  const upload = vi
    .spyOn(api, 'journalUpload')
    .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', null, true))
    .mockImplementationOnce(() => pending.promise);
  let content: JournalContent;
  act(() => {
    content = view.result.current.addFiles(key, [
      new File(['synthetic'], 'sample.txt'),
    ])!.content;
    view.result.current.changeDraft(key, { content });
  });
  await waitFor(() =>
    expect(
      [...view.result.current.getDraft(key)!.uploads.values()][0]?.status,
    ).toBe('uncertain'),
  );
  const first = [...view.result.current.getDraft(key)!.uploads.values()][0]!;
  expect(first.file.name).toBe('sample.txt');
  act(() => {
    void view.result.current.retryUpload(key, first.id);
  });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  expect(upload.mock.calls[1]?.[2].uploadId).toBe(
    upload.mock.calls[0]?.[2].uploadId,
  );
  act(() =>
    view.result.current.changeDraft(key, {
      content: { format: 'plain-text', text: 'after removal' },
    }),
  );
  await act(async () =>
    pending.resolve({
      mediaContractVersion: 1,
      uploadId: first.uploadId,
      media: {
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'file',
        fileName: 'sample.txt',
        byteLength: 9,
        mediaType: 'application/octet-stream',
      },
    }),
  );
  expect(view.result.current.getDraft(key)?.content).toEqual({
    format: 'plain-text',
    text: 'after removal',
  });
  act(() => view.result.current.changeDraft(key, { content }));
  expect(
    [...view.result.current.getDraft(key)!.uploads.values()][0]?.status,
  ).toBe('ready');
});
it('late upload401 clears same private session after project navigation; clear ignores late success', async () => {
  const { view, key } = await setup();
  const pending = deferred<JournalUploadReady>();
  vi.spyOn(api, 'journalUpload').mockImplementation(() => pending.promise);
  act(() => {
    const content = view.result.current.addFiles(key, [
      new File(['synthetic'], 'sample.txt'),
    ]);
    view.result.current.changeDraft(key, { content: content!.content });
  });
  await waitFor(() => expect(api.journalUpload).toHaveBeenCalled());
  view.rerender({
    context: journalContext({
      projectId: '88888888-8888-4888-8888-888888888888',
    }),
  });
  await act(async () =>
    pending.reject(new ApiError('AUTH_REQUIRED', 'login', 401)),
  );
  expect(view.result.current.drafts.size).toBe(0);
});
it('410 rotates upload identity only on explicit retry; clear releases source and ignores old success', async () => {
  const { view, key } = await setup();
  const late = deferred<JournalUploadReady>();
  const upload = vi
    .spyOn(api, 'journalUpload')
    .mockRejectedValueOnce(new ApiError('MEDIA_UPLOAD_EXPIRED', 'expired', 410))
    .mockImplementationOnce(() => late.promise);
  act(() => {
    view.result.current.addFiles(key, [new File(['x'], 'one.txt')]);
  });
  await waitFor(() =>
    expect(
      [...view.result.current.getDraft(key)!.uploads.values()][0]?.expired,
    ).toBe(true),
  );
  const first = [...view.result.current.getDraft(key)!.uploads.values()][0]!;
  act(() => {
    void view.result.current.retryUpload(key, first.id);
  });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  const second = upload.mock.calls[1]![2];
  expect(second.uploadId).not.toBe(first.uploadId);
  expect(second.file).toBe(first.file);
  const signal = upload.mock.calls[1]![3]!;
  act(() => view.result.current.clearDraft(key));
  expect(signal.aborted).toBe(true);
  act(() => {
    view.result.current.openCreate(
      journal5.projectId,
      journal5.taskId,
      '2026-11-15',
    );
    view.result.current.changeDraft(key, { body: 'fresh draft' });
  });
  await act(async () =>
    late.resolve({
      mediaContractVersion: 1,
      uploadId: second.uploadId,
      media: {
        id: journal5.id,
        kind: 'file',
        fileName: 'one.txt',
        byteLength: 1,
        mediaType: 'application/octet-stream',
      },
    }),
  );
  expect(view.result.current.getDraft(key)?.content).toEqual({
    format: 'plain-text',
    text: 'fresh draft',
  });
  expect(view.result.current.getDraft(key)?.uploads.size).toBe(0);
});
it('keeps separate task documents, enforces two uploads and anchors task selection only while media remain', async () => {
  const { view, key } = await setup();
  const replies = [
    deferred<JournalUploadReady>(),
    deferred<JournalUploadReady>(),
    deferred<JournalUploadReady>(),
  ];
  let index = 0;
  const upload = vi
    .spyOn(api, 'journalUpload')
    .mockImplementation(() => replies[index++]!.promise);
  act(() => {
    view.result.current.addFiles(key, [
      new File(['1'], 'one.txt'),
      new File(['2'], 'two.txt'),
      new File(['3'], 'three.txt'),
    ]);
  });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  const content = view.result.current.getDraft(key)!.content;
  let otherKey: JournalDraftKey;
  act(() => {
    otherKey = view.result.current.openCreate(
      journal5.projectId,
      null,
      '2026-11-15',
    )!;
    view.result.current.changeDraft(otherKey!, {
      body: 'other document',
    });
  });
  expect(view.result.current.getDraft(key)?.content).toEqual(content);
  const first = upload.mock.calls[0]![2];
  await act(async () =>
    replies[0]!.resolve({
      mediaContractVersion: 1,
      uploadId: first.uploadId,
      media: {
        id: journal5.id,
        kind: 'file',
        fileName: 'one.txt',
        byteLength: 1,
        mediaType: 'application/octet-stream',
      },
    }),
  );
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
  expect(view.result.current.getDraft(otherKey!)?.body).toBe('other document');
  act(() =>
    view.result.current.changeDraft(key, {
      taskId: '88888888-8888-4888-8888-888888888888',
    }),
  );
  expect(view.result.current.getDraft(key)?.taskId).toBe(journal5.taskId);
  act(() => {
    view.result.current.changeDraft(key, { body: 'removed all media' });
    view.result.current.changeDraft(key, {
      taskId: '88888888-8888-4888-8888-888888888888',
    });
  });
  expect(view.result.current.getDraft(key)?.taskId).toBe(
    '88888888-8888-4888-8888-888888888888',
  );
  // Local Undo reacquires the original attachment scope; foreign IDs cannot be published.
  act(() => view.result.current.changeDraft(key, { content }));
  expect(view.result.current.getDraft(key)?.taskId).toBe(journal5.taskId);
  act(() => view.result.current.clearPrivateState());
  expect(view.result.current.drafts.size).toBe(0);
});
