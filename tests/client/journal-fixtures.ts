import type {
  JournalEntry,
  JournalPage,
  JournalEntryRead,
} from '../../src/shared/journal-contracts.js';
import { project, task, emptySchedule } from './fixtures.js';
import type { ProjectTree } from '../../src/shared/contracts.js';
export const journal5: JournalEntry = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId: project.id,
  taskId: task(1).id,
  workDate: '2024-02-29',
  body: 'Original synthetic text',
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
};
export const tree0: ProjectTree = {
  contractVersion: 2,
  project,
  tasks: [task(1)],
  dependencies: [],
  schedule: emptySchedule,
  canUndo: false,
};
export const page5: JournalPage = {
  journalContractVersion: 1,
  projectId: project.id,
  taskId: null,
  projectRevision: 0,
  journalRevision: 5,
  entries: [journal5],
  nextCursor: null,
};
export const read6: JournalEntryRead = {
  journalContractVersion: 1,
  projectId: project.id,
  projectRevision: 0,
  journalRevision: 6,
  entry: { ...journal5, body: 'Remote text' },
};
export const renamedTree: ProjectTree = {
  ...tree0,
  project: { ...project, revision: 1 },
  tasks: [task(1, { title: 'Renamed synthetic task' })],
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
import type { JournalActiveContext } from '../../src/client/use-journal.js';
export function journalContext(
  changes: Partial<JournalActiveContext> = {},
): JournalActiveContext {
  return {
    status: 'active',
    projectId: tree0.project.id,
    taskId: null,
    today: '2026-10-09',
    projectQuery: {},
    planningTree: tree0,
    planningDirty: false,
    planningUncertain: false,
    planningBusy: false,
    applyCleanTree: () => true,
    onAuthRequired: () => {},
    ...changes,
  };
}
import { vi } from 'vitest';
import { api } from '../../src/client/api.js';
export function mockJournalApp() {
  const server = {
    tree: structuredClone(tree0),
    entries: [{ ...journal5 }],
    revision: 5,
    projects: [{ ...tree0.project }],
  };
  vi.spyOn(api, 'session').mockResolvedValue({
    authenticated: true,
    setupRequired: false,
  });
  vi.spyOn(api, 'projects').mockImplementation(async () =>
    structuredClone(server.projects),
  );
  vi.spyOn(api, 'tree').mockImplementation(async (id) =>
    structuredClone({
      ...server.tree,
      project:
        server.projects.find((project) => project.id === id) ??
        server.tree.project,
      tasks: server.tree.tasks.filter((task) => task.projectId === id),
    }),
  );
  vi.spyOn(api, 'journalProject').mockImplementation(async (id, query) => ({
    ...page5,
    projectId: id,
    projectRevision:
      server.projects.find((project) => project.id === id)?.revision ??
      server.tree.project.revision,
    journalRevision: server.revision,
    entries: server.entries.filter(
      (entry) =>
        entry.projectId === id &&
        (!query.q ||
          entry.body.toLowerCase().includes(query.q.toLowerCase())) &&
        (!query.from || entry.workDate >= query.from) &&
        (!query.to || entry.workDate <= query.to),
    ),
  }));
  vi.spyOn(api, 'journalTask').mockImplementation(async (id, taskId) => ({
    ...page5,
    projectId: id,
    taskId,
    projectRevision:
      server.projects.find((project) => project.id === id)?.revision ??
      server.tree.project.revision,
    journalRevision: server.revision,
    entries: server.entries.filter(
      (entry) => entry.projectId === id && entry.taskId === taskId,
    ),
  }));
  vi.spyOn(api, 'journalEntry').mockImplementation(async (id, entryId) => ({
    ...read6,
    projectId: id,
    journalRevision: server.revision,
    entry: server.entries.find((entry) => entry.id === entryId)!,
  }));
  vi.spyOn(api, 'journalCreate').mockImplementation(async (id, input) => {
    const entry = {
      ...journal5,
      id: '55555555-5555-4555-8555-555555555555',
      projectId: id,
      taskId: input.taskId,
      body: input.body,
      workDate: input.workDate,
    };
    server.entries.unshift(entry);
    return {
      journalContractVersion: 1,
      kind: 'saved',
      projectId: id,
      journalRevision: ++server.revision,
      entry,
    };
  });
  vi.spyOn(api, 'journalUpdate').mockImplementation(
    async (id, entryId, input) => {
      const entry = {
        ...journal5,
        id: entryId,
        body: input.body,
        workDate: input.workDate,
      };
      server.entries = server.entries.map((old) =>
        old.id === entryId ? entry : old,
      );
      return {
        journalContractVersion: 1,
        kind: 'saved',
        projectId: id,
        journalRevision: ++server.revision,
        entry,
      };
    },
  );
  vi.spyOn(api, 'journalDelete').mockImplementation(async (id, entryId) => {
    server.entries = server.entries.filter((entry) => entry.id !== entryId);
    return {
      journalContractVersion: 1,
      kind: 'deleted',
      projectId: id,
      journalRevision: ++server.revision,
      deletedEntryId: entryId,
    };
  });
  vi.spyOn(api, 'command');
  vi.spyOn(api, 'logout').mockResolvedValue({});
  return server;
}
