import { expect, it, vi } from 'vitest';
import { projectLegacyPendingSchedule } from '../src/server/legacy-pending-projection.js';
import {
  adaptLegacyTree,
  projectLegacySnapshot,
  resolveLegacySources,
} from '../src/server/legacy-compatibility.js';
import {
  frozenPendingScheduleV2Schema,
  projectTreeV2Schema,
} from '../src/shared/contracts.js';
import * as scheduling from '../src/domain/scheduling.js';
import type { LegacyPendingInput } from '../src/server/legacy-pending-types.js';
import type { LegacySnapshot } from '../src/server/legacy-contracts.js';
const p = '11111111-1111-4111-8111-111111111111';
const a = '22222222-2222-4222-8222-222222222222';
const b = '22222222-2222-4222-8222-222222222223';
const timestamp = '2026-10-07T00:00:00.000Z';
const realNull = { startDate: null, finishDate: null, calendarSpanDays: null };
const leaf = (
  id: string,
  inputStart: string | null,
  inputFinish: string | null,
  durationDays: number | null = null,
) => ({
  id,
  parentId: null,
  status: 'todo' as const,
  inputStart,
  inputFinish,
  durationDays,
});
const pending = (
  input: LegacyPendingInput,
  feasibility: 'feasible' | 'incomplete' | 'infeasible',
  tasks: Record<
    string,
    {
      startDate: string | null;
      finishDate: string | null;
      calendarSpanDays: number | null;
    }
  >,
  diagnostics: {
    code: string;
    taskIds: string[];
    dependencyIds: string[];
    messageKey: string;
  }[],
) => ({
  analysisStatus: 'pending-policy',
  feasibility,
  coverage: {
    knownLeafCount: Object.values(tasks).filter((t) => t.startDate !== null)
      .length,
    totalLeafCount: input.tasks.length,
  },
  tasks,
  summaries: {},
  display: {},
  criticalTaskIds: [],
  criticalDependencyIds: [],
  diagnostics,
});
it('initial frozen validmissing stays feasible while current live is incomplete', () => {
  const input: LegacyPendingInput = {
    calendarType: 'all-days',
    tasks: [leaf(a, '2026-10-05', '2026-10-06'), leaf(b, null, null)],
    dependencies: [],
  };
  const literal = pending(
    input,
    'feasible',
    {
      [a]: {
        startDate: '2026-10-05',
        finishDate: '2026-10-06',
        calendarSpanDays: 2,
      },
      [b]: realNull,
    },
    [],
  );
  expect(projectLegacyPendingSchedule(input)).toEqual(literal);
  expect(frozenPendingScheduleV2Schema.parse(literal)).toEqual(literal);
  const current = scheduling.calculateSchedule(input);
  expect(current.analysisStatus).toBe('incomplete');
  expect(current.diagnostics).toEqual([
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: [b],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
  ]);
});
it('initial frozen invalid source retains infeasible severity while live is unknown/incomplete', () => {
  const input: LegacyPendingInput = {
    calendarType: 'all-days',
    tasks: [leaf(a, '2026-10-05', '2026-10-06', 3)],
    dependencies: [],
  };
  const diagnostics = [
    {
      code: 'DURATION_MISMATCH',
      taskIds: [a],
      dependencyIds: [],
      messageKey: 'scheduling.DURATION_MISMATCH',
    },
  ];
  expect(projectLegacyPendingSchedule(input)).toEqual(
    pending(input, 'infeasible', { [a]: realNull }, diagnostics),
  );
  expect(scheduling.calculateSchedule(input).analysisStatus).toBe('incomplete');
});
it('initial frozen unavailable and raw FS conflict preserve their exact pending outcomes', () => {
  const unavailable: LegacyPendingInput = {
    calendarType: 'all-days',
    unavailableTaskIds: [a],
    tasks: [{ ...leaf(a, '2026-10-05', '2026-10-07', 3), status: 'done' }],
    dependencies: [],
  };
  const diagnostic = {
    code: 'LEGACY_INTERVAL_UNAVAILABLE',
    taskIds: [a],
    dependencyIds: [],
    messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
  };
  expect(projectLegacyPendingSchedule(unavailable)).toEqual(
    pending(unavailable, 'incomplete', { [a]: realNull }, [diagnostic]),
  );
  const edgeId = '33333333-3333-4333-8333-333333333333';
  const conflict: LegacyPendingInput = {
    ...unavailable,
    tasks: [...unavailable.tasks, leaf(b, '2026-10-07', '2026-10-10')],
    dependencies: [{ id: edgeId, predecessorId: a, successorId: b }],
  };
  expect(projectLegacyPendingSchedule(conflict)).toEqual(
    pending(
      conflict,
      'infeasible',
      {
        [a]: realNull,
        [b]: {
          startDate: '2026-10-07',
          finishDate: '2026-10-10',
          calendarSpanDays: 4,
        },
      },
      [
        {
          code: 'EXPLICIT_PRECEDENCE_CONFLICT',
          taskIds: [a, b],
          dependencyIds: [edgeId],
          messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
        },
        diagnostic,
      ],
    ),
  );
});
function legacyDone(relative: boolean): LegacySnapshot {
  const project: LegacySnapshot['project'] = {
    id: p,
    title: 'Synthetic initial frozen migration',
    revision: 9,
    startDate: null,
    calendarType: 'all-days',
    timezone: 'UTC',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const task: LegacySnapshot['tasks'][number] = {
    ...leaf(a, '2026-10-05', '2026-10-07', 3),
    projectId: p,
    title: 'Synthetic D',
    description: '',
    sortOrder: 0,
    status: 'done',
    planMode: 'fixed',
    notBefore: null,
    deadline: null,
    completedStart: null,
    completedFinish: null,
    completedStartIndex: relative ? 0 : null,
    completedFinishIndex: relative ? 3 : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { project, tasks: [task], dependencies: [] };
}
it.each([true, false])(
  'post-CPM initial migration consumes only frozen projection; relative=%s',
  (relative) => {
    const legacy = legacyDone(relative),
      context = { kind: 'active' as const, key: p };
    const resolutions = resolveLegacySources([{ context, snapshot: legacy }]);
    const projected = projectLegacySnapshot(legacy, context, resolutions);
    expect(projected.legacyIntervalUnavailable).toEqual(relative ? [a] : []);
    const originalLive = scheduling.calculateSchedule;
    const spy = vi
      .spyOn(scheduling, 'calculateSchedule')
      .mockImplementation(() => {
        throw new Error('Current live solver must not run');
      });
    let frozen;
    try {
      frozen = adaptLegacyTree(
        {
          ...legacy,
          canUndo: false,
          schedule: {
            feasibility: 'feasible',
            originDate: null,
            projectFinishIndex: null,
            coverage: { knownLeafCount: 0, totalLeafCount: 1 },
            tasks: {
              [a]: {
                ES: null,
                EF: null,
                LS: null,
                LF: null,
                projectFloat: null,
                constraintFloat: null,
                startDate: null,
                finishDate: null,
                blockedReason: null,
              },
            },
            summaries: {},
            criticalTaskIds: [],
            criticalDependencyIds: [],
            diagnostics: [],
          },
        },
        context,
        resolutions,
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    const literal = pending(
      { calendarType: 'all-days', tasks: projected.tasks, dependencies: [] },
      relative ? 'incomplete' : 'feasible',
      relative
        ? { [a]: realNull }
        : {
            [a]: {
              startDate: '2026-10-05',
              finishDate: '2026-10-07',
              calendarSpanDays: 3,
            },
          },
      relative
        ? [
            {
              code: 'LEGACY_INTERVAL_UNAVAILABLE',
              taskIds: [a],
              dependencyIds: [],
              messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
            },
          ]
        : [],
    );
    expect(frozen.schedule).toEqual(literal);
    expect(frozen.tasks[0]).toMatchObject({
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
      status: 'done',
    });
    expect(frozen).not.toHaveProperty('legacyIntervalUnavailable');
    expect(projectTreeV2Schema.parse(frozen)).toEqual(frozen);
    const current = originalLive({
      calendarType: 'all-days',
      tasks: projected.tasks,
      dependencies: [],
      unavailableTaskIds: projected.legacyIntervalUnavailable,
    });
    expect(current.analysisStatus).toBe(relative ? 'incomplete' : 'ready');
    if (!relative && current.analysisStatus === 'ready') {
      expect(current.tasks[a]).toMatchObject({
        projectFloat: 0,
        constraintFloat: 0,
      });
      expect(current.criticalTaskIds).toEqual([a]);
    }
  },
);

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { canonical } from '../src/shared/canonical.js';
import {
  loadLegacyContexts,
  prepareOptionalMigration,
} from '../src/server/optional-migration.js';
import { previewOptionalUpgrade } from '../src/server/optional-upgrade.js';
it('post-CPM SQL003 creates exact pending cache and durable private marker without live solver', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  try {
    db.exec('CREATE TABLE migrations(version INTEGER PRIMARY KEY) STRICT');
    for (const [file, version] of [
      ['001-initial.sql', 1],
      ['002-scheduling.sql', 2],
    ] as const) {
      db.exec(readFileSync('migrations/' + file, 'utf8'));
      db.prepare('INSERT INTO migrations(version) VALUES (?)').run(version);
    }
    const legacy = legacyDone(true);
    for (const [table, row] of [
      ['projects', legacy.project],
      ['tasks', legacy.tasks[0]!],
    ] as const) {
      const fields = Object.keys(row);
      db.prepare(
        'INSERT INTO ' +
          table +
          ' (' +
          fields.join(',') +
          ') VALUES (' +
          fields.map(() => '?').join(',') +
          ')',
      ).run(...Object.values(row));
    }
    const operationId = '44444444-4444-4444-8444-444444444444';
    const body = {
      expectedRevision: 8,
      operationId,
      command: {
        type: 'task.update',
        taskId: a,
        changes: { description: 'Synthetic archived detail' },
      },
    };
    const payload = canonical(body);
    const originalResponse = JSON.stringify({
      ...legacy,
      canUndo: false,
      schedule: {
        feasibility: 'feasible',
        originDate: null,
        projectFinishIndex: null,
        coverage: { knownLeafCount: 0, totalLeafCount: 1 },
        tasks: {
          [a]: {
            ES: null,
            EF: null,
            LS: null,
            LF: null,
            projectFloat: null,
            constraintFloat: null,
            startDate: null,
            finishDate: null,
            blockedReason: null,
          },
        },
        summaries: {},
        criticalTaskIds: [],
        criticalDependencyIds: [],
        diagnostics: [],
      },
    });
    db.prepare(
      'INSERT INTO operations(operationId,projectId,sessionId,payload,response) VALUES (?,?,?,?,?)',
    ).run(
      operationId,
      p,
      'synthetic-initial-migration-session',
      payload,
      originalResponse,
    );
    const resolutions = resolveLegacySources(loadLegacyContexts(db));
    const spy = vi
      .spyOn(scheduling, 'calculateSchedule')
      .mockImplementation(() => {
        throw new Error('Live solver must not run during migration');
      });
    try {
      const preview = previewOptionalUpgrade(db);
      expect(preview.policyId).toBe('legacy-scheduling-v1');
      expect(preview.counts).toEqual({
        sourceIntervals: 0,
        materializedAuto: 0,
        materializedDone: 0,
        unavailableAbsolute: 2,
        replacedDoneSource: 0,
        invalid: 0,
        fsConflicts: 0,
        unavailableHistory: 1,
      });
      db.transaction(() => {
        prepareOptionalMigration(
          db,
          readFileSync('migrations/003-optional-scheduling.sql', 'utf8'),
          resolutions,
        );
        db.prepare('INSERT INTO migrations(version) VALUES (3)').run();
      }).immediate();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(
      db
        .prepare(
          'SELECT taskId,reason FROM task_schedule_provenance ORDER BY taskId',
        )
        .all(),
    ).toEqual([{ taskId: a, reason: 'legacy-interval-unavailable' }]);
    expect(
      db
        .prepare(
          'SELECT inputStart,inputFinish,durationDays,status FROM tasks WHERE id=?',
        )
        .get(a),
    ).toEqual({
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
      status: 'done',
    });
    const row = db
      .prepare(
        'SELECT payload,response,responseContractVersion FROM operations WHERE operationId=?',
      )
      .get(operationId) as {
      payload: string;
      response: string;
      responseContractVersion: number;
    };
    expect(row.payload).toBe(payload);
    expect(row.responseContractVersion).toBe(2);
    const frozen = projectTreeV2Schema.parse(JSON.parse(row.response));
    expect(frozen.schedule).toEqual(
      pending(
        {
          calendarType: 'all-days',
          tasks: [leaf(a, '2026-10-05', '2026-10-07', 3)],
          dependencies: [],
        },
        'incomplete',
        { [a]: realNull },
        [
          {
            code: 'LEGACY_INTERVAL_UNAVAILABLE',
            taskIds: [a],
            dependencyIds: [],
            messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
          },
        ],
      ),
    );
    expect(frozen).not.toHaveProperty('legacyIntervalUnavailable');
    expect(
      db
        .prepare(
          "SELECT originalText FROM scheduling_migration_archive WHERE projectId=? AND kind='operation-response' AND recordKey=?",
        )
        .get(p, operationId),
    ).toEqual({ originalText: originalResponse });
    const current = scheduling.calculateSchedule({
      calendarType: 'all-days',
      tasks: frozen.tasks,
      dependencies: frozen.dependencies,
      unavailableTaskIds: [a],
    });
    expect(current.analysisStatus).toBe('incomplete');
    expect(current.tasks[a]).toMatchObject({
      startDate: null,
      finishDate: null,
      projectFloat: null,
      constraintFloat: null,
    });
  } finally {
    db.close();
  }
});
