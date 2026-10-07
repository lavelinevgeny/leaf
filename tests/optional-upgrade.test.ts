import {
  privateSnapshotV2Schema,
  applyPrivateSourcePatch,
} from '../src/server/optional-snapshot.js';
import { calculateSchedule } from '../src/domain/scheduling.js';
import { projectTreeV2Schema } from '../src/shared/contracts.js';
import { canonical } from '../src/shared/canonical.js';
import { replayLegacyOperation } from '../src/server/legacy-compatibility.js';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  LegacySnapshot,
  LegacyTask,
} from '../src/server/legacy-contracts.js';
import {
  resolveLegacySources,
  projectLegacySnapshot,
  adaptLegacyTree,
  resolutionKey,
} from '../src/server/legacy-compatibility.js';
import { calculateLegacySchedule } from '../src/server/legacy-scheduling.js';
import {
  previewOptionalUpgrade,
  requireOptionalUpgradeApproval,
} from '../src/server/optional-upgrade.js';
import {
  loadLegacyContexts,
  prepareOptionalMigration,
} from '../src/server/optional-migration.js';

const pid = '11111111-1111-4111-8111-111111111111';
const aid = '22222222-2222-4222-8222-222222222222';
const bid = '33333333-3333-4333-8333-333333333333';
const oid = '44444444-4444-4444-8444-444444444444';
const eid = '55555555-5555-4555-8555-555555555555';
const parentId = '66666666-6666-4666-8666-666666666666';
const stamp = '2026-10-07T00:00:00.000Z';
function task(changes: Partial<LegacyTask> = {}): LegacyTask {
  return {
    id: aid,
    projectId: pid,
    parentId: null,
    title: 'Synthetic task',
    description: '',
    sortOrder: 0,
    status: 'todo',
    planMode: 'auto',
    inputStart: null,
    inputFinish: null,
    durationDays: 3,
    notBefore: null,
    deadline: null,
    completedStart: null,
    completedFinish: null,
    completedStartIndex: null,
    completedFinishIndex: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...changes,
  };
}
function snapshot(
  tasks = [task()],
  changes: Partial<LegacySnapshot['project']> = {},
): LegacySnapshot {
  return {
    project: {
      id: pid,
      title: 'Synthetic project',
      revision: 9,
      startDate: '2026-10-05',
      calendarType: 'all-days',
      timezone: 'UTC',
      createdAt: stamp,
      updatedAt: stamp,
      ...changes,
    },
    tasks,
    dependencies: [],
  };
}
// Deliberately independent empty stored result: resolution must reproduce the
// full own legacy snapshot, never trust these unrelated saved date values.
const savedSchedule = {
  feasibility: 'incomplete' as const,
  originDate: null,
  projectFinishIndex: null,
  coverage: { knownLeafCount: 0, totalLeafCount: 0 },
  tasks: {},
  summaries: {},
  criticalTaskIds: [],
  criticalDependencyIds: [],
  diagnostics: [],
};
function project(value: LegacySnapshot) {
  const context = { kind: 'active' as const, key: pid };
  const resolutions = resolveLegacySources([{ context, snapshot: value }]);
  return {
    tree: adaptLegacyTree(
      { ...value, canUndo: true, schedule: savedSchedule },
      context,
      resolutions,
    ),
    privateSnapshot: projectLegacySnapshot(value, context, resolutions),
    resolutions,
  };
}
function fixture(run: (db: Database.Database) => void) {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE migrations(version INTEGER PRIMARY KEY) STRICT');
    for (const name of ['001-initial.sql', '002-scheduling.sql'])
      db.exec(readFileSync(`migrations/${name}`, 'utf8'));
    db.exec('INSERT INTO migrations VALUES (1),(2)');
    const value = snapshot();
    const p = value.project;
    db.prepare(
      'INSERT INTO projects(id,title,revision,startDate,calendarType,timezone,createdAt,updatedAt) VALUES (@id,@title,@revision,@startDate,@calendarType,@timezone,@createdAt,@updatedAt)',
    ).run({ ...p, revision: 10 });
    const t = value.tasks[0]!;
    db.prepare(
      `INSERT INTO tasks (${Object.keys(t).join(',')}) VALUES (${Object.keys(t)
        .map((k) => '@' + k)
        .join(',')})`,
    ).run(t);
    db.prepare('INSERT INTO account VALUES (1,?)').run('synthetic-hash');
    db.prepare('INSERT INTO sessions VALUES (?,?)').run(
      'synthetic-session',
      2000000000000,
    );
    const body = {
      expectedRevision: 8,
      operationId: oid,
      command: { type: 'task.delete', taskId: bid },
    };
    db.prepare('INSERT INTO operations VALUES (?,?,?,?,?)').run(
      oid,
      pid,
      'synthetic-session',
      canonical(body),
      JSON.stringify({
        ...snapshot(
          [
            task({
              id: bid,
              status: 'done',
              completedStartIndex: 0,
              completedFinishIndex: 3,
            }),
          ],
          { startDate: '2026-10-09', calendarType: 'weekdays' },
        ),
        canUndo: true,
        schedule: savedSchedule,
      }),
    );
    db.prepare(
      'INSERT INTO undo_snapshots(projectId,sessionId,afterRevision,beforeSnapshot) VALUES (?,?,?,?)',
    ).run(
      pid,
      'synthetic-session',
      10,
      JSON.stringify(
        snapshot(
          [
            task({
              id: bid,
              status: 'done',
              completedStartIndex: 0,
              completedFinishIndex: 3,
            }),
          ],
          { startDate: null },
        ),
      ),
    );
    run(db);
  } finally {
    db.close();
  }
}
function state(db: Database.Database) {
  return {
    schema: db
      .prepare('SELECT name,sql FROM sqlite_schema ORDER BY name')
      .all(),
    projects: db.prepare('SELECT * FROM projects').all(),
    tasks: db.prepare('SELECT * FROM tasks').all(),
    operations: db.prepare('SELECT * FROM operations').all(),
    undo: db.prepare('SELECT * FROM undo_snapshots').all(),
    versions: db.prepare('SELECT * FROM migrations').all(),
  };
}
const codes = (value: ReturnType<typeof project>) =>
  value.tree.schedule.diagnostics.map((d) => d.code);

describe('C17 production resolution, literal M01–M10', () => {
  it('M01 materializes Auto 05–07 and preserves duration', () => {
    const result = project(snapshot());
    expect(result.tree.tasks[0]).toMatchObject({
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
    });
    expect(result.tree.schedule.coverage.knownLeafCount).toBe(1);
  });
  it('M02 keeps unanchored Auto unknown', () => {
    const result = project(snapshot(undefined, { startDate: null }));
    expect(result.tree.tasks[0]).toMatchObject({
      inputStart: null,
      inputFinish: null,
      durationDays: 3,
    });
    expect(result.tree.schedule.feasibility).toBe('incomplete');
    expect(codes(result)).toContain('LEGACY_INTERVAL_UNAVAILABLE');
  });
  it('M03 materializes absolute done without requiring a project origin', () => {
    const result = project(
      snapshot(
        [
          task({
            status: 'done',
            completedStart: '2026-10-05',
            completedFinish: '2026-10-07',
          }),
        ],
        { startDate: null },
      ),
    );
    expect(result.tree.tasks[0]).toMatchObject({
      status: 'done',
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
    });
    expect(result.tree.schedule.coverage.knownLeafCount).toBe(1);
  });
  it('M04 resolves Friday relative indices using own weekday calendar', () => {
    const result = project(
      snapshot(
        [
          task({
            status: 'done',
            completedStartIndex: 0,
            completedFinishIndex: 3,
          }),
        ],
        { startDate: '2026-10-09', calendarType: 'weekdays' },
      ),
    );
    expect(result.tree.tasks[0]).toMatchObject({
      inputStart: '2026-10-09',
      inputFinish: '2026-10-13',
      durationDays: 3,
      status: 'done',
    });
  });
  it.each([false, true])(
    'M05 unavailable lock remains unknown with valid source=%s',
    (valid) => {
      const source = {
        inputStart: valid ? '2026-10-05' : null,
        inputFinish: valid ? '2026-10-07' : null,
        durationDays: 3,
      };
      const result = project(
        snapshot(
          [
            task({ id: parentId, planMode: 'unscheduled', durationDays: null }),
            task({
              ...source,
              parentId,
              status: 'done',
              completedStartIndex: 0,
              completedFinishIndex: 3,
            }),
          ],
          { startDate: null },
        ),
      );
      expect(result.tree.tasks[1]).toMatchObject({ ...source, status: 'done' });
      expect(result.tree.schedule.tasks[aid]).toEqual({
        startDate: null,
        finishDate: null,
        calendarSpanDays: null,
      });
      expect(result.tree.schedule.coverage).toEqual({
        knownLeafCount: 0,
        totalLeafCount: 1,
      });
      expect(result.tree.schedule.summaries[parentId]).toMatchObject({
        startDate: null,
        finishDate: null,
        knownLeafCount: 0,
        totalLeafCount: 1,
      });
      expect(codes(result)).toContain('LEGACY_INTERVAL_UNAVAILABLE');
    },
  );
  it('ordinary explicit done remains known', () => {
    const result = project(
      snapshot(
        [
          task({
            planMode: 'fixed',
            status: 'done',
            inputStart: '2026-10-05',
            inputFinish: '2026-10-07',
          }),
        ],
        { startDate: null },
      ),
    );
    expect(result.tree.schedule.coverage.knownLeafCount).toBe(1);
    expect(codes(result)).not.toContain('LEGACY_INTERVAL_UNAVAILABLE');
  });
  it('M06 never substitutes deadline or notBefore into ordinary sources', () => {
    const result = project(
      snapshot([
        task({
          planMode: 'unscheduled',
          inputFinish: '2026-10-06',
          durationDays: null,
          deadline: '2026-10-20',
        }),
        task({
          id: bid,
          planMode: 'unscheduled',
          durationDays: null,
          deadline: '2026-10-20',
          notBefore: '2026-10-05',
        }),
      ]),
    );
    expect(result.tree.tasks.map((t) => [t.inputStart, t.inputFinish])).toEqual(
      [
        [null, '2026-10-06'],
        [null, null],
      ],
    );
  });
  it('M07 completed pair overrides different original pair', () => {
    expect(
      project(
        snapshot([
          task({
            status: 'done',
            inputStart: '2026-10-05',
            inputFinish: '2026-10-07',
            completedStart: '2026-10-06',
            completedFinish: '2026-10-08',
          }),
        ]),
      ).tree.tasks[0],
    ).toMatchObject({
      inputStart: '2026-10-06',
      inputFinish: '2026-10-08',
      durationDays: 3,
    });
  });
  it('M08/M09 uses each historical state for a deleted task', () =>
    fixture((db) => {
      const contexts = loadLegacyContexts(db);
      const resolutions = resolveLegacySources(contexts);
      const operation = contexts.find((c) => c.context.kind === 'operation')!;
      const undo = contexts.find((c) => c.context.kind === 'undo')!;
      expect(
        projectLegacySnapshot(
          operation.snapshot,
          operation.context,
          resolutions,
        ).tasks[0],
      ).toMatchObject({
        id: bid,
        inputStart: '2026-10-09',
        inputFinish: '2026-10-13',
      });
      expect(
        projectLegacySnapshot(undo.snapshot, undo.context, resolutions)
          .tasks[0],
      ).toMatchObject({
        id: bid,
        inputStart: null,
        inputFinish: null,
        status: 'done',
      });
      expect(db.prepare('SELECT revision FROM projects').get()).toEqual({
        revision: 10,
      });
    }));
  it('M10 retains known FS-conflicting done pairs', () => {
    const value = snapshot([
      task({
        status: 'done',
        completedStart: '2026-10-05',
        completedFinish: '2026-10-07',
      }),
      task({
        id: bid,
        status: 'done',
        completedStart: '2026-10-06',
        completedFinish: '2026-10-08',
      }),
    ]);
    value.dependencies = [
      { id: eid, projectId: pid, predecessorId: aid, successorId: bid },
    ];
    const result = project(value);
    expect(result.tree.tasks.map((t) => [t.inputStart, t.inputFinish])).toEqual(
      [
        ['2026-10-05', '2026-10-07'],
        ['2026-10-06', '2026-10-08'],
      ],
    );
    expect(result.tree.schedule.feasibility).toBe('infeasible');
    expect(codes(result)).toContain('EXPLICIT_PRECEDENCE_CONFLICT');
  });
  it('retains invalid absolute done boundaries and mismatched duration', () => {
    const result = project(
      snapshot(
        [
          task({
            status: 'done',
            completedStart: '2026-10-10',
            completedFinish: '2026-10-12',
          }),
        ],
        { calendarType: 'weekdays' },
      ),
    );
    expect(result.tree.tasks[0]).toMatchObject({
      inputStart: '2026-10-10',
      inputFinish: '2026-10-12',
      durationDays: 3,
    });
    expect(codes(result)).toContain('INVALID_INTERVAL');
    expect(
      codes(
        project(
          snapshot([
            task({
              status: 'done',
              completedStart: '2026-10-05',
              completedFinish: '2026-10-06',
            }),
          ]),
        ),
      ),
    ).toContain('DURATION_MISMATCH');
  });
  it('binds every resolution to original digest and context', () => {
    const value = snapshot();
    const result = project(value);
    const resolution = result.resolutions.get(
      resolutionKey({ kind: 'active', key: pid }, aid),
    )!;
    expect(resolution.legacyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      projectLegacySnapshot(
        { ...value, tasks: [task({ durationDays: 4 })] },
        { kind: 'active', key: pid },
        result.resolutions,
      ),
    ).toThrow();
  });
  it('frozen calculator uses all edges, durations and calendar', () => {
    const value = snapshot([task(), task({ id: bid, durationDays: 2 })], {
      startDate: '2026-10-09',
      calendarType: 'weekdays',
    });
    value.dependencies = [
      { id: eid, projectId: pid, predecessorId: aid, successorId: bid },
    ];
    expect(calculateLegacySchedule(value).tasks[bid]).toMatchObject({
      startDate: '2026-10-14',
      finishDate: '2026-10-15',
      ES: 3,
      EF: 5,
    });
  });
});
describe('read-only preview and locked acknowledgement', () => {
  it('shows exact aggregate categories without exposing data', () =>
    fixture((db) => {
      const before = state(db);
      const preview = previewOptionalUpgrade(db);
      expect(preview).toEqual({
        policyId: 'legacy-scheduling-v1',
        previewDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        counts: {
          sourceIntervals: 0,
          materializedAuto: 1,
          materializedDone: 1,
          unavailableAbsolute: 1,
          replacedDoneSource: 0,
          invalid: 0,
          fsConflicts: 0,
          unavailableHistory: 1,
        },
      });
      expect(state(db)).toEqual(before);
      expect(previewOptionalUpgrade(db)).toEqual(preview);
    }));
  it('requires locked exact approval before any writes', () =>
    fixture((db) => {
      const preview = previewOptionalUpgrade(db);
      const before = state(db);
      expect(() => requireOptionalUpgradeApproval(db, preview)).toThrow();
      db.transaction(() => {
        expect(() => requireOptionalUpgradeApproval(db, undefined)).toThrow(
          'MIGRATION_APPROVAL_REQUIRED',
        );
        expect(() =>
          requireOptionalUpgradeApproval(db, {
            ...preview,
            policyId: 'wrong',
          } as never),
        ).toThrow('MIGRATION_APPROVAL_REQUIRED');
        expect(() =>
          requireOptionalUpgradeApproval(db, {
            ...preview,
            previewDigest: '0'.repeat(64),
          }),
        ).toThrow('MIGRATION_PREVIEW_CHANGED');
        expect(() => requireOptionalUpgradeApproval(db, preview)).not.toThrow();
      }).immediate();
      expect(state(db)).toEqual(before);
    }));
  it.each([
    ['source', "UPDATE tasks SET deadline='2026-10-20'"],
    ['calendar', "UPDATE projects SET calendarType='weekdays'"],
    ['revision', 'UPDATE projects SET revision=11'],
    [
      'other task source',
      `INSERT INTO tasks SELECT '${bid}',projectId,parentId,title,description,sortOrder+1,status,inputStart,inputFinish,createdAt,updatedAt,planMode,durationDays,notBefore,deadline,completedStart,completedFinish,completedStartIndex,completedFinishIndex FROM tasks`,
    ],
    ['payload', "UPDATE operations SET payload=payload || ' '"],
    ['response', "UPDATE operations SET response=response || ' '"],
    ['undo', "UPDATE undo_snapshots SET beforeSnapshot=beforeSnapshot || ' '"],
    ['undo key', 'UPDATE undo_snapshots SET sequence=12'],
    ['undo revision', 'UPDATE undo_snapshots SET afterRevision=11'],
  ])('rejects stale %s', (_name, sql) =>
    fixture((db) => {
      const preview = previewOptionalUpgrade(db);
      db.exec(sql);
      const changed = state(db);
      expect(() =>
        db
          .transaction(() => requireOptionalUpgradeApproval(db, preview))
          .immediate(),
      ).toThrow('MIGRATION_PREVIEW_CHANGED');
      expect(state(db)).toEqual(changed);
    }),
  );
  it('excludes auth and session bytes from digest', () =>
    fixture((db) => {
      const preview = previewOptionalUpgrade(db);
      db.exec(
        "UPDATE account SET passwordHash='synthetic-other'; UPDATE sessions SET expiresAt=1999999999999; UPDATE operations SET sessionId='synthetic-other'; UPDATE undo_snapshots SET sessionId='synthetic-other'",
      );
      expect(previewOptionalUpgrade(db)).toEqual(preview);
    }));
  it('archives exact history and migration rollback remains atomic', () =>
    fixture((db) => {
      const before = state(db);
      const preview = previewOptionalUpgrade(db);
      db.exec(
        "CREATE TRIGGER synthetic_abort BEFORE INSERT ON migrations WHEN NEW.version=3 BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END",
      );
      expect(() =>
        db
          .transaction(() => {
            requireOptionalUpgradeApproval(db, preview);
            prepareOptionalMigration(
              db,
              readFileSync('migrations/003-optional-scheduling.sql', 'utf8'),
              resolveLegacySources(loadLegacyContexts(db)),
            );
            db.exec('INSERT INTO migrations VALUES (3)');
          })
          .immediate(),
      ).toThrow('synthetic rollback');
      db.exec('DROP TRIGGER synthetic_abort');
      expect(state(db)).toEqual(before);
    }));
  it('digest is a full SHA256, not serialized private data', () =>
    fixture((db) => {
      const preview = previewOptionalUpgrade(db);
      expect(preview.previewDigest.length).toBe(
        createHash('sha256').update('synthetic').digest('hex').length,
      );
      expect(JSON.stringify(preview)).not.toContain('Synthetic');
    }));
});

describe('durable private unavailable provenance', () => {
  it('keeps raw FS violations ahead of incomplete and preserves known source anchors', () => {
    const value = snapshot(
      [
        task({ id: parentId, planMode: 'unscheduled', durationDays: null }),
        task({
          parentId,
          status: 'done',
          inputStart: '2026-10-05',
          inputFinish: '2026-10-07',
          completedStartIndex: 0,
          completedFinishIndex: 3,
        }),
        task({
          id: bid,
          parentId,
          planMode: 'fixed',
          inputStart: '2026-10-06',
          inputFinish: '2026-10-08',
        }),
      ],
      { startDate: null },
    );
    value.dependencies = [
      { id: eid, projectId: pid, predecessorId: aid, successorId: bid },
    ];
    const result = project(value);
    expect(result.tree.schedule.feasibility).toBe('infeasible');
    expect(codes(result)).toContain('EXPLICIT_PRECEDENCE_CONFLICT');
    expect(codes(result)).toContain('LEGACY_INTERVAL_UNAVAILABLE');
    expect(result.tree.schedule.coverage).toEqual({
      knownLeafCount: 1,
      totalLeafCount: 2,
    });
    expect(result.privateSnapshot.legacyIntervalUnavailable).toEqual([aid]);
    expect(projectTreeV2Schema.safeParse(result.tree).success).toBe(true);
    expect(result.tree).not.toHaveProperty('legacyIntervalUnavailable');
  });
  it('validates private IDs, uniqueness and project ownership independently', () => {
    const value = project(
      snapshot(
        [
          task({
            status: 'done',
            completedStartIndex: 0,
            completedFinishIndex: 3,
          }),
        ],
        { startDate: null },
      ),
    ).privateSnapshot;
    expect(
      privateSnapshotV2Schema.parse(JSON.parse(JSON.stringify(value))),
    ).toEqual(value);
    for (const invalid of [
      { ...value, legacyIntervalUnavailable: [bid] },
      { ...value, legacyIntervalUnavailable: [aid, aid] },
      { ...value, legacyIntervalUnavailable: ['invalid'] },
      { ...value, tasks: [{ ...value.tasks[0]!, projectId: bid }] },
      { ...value, unexpected: true },
    ])
      expect(privateSnapshotV2Schema.safeParse(invalid).success).toBe(false);
  });
  it('only clears on validated explicit source edits and enforces done reopen even for equal values', () => {
    const saved = project(
      snapshot(
        [
          task({
            status: 'done',
            inputStart: '2026-10-05',
            inputFinish: '2026-10-07',
            completedStartIndex: 0,
            completedFinishIndex: 3,
          }),
        ],
        { startDate: null },
      ),
    ).privateSnapshot.tasks[0]!;
    expect(
      applyPrivateSourcePatch(saved, {}, 'all-days', true).unavailable,
    ).toBe(true);
    expect(
      applyPrivateSourcePatch(saved, {}, 'all-days', true, 'todo').unavailable,
    ).toBe(true);
    expect(() =>
      applyPrivateSourcePatch(
        saved,
        { inputStart: '2026-10-05' },
        'all-days',
        true,
      ),
    ).toThrow();
    expect(
      applyPrivateSourcePatch(
        saved,
        { inputStart: '2026-10-05' },
        'all-days',
        true,
        'todo',
      ),
    ).toMatchObject({
      unavailable: false,
      task: {
        status: 'todo',
        inputStart: '2026-10-05',
        inputFinish: '2026-10-07',
        durationDays: 3,
      },
    });
    const invalid = { ...saved, inputFinish: '2026-10-06' };
    expect(() =>
      applyPrivateSourcePatch(
        invalid,
        { inputStart: '2026-10-05' },
        'all-days',
        true,
        'doing',
      ),
    ).toThrow();
    expect(
      applyPrivateSourcePatch(
        invalid,
        { inputFinish: null },
        'all-days',
        true,
        'doing',
      ),
    ).toMatchObject({
      unavailable: false,
      task: { inputStart: '2026-10-05', inputFinish: null, durationDays: 3 },
    });
  });
  it('persists active and undo markers while freezing unavailable historical replies', () =>
    fixture((db) => {
      const unresolved = task({
        status: 'done',
        planMode: 'fixed',
        inputStart: '2026-10-05',
        inputFinish: '2026-10-07',
        completedStartIndex: 0,
        completedFinishIndex: 3,
      });
      db.exec(
        "UPDATE projects SET startDate=NULL; UPDATE tasks SET status='done',planMode='fixed',inputStart='2026-10-05',inputFinish='2026-10-07',completedStartIndex=0,completedFinishIndex=3",
      );
      const historical = snapshot([unresolved], { startDate: null });
      db.prepare('UPDATE operations SET response=?').run(
        JSON.stringify({
          ...historical,
          canUndo: true,
          schedule: savedSchedule,
        }),
      );
      db.prepare('UPDATE undo_snapshots SET beforeSnapshot=?').run(
        JSON.stringify(historical),
      );
      const preview = previewOptionalUpgrade(db);
      db.transaction(() => {
        requireOptionalUpgradeApproval(db, preview);
        prepareOptionalMigration(
          db,
          readFileSync('migrations/003-optional-scheduling.sql', 'utf8'),
          resolveLegacySources(loadLegacyContexts(db)),
        );
        db.exec('INSERT INTO migrations VALUES (3)');
      }).immediate();
      expect(
        db.prepare('SELECT * FROM task_schedule_provenance').all(),
      ).toEqual([{ taskId: aid, reason: 'legacy-interval-unavailable' }]);
      const undo = privateSnapshotV2Schema.parse(
        JSON.parse(
          (
            db.prepare('SELECT beforeSnapshot FROM undo_snapshots').get() as {
              beforeSnapshot: string;
            }
          ).beforeSnapshot,
        ),
      );
      expect(undo.legacyIntervalUnavailable).toEqual([aid]);
      expect(
        calculateSchedule({
          calendarType: undo.project.calendarType,
          tasks: undo.tasks,
          dependencies: undo.dependencies,
          unavailableTaskIds: undo.legacyIntervalUnavailable,
        }).coverage.knownLeafCount,
      ).toBe(0);
      const row = db
        .prepare('SELECT response,responseSha256 FROM operations')
        .get() as { response: string; responseSha256: string };
      const reply = projectTreeV2Schema.parse(JSON.parse(row.response));
      expect(reply.project.revision).toBe(9);
      expect(reply.schedule.coverage.knownLeafCount).toBe(0);
      expect(reply.schedule.tasks[aid]).toMatchObject({
        startDate: null,
        finishDate: null,
      });
      expect(row.responseSha256).toBe(
        createHash('sha256').update(row.response).digest('hex'),
      );
      const reopened = new Database(db.serialize());
      try {
        const payload = JSON.parse(
          (
            reopened.prepare('SELECT payload FROM operations').get() as {
              payload: string;
            }
          ).payload,
        );
        const beforeReplay = state(reopened);
        expect(
          replayLegacyOperation(reopened, pid, 'synthetic-session', payload),
        ).toEqual(reply);
        expect(state(reopened)).toEqual(beforeReplay);
        expect(
          reopened.prepare('SELECT taskId FROM task_schedule_provenance').all(),
        ).toEqual([{ taskId: aid }]);
      } finally {
        reopened.close();
      }
      const archivedResolutions = db
        .prepare(
          "SELECT originalText,sha256 FROM scheduling_migration_archive WHERE kind='resolution' ORDER BY recordKey",
        )
        .all() as { originalText: string; sha256: string }[];
      expect(archivedResolutions).toHaveLength(3);
      for (const entry of archivedResolutions) {
        expect(entry.sha256).toBe(
          createHash('sha256').update(entry.originalText).digest('hex'),
        );
        expect(JSON.parse(entry.originalText)).toMatchObject({
          outcome: 'unavailable',
          source: {
            inputStart: '2026-10-05',
            inputFinish: '2026-10-07',
            durationDays: 3,
          },
        });
      }
      db.prepare('DELETE FROM tasks WHERE id=?').run(aid);
      expect(
        db.prepare('SELECT * FROM task_schedule_provenance').all(),
      ).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT count(*) AS count FROM scheduling_migration_archive WHERE kind='task'",
          )
          .get(),
      ).toEqual({ count: 1 });
      // A test-local restore exercises the persistence contract, not an active route.
      const restored = undo.tasks[0]!;
      db.prepare(
        `INSERT INTO tasks (${Object.keys(restored).join(',')}) VALUES (${Object.keys(
          restored,
        )
          .map((k) => '@' + k)
          .join(',')})`,
      ).run(restored);
      db.prepare(
        "INSERT INTO task_schedule_provenance VALUES (?,'legacy-interval-unavailable')",
      ).run(undo.legacyIntervalUnavailable[0]);
      expect(
        db.prepare('SELECT taskId FROM task_schedule_provenance').all(),
      ).toEqual([{ taskId: aid }]);
      expect(db.prepare('SELECT response FROM operations').get()).toEqual({
        response: row.response,
      });
      expect(
        db
          .prepare(
            "SELECT originalText,sha256 FROM scheduling_migration_archive WHERE kind='resolution' ORDER BY recordKey",
          )
          .all(),
      ).toEqual(archivedResolutions);
      const stable = state(db);
      db.transaction(() =>
        prepareOptionalMigration(
          db,
          readFileSync('migrations/003-optional-scheduling.sql', 'utf8'),
          new Map(),
        ),
      ).immediate();
      expect(state(db)).toEqual(stable);
    }));
});

describe('context binding and exact preview sources', () => {
  it.each([
    'origin',
    'calendar',
    'edge',
    'other-task',
    'operation',
    'undo',
  ] as const)('rejects stale context %s before DDL', (kind) =>
    fixture((db) => {
      if (kind === 'edge') {
        const other = task({ id: bid });
        db.prepare(
          `INSERT INTO tasks (${Object.keys(other).join(',')}) VALUES (${Object.keys(
            other,
          )
            .map((k) => '@' + k)
            .join(',')})`,
        ).run(other);
      }
      const resolutions = resolveLegacySources(loadLegacyContexts(db));
      if (kind === 'origin')
        db.exec("UPDATE projects SET startDate='2026-10-06'");
      if (kind === 'calendar')
        db.exec("UPDATE projects SET calendarType='weekdays'");
      if (kind === 'edge')
        db.prepare('INSERT INTO dependencies VALUES (?,?,?,?)').run(
          eid,
          pid,
          aid,
          bid,
        );
      if (kind === 'other-task') {
        const other = task({ id: bid });
        db.prepare(
          `INSERT INTO tasks (${Object.keys(other).join(',')}) VALUES (${Object.keys(
            other,
          )
            .map((k) => '@' + k)
            .join(',')})`,
        ).run(other);
      }
      if (kind === 'operation')
        db.exec(
          "UPDATE operations SET response=json_set(response,'$.project.startDate','2026-10-12')",
        );
      if (kind === 'undo')
        db.exec(
          "UPDATE undo_snapshots SET beforeSnapshot=json_set(beforeSnapshot,'$.project.calendarType','weekdays')",
        );
      const before = state(db);
      expect(() =>
        db
          .transaction(() =>
            prepareOptionalMigration(
              db,
              readFileSync('migrations/003-optional-scheduling.sql', 'utf8'),
              resolutions,
            ),
          )
          .immediate(),
      ).toThrow();
      expect(state(db)).toEqual(before);
    }),
  );
  it('digest covers exact edge identity/endpoints, operation key and raw original bytes', () =>
    fixture((db) => {
      const other = task({ id: bid });
      db.prepare(
        `INSERT INTO tasks (${Object.keys(other).join(',')}) VALUES (${Object.keys(
          other,
        )
          .map((k) => '@' + k)
          .join(',')})`,
      ).run(other);
      db.prepare('INSERT INTO dependencies VALUES (?,?,?,?)').run(
        eid,
        pid,
        aid,
        bid,
      );
      for (const mutation of [
        'UPDATE dependencies SET predecessorId=successorId,successorId=predecessorId',
        `UPDATE dependencies SET id='${parentId}'`,
        `UPDATE operations SET operationId='${parentId}',payload=json_set(payload,'$.operationId','${parentId}')`,
        "UPDATE undo_snapshots SET beforeSnapshot=beforeSnapshot || ' '",
        "UPDATE tasks SET inputStart='2026-10-05'",
        "UPDATE tasks SET completedStart='2026-10-05'",
        "UPDATE tasks SET notBefore='2026-10-06'",
      ]) {
        const preview = previewOptionalUpgrade(db);
        db.exec(mutation);
        expect(previewOptionalUpgrade(db).previewDigest).not.toBe(
          preview.previewDigest,
        );
        expect(() =>
          db
            .transaction(() => requireOptionalUpgradeApproval(db, preview))
            .immediate(),
        ).toThrow('MIGRATION_PREVIEW_CHANGED');
      }
    }));
  it('preview rejects malformed frozen envelopes and unknown source schema without writes', () =>
    fixture((db) => {
      db.exec(
        "UPDATE operations SET payload=json_set(payload,'$.contractVersion',2)",
      );
      const before = state(db);
      expect(() => previewOptionalUpgrade(db)).toThrow();
      expect(state(db)).toEqual(before);
      db.exec('INSERT INTO migrations VALUES (4)');
      const changed = state(db);
      expect(() => previewOptionalUpgrade(db)).toThrow(
        'Unsupported database schema',
      );
      expect(state(db)).toEqual(changed);
    }));
  it('preview counts replacement and independent invalid/FS outcomes', () =>
    fixture((db) => {
      db.exec(
        "DELETE FROM operations; DELETE FROM undo_snapshots; UPDATE tasks SET status='done',inputStart='2026-10-05',inputFinish='2026-10-07',completedStart='2026-10-06',completedFinish='2026-10-08'",
      );
      const other = task({
        id: bid,
        planMode: 'fixed',
        inputStart: '2026-10-07',
        inputFinish: '2026-10-09',
      });
      db.prepare(
        `INSERT INTO tasks (${Object.keys(other).join(',')}) VALUES (${Object.keys(
          other,
        )
          .map((k) => '@' + k)
          .join(',')})`,
      ).run(other);
      db.prepare('INSERT INTO dependencies VALUES (?,?,?,?)').run(
        eid,
        pid,
        aid,
        bid,
      );
      expect(previewOptionalUpgrade(db).counts).toEqual({
        sourceIntervals: 1,
        materializedAuto: 0,
        materializedDone: 1,
        unavailableAbsolute: 0,
        replacedDoneSource: 1,
        invalid: 0,
        fsConflicts: 1,
        unavailableHistory: 0,
      });
      db.exec('UPDATE tasks SET durationDays=2');
      expect(previewOptionalUpgrade(db).counts.invalid).toBe(2);
    }));
});
