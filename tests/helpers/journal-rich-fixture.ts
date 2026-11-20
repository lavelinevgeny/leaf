import { randomUUID } from 'node:crypto';
import { journalFixture } from './journal-fixture.js';
import { JournalRepositoryV2 } from '../../src/server/journal-repository-v2.js';
import { JournalMediaRepository } from '../../src/server/journal-media-repository.js';
import type { JournalContent } from '../../src/shared/journal-content.js';
export const mediaContent = (...ids: string[]): JournalContent => ({
  format: 'rich-text',
  documentVersion: 1,
  doc: {
    type: 'doc',
    content: ids.map((mediaId) => ({
      type: 'journalFile',
      attrs: { mediaId },
    })),
  },
});
export async function richFixture() {
  const f = journalFixture();
  f.db
    .prepare('INSERT INTO sessions VALUES (?,?)')
    .run('synthetic-session', Date.parse('2027-01-01T00:00:00.000Z'));
  const media = new JournalMediaRepository(f.db, f.now);
  const journal = new JournalRepositoryV2(f.db, f.now);
  const stage = (name = 'example.txt') =>
    media.stage({
      projectId: f.project.id,
      taskId: f.taskId,
      sessionId: 'synthetic-session',
      uploadId: randomUUID(),
      kind: 'file',
      fileName: name,
      bytes: Buffer.from('synthetic bytes'),
    });
  const input = (content: JournalContent, revision = 0) => ({
    journalContractVersion: 2 as const,
    operationId: randomUUID(),
    expectedJournalRevision: revision,
    taskId: f.taskId,
    workDate: '2024-02-29',
    content,
  });
  return { ...f, media, journal, stage, input };
}
