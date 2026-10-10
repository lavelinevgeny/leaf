import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../src/client/api.js';
import { page5, journal5, read6 } from './journal-fixtures.js';
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
    journalContractVersion: 1 as const,
    operationId: journal5.id,
    expectedJournalRevision: 5,
    body: '  synthetic\n\0 ',
    workDate: '2024-02-29',
    taskId: journal5.taskId,
  };
  await expect(api.journalCreate(page5.projectId, input)).rejects.toMatchObject(
    { uncertain: true },
  );
  expect(fetch.mock.calls[0]?.[1].body).toBe(JSON.stringify(input));
});
