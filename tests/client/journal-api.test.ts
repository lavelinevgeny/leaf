import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../src/client/api.js';
import { page5, journal5, read6 } from './journal-fixtures.js';
import type { LegacyJournalRetry } from '../../src/client/api.js';
afterEach(() => vi.unstubAllGlobals());
it('encodes only query fields and sends contract2/same-origin without legacy header', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page5)));
  vi.stubGlobal('fetch', fetch);
  await api.journalProject(page5.projectId, {
    q: '% _ + Ж',
    from: '2024-02-29',
    limit: 20,
  });
  expect(fetch.mock.calls[0]?.[0]).toBe(
    `/api/projects/${page5.projectId}/journal?q=%25+_+%2B+%D0%96&from=2024-02-29&limit=20`,
  );
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    credentials: 'same-origin',
    headers: { 'X-Leaf-Contract-Version': '2' },
  });
  expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty(
    'X-Leaf-Legacy-Replay',
  );
});
it('entry read has no query and strictly rejects unknown response fields', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(read6)))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...page5, extra: true })),
    );
  vi.stubGlobal('fetch', fetch);
  await api.journalEntry(page5.projectId, journal5.id);
  expect(fetch.mock.calls[0]?.[0]).toBe(
    `/api/projects/${page5.projectId}/journal/${journal5.id}`,
  );
  await expect(api.journalProject(page5.projectId, {})).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});
it('network failure preserves exact write input and reports uncertainty', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError());
  vi.stubGlobal('fetch', fetch);
  const input = {
    journalContractVersion: 2 as const,
    operationId: journal5.id,
    expectedJournalRevision: 5,
    content: { format: 'plain-text' as const, text: '  synthetic\n\0 ' },
    workDate: '2024-02-29',
    taskId: journal5.taskId,
  };
  await expect(api.journalCreate(page5.projectId, input)).rejects.toMatchObject(
    { uncertain: true },
  );
  expect(fetch.mock.calls[0]?.[1].body).toBe(JSON.stringify(input));
});
it('keeps frozen1 validation separate and rejects its acknowledgement for a live rich2 write', async () => {
  const { journalMutationSchema } =
    await import('../../src/shared/journal-contracts.js');
  const {
    content: ignoredContent,
    media: ignoredMedia,
    ...legacyEntry
  } = journal5;
  void ignoredContent;
  void ignoredMedia;
  const legacy = {
    journalContractVersion: 1,
    kind: 'saved',
    projectId: journal5.projectId,
    journalRevision: 6,
    entry: legacyEntry,
  };
  expect(journalMutationSchema.safeParse(legacy).success).toBe(true);
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(legacy)));
  vi.stubGlobal('fetch', fetch);
  await expect(
    api.journalCreate(journal5.projectId, {
      journalContractVersion: 2,
      operationId: journal5.id,
      expectedJournalRevision: 5,
      taskId: journal5.taskId,
      workDate: journal5.workDate,
      content: {
        format: 'rich-text',
        documentVersion: 1,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'rich', marks: [{ type: 'bold' }] },
              ],
            },
          ],
        },
      },
    }),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', uncertain: true });
  expect(fetch.mock.calls[0]![1].headers).toMatchObject({
    'X-Leaf-Contract-Version': '2',
    'X-Leaf-Journal-Contract-Version': '2',
  });
});
it('uploads exact multipart source with same-origin credentials and no JSON content type', async () => {
  const media = {
    id: journal5.id,
    kind: 'file',
    fileName: 'sample.txt',
    byteLength: 1,
    mediaType: 'application/octet-stream',
  };
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        mediaContractVersion: 1,
        uploadId: journal5.id,
        media,
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const file = new File(['x'], 'sample.txt', { type: 'text/plain' });
  await api.journalUpload(journal5.projectId, journal5.taskId, {
    uploadId: journal5.id,
    kind: 'file',
    file,
  });
  const options = fetch.mock.calls[0]![1];
  expect(options.credentials).toBe('same-origin');
  expect(options.headers).not.toHaveProperty('Content-Type');
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.body.get('uploadId')).toBe(journal5.id);
  expect(options.body.get('kind')).toBe('file');
  expect(options.body.get('file')).toBe(file);
});

const frozenEntry = {
  id: journal5.id,
  projectId: journal5.projectId,
  taskId: journal5.taskId,
  workDate: '2024-02-29',
  body: '  <img> **literal**\r\n\0 ',
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
};
const frozenSaved = {
  journalContractVersion: 1,
  kind: 'saved',
  projectId: journal5.projectId,
  journalRevision: 6,
  entry: frozenEntry,
};
const legacyCreate = {
  journalContractVersion: 1 as const,
  operationId: journal5.id,
  expectedJournalRevision: 5,
  taskId: journal5.taskId,
  workDate: frozenEntry.workDate,
  body: frozenEntry.body,
};
const legacyUpdate = {
  journalContractVersion: 1 as const,
  operationId: journal5.id,
  expectedJournalRevision: 5,
  workDate: frozenEntry.workDate,
  body: frozenEntry.body,
};
const legacyDelete = {
  journalContractVersion: 1 as const,
  operationId: journal5.id,
  expectedJournalRevision: 5,
};
const legacyRetries: LegacyJournalRetry[] = [
  { method: 'POST', input: legacyCreate },
  {
    method: 'PATCH',
    entryId: journal5.id,
    taskId: journal5.taskId,
    input: legacyUpdate,
  },
  { method: 'DELETE', entryId: journal5.id, input: legacyDelete },
];
it.each(legacyRetries)(
  'reads frozen1 exact $method retry with original payload and no journal2 header',
  async (retry) => {
    const ack =
      retry.method === 'DELETE'
        ? {
            journalContractVersion: 1,
            kind: 'deleted',
            projectId: journal5.projectId,
            journalRevision: 6,
            deletedEntryId: journal5.id,
          }
        : frozenSaved;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(ack)));
    vi.stubGlobal('fetch', fetch);
    expect(await api.journalReplayLegacy(journal5.projectId, retry)).toEqual(
      ack,
    );
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe(
      `/api/projects/${journal5.projectId}/journal${retry.method === 'POST' ? '' : `/${retry.entryId}`}`,
    );
    expect(options).toMatchObject({
      method: retry.method,
      credentials: 'same-origin',
      body: JSON.stringify(retry.input),
    });
    expect(options.headers).toEqual({
      'X-Leaf-Contract-Version': '2',
      'Content-Type': 'application/json',
    });
  },
);
it('rejects corrupted, wrong-version and mismatched frozen1 acknowledgements', async () => {
  const foreign = '99999999-9999-4999-8999-999999999999';
  const badAcks = [
    { ...frozenSaved, extra: true },
    { ...frozenSaved, journalContractVersion: 2 },
    { ...frozenSaved, projectId: foreign },
    { ...frozenSaved, journalRevision: 7 },
    { ...frozenSaved, entry: { ...frozenEntry, projectId: foreign } },
    { ...frozenSaved, entry: { ...frozenEntry, taskId: foreign } },
    { ...frozenSaved, entry: { ...frozenEntry, body: 'changed' } },
    { ...frozenSaved, entry: { ...frozenEntry, workDate: '2024-03-01' } },
    { ...frozenSaved, entry: { ...frozenEntry, id: foreign } },
    {
      ...frozenSaved,
      kind: 'deleted',
      entry: undefined,
      deletedEntryId: journal5.id,
    },
  ];
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (const ack of badAcks) {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(ack)));
    await expect(
      api.journalReplayLegacy(journal5.projectId, legacyRetries[1]!),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', uncertain: true });
  }
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(frozenSaved)));
  await expect(
    api.journalReplayLegacy(journal5.projectId, legacyRetries[2]!),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', uncertain: true });
  fetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        journalContractVersion: 1,
        kind: 'deleted',
        projectId: journal5.projectId,
        journalRevision: 6,
        deletedEntryId: foreign,
      }),
    ),
  );
  await expect(
    api.journalReplayLegacy(journal5.projectId, legacyRetries[2]!),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', uncertain: true });
});
