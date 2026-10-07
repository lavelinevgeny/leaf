import type { Project, ProjectTree, Task } from '../../src/shared/contracts.js';
export const project: Project = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Демо-проект',
  revision: 0,

  calendarType: 'weekdays',
  timezone: 'UTC',
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
};
export const task = (n: number, changes: Partial<Task> = {}): Task => ({
  id: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`,
  projectId: project.id,
  parentId: null,
  sortOrder: n,
  title: `Работа ${n}`,
  description: '',
  status: 'todo',

  durationDays: null,
  inputStart: null,
  inputFinish: null,

  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  ...changes,
});
export const emptySchedule: ProjectTree['schedule'] = {
  analysisStatus: 'pending-policy',
  display: {},
  feasibility: 'feasible',

  coverage: { knownLeafCount: 0, totalLeafCount: 0 },
  tasks: {},
  summaries: {},
  criticalTaskIds: [],
  criticalDependencyIds: [],
  diagnostics: [],
};
export const computed = (
  startDate = '2026-10-09',
  finishDate = '2026-10-12',
) => ({ startDate, finishDate, calendarSpanDays: 2 });
export const optionalIds = {
  project: '11111111-1111-4111-8111-111111111111',
  p: '22222222-2222-4222-8222-222222222221',
  a: '22222222-2222-4222-8222-222222222222',
  c: '22222222-2222-4222-8222-222222222223',
};
export function optionalTreeFixture(): ProjectTree {
  return {
    contractVersion: 2,
    project: { ...project },
    canUndo: false,
    dependencies: [],
    tasks: [
      task(1, { id: optionalIds.p, title: 'Этап P' }),
      task(2, {
        id: optionalIds.a,
        title: 'Работа A',
        parentId: optionalIds.p,
        inputStart: '2026-10-05',
        inputFinish: '2026-10-06',
      }),
      task(3, {
        id: optionalIds.c,
        title: 'Работа C',
        parentId: optionalIds.p,
        durationDays: 3,
      }),
    ],
    schedule: {
      analysisStatus: 'pending-policy',
      feasibility: 'feasible',
      coverage: { knownLeafCount: 1, totalLeafCount: 2 },
      tasks: {
        [optionalIds.a]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-06',
          calendarSpanDays: 2,
        },
        [optionalIds.c]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
        },
      },
      summaries: {
        [optionalIds.p]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
          knownLeafCount: 1,
          totalLeafCount: 2,
        },
      },
      display: {
        [optionalIds.c]: {
          kind: 'conditional',
          startDate: '2026-10-05',
          finishDate: '2026-10-07',
          clipped: false,
        },
      },
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [],
    },
  };
}
