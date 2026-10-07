import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonical } from '../src/shared/canonical.js';
import {
  projectTreeV2Schema,
  snapshotV2Schema,
} from '../src/shared/optional-contracts.js';
import {
  replayLegacyOperation,
  resolutionKey,
  type LegacyResolution,
  type ResolutionIndex,
} from '../src/server/legacy-compatibility.js';
import {
  loadLegacyContexts,
  migrationCategoryCounts,
  prepareOptionalMigration,
} from '../src/server/optional-migration.js';
import { openDatabase } from '../src/server/database.js';
import { DomainError } from '../src/domain/tree.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const aId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const bId = '44444444-4444-4444-8444-444444444444';
const parentId = '55555555-5555-4555-8555-555555555555';
const dId = '66666666-6666-4666-8666-666666666666';
const edgeId = '77777777-7777-4777-8777-777777777777';
const sessionId = 'synthetic-compatibility-session';
const timestamp = '2026-10-07T00:00:00.000Z';
const task = {
  id: aId,
  projectId,
  parentId: null,
  title: 'Synthetic A',
  description: '',
  sortOrder: 0,
  status: 'todo' as const,
  planMode: 'unscheduled' as const,
  inputStart: null,
  inputFinish: '2026-10-06',
  durationDays: null,
  notBefore: null,
  deadline: '2026-10-20',
  completedStart: null,
  completedFinish: null,
  completedStartIndex: null,
  completedFinishIndex: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const project = {
  id: projectId,
  title: 'Synthetic project',
  revision: 10,
  startDate: '2026-10-05',
  calendarType: 'all-days' as const,
  timezone: 'UTC',
  createdAt: timestamp,
  updatedAt: timestamp,
};
const legacyBody = {
  expectedRevision: 8,
  operationId,
  command: {
    type: 'task.plan',
    taskId: aId,
    plan: {
      mode: 'unscheduled',
      inputFinish: '2026-10-06',
      deadline: '2026-10-20',
    },
  },
};
const tree = {
  project: { ...project, revision: 9 },
  tasks: [task],
  dependencies: [],
  canUndo: true,
  schedule: {
    feasibility: 'feasible' as const,
    originDate: '2026-10-05',
    projectFinishIndex: null,
    coverage: { knownLeafCount: 0, totalLeafCount: 1 },
    tasks: {
      [aId]: {
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
};
const originalResponse = JSON.stringify(tree);
const originalPayload = canonical(legacyBody);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const sql = () =>
  readFileSync('migrations/003-optional-scheduling.sql', 'utf8');
function insertTask(db: Database.Database, value: object) {
  db.prepare(
    'INSERT INTO tasks(id,projectId,parentId,title,description,sortOrder,status,planMode,inputStart,inputFinish,durationDays,notBefore,deadline,completedStart,completedFinish,completedStartIndex,completedFinishIndex,createdAt,updatedAt) VALUES (@id,@projectId,@parentId,@title,@description,@sortOrder,@status,@planMode,@inputStart,@inputFinish,@durationDays,@notBefore,@deadline,@completedStart,@completedFinish,@completedStartIndex,@completedFinishIndex,@createdAt,@updatedAt)',
  ).run(value);
}
function fixture(run: (db: Database.Database, path: string) => void) {
  const directory = mkdtempSync(
    join(tmpdir(), 'leaf-optional-migration-synthetic-'),
  );
  const path = join(directory, 'synthetic.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE migrations (version INTEGER PRIMARY KEY) STRICT');
    db.exec(readFileSync('migrations/001-initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/002-scheduling.sql', 'utf8'));
    db.prepare('INSERT INTO migrations(version) VALUES (?)').run(1);
    db.prepare('INSERT INTO migrations(version) VALUES (?)').run(2);
    db.prepare(
      'INSERT INTO projects(id,title,revision,startDate,calendarType,timezone,createdAt,updatedAt) VALUES (@id,@title,@revision,@startDate,@calendarType,@timezone,@createdAt,@updatedAt)',
    ).run(project);
    db.prepare('INSERT INTO account VALUES (1, ?)').run(
      'synthetic-placeholder-only',
    );
    db.prepare('INSERT INTO sessions VALUES (?, ?)').run(
      sessionId,
      2000000000000,
    );
    insertTask(db, {
      ...task,
      id: parentId,
      title: 'Synthetic parent',
      inputFinish: null,
    });
    insertTask(db, { ...task, parentId });
    insertTask(db, {
      ...task,
      id: bId,
      title: 'Synthetic B',
      parentId,
      sortOrder: 1,
      inputFinish: null,
    });
    db.prepare('INSERT INTO dependencies VALUES (?,?,?,?)').run(
      edgeId,
      projectId,
      aId,
      bId,
    );
    db.prepare(
      'INSERT INTO operations(operationId,projectId,sessionId,payload,response) VALUES (?,?,?,?,?)',
    ).run(operationId, projectId, sessionId, originalPayload, originalResponse);
    const beforeSnapshot = JSON.stringify({
      project: { ...project, revision: 8 },
      tasks: [
        {
          ...task,
          id: dId,
          title: 'Synthetic deleted D',
          status: 'done',
          completedStartIndex: 0,
          completedFinishIndex: 3,
          inputFinish: null,
          durationDays: 3,
        },
      ],
      dependencies: [],
    });
    db.prepare(
      'INSERT INTO undo_snapshots(projectId,sessionId,afterRevision,beforeSnapshot) VALUES (?,?,?,?)',
    ).run(projectId, sessionId, 10, beforeSnapshot);
    run(db, path);
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
function resolutions(db: Database.Database): ResolutionIndex {
  const index = new Map<string, LegacyResolution>();
  for (const { context, snapshot } of loadLegacyContexts(db)) {
    for (const item of snapshot.tasks) {
      if (
        item.planMode !== 'auto' &&
        !(
          item.status === 'done' &&
          [
            item.completedStart,
            item.completedFinish,
            item.completedStartIndex,
            item.completedFinishIndex,
          ].some((value) => value !== null)
        )
      )
        continue;
      // Independent synthetic M04/M07 source matrix, no production resolver.
      const source =
        item.completedStart !== null && item.completedFinish !== null
          ? {
              inputStart: item.completedStart,
              inputFinish: item.completedFinish,
              durationDays: item.durationDays,
            }
          : {
              inputStart: '2026-10-05',
              inputFinish: '2026-10-07',
              durationDays: item.durationDays,
            };
      index.set(resolutionKey(context, item.id), {
        context,
        taskId: item.id,
        legacyDigest: sha(canonical(item)),
        source,
      });
    }
  }
  return index;
}
function migrate(
  db: Database.Database,
  index = resolutions(db),
  migrationSql = sql(),
) {
  db.transaction(() => {
    prepareOptionalMigration(db, migrationSql, index);
    db.prepare('INSERT INTO migrations(version) VALUES (3)').run();
  }).immediate();
}
function archive(db: Database.Database, kind: string, recordKey: string) {
  return db
    .prepare(
      'SELECT originalText,sha256,sourceSchemaVersion FROM scheduling_migration_archive WHERE projectId=? AND kind=? AND recordKey=?',
    )
    .get(projectId, kind, recordKey) as {
    originalText: string;
    sha256: string;
    sourceSchemaVersion: number;
  };
}
function state(db: Database.Database) {
  return {
    schema: db
      .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name')
      .all(),
    projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
    tasks: db.prepare('SELECT * FROM tasks ORDER BY id').all(),
    dependencies: db.prepare('SELECT * FROM dependencies ORDER BY id').all(),
    operations: db
      .prepare('SELECT * FROM operations ORDER BY operationId')
      .all(),
    undo: db.prepare('SELECT * FROM undo_snapshots ORDER BY sequence').all(),
    versions: db.prepare('SELECT * FROM migrations ORDER BY version').all(),
  };
}
function counts(db: Database.Database) {
  return ['tasks', 'dependencies', 'operations', 'undo_snapshots'].map(
    (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
  );
}

describe('synthetic optional scheduling preparation', () => {
  it('archives exact originals, projects source-only rows, preserves counts/auth/relations and deleted undo D', () =>
    fixture((db) => {
      const beforeCounts = counts(db);
      const authBefore = [
        db.prepare('SELECT * FROM account').all(),
        db.prepare('SELECT * FROM sessions').all(),
      ];
      const before = state(db);
      const undoText = (before.undo[0] as { beforeSnapshot: string })
        .beforeSnapshot;
      migrate(db);
      expect(counts(db)).toEqual(beforeCounts);
      expect([
        db.prepare('SELECT * FROM account').all(),
        db.prepare('SELECT * FROM sessions').all(),
      ]).toEqual(authBefore);
      expect(
        db.prepare('SELECT * FROM dependencies ORDER BY id').all(),
      ).toEqual(before.dependencies);
      expect(archive(db, 'operation-response', operationId)).toEqual({
        originalText: originalResponse,
        sha256: sha(originalResponse),
        sourceSchemaVersion: 2,
      });
      expect(archive(db, 'operation-payload', operationId)).toEqual({
        originalText: originalPayload,
        sha256: sha(originalPayload),
        sourceSchemaVersion: 2,
      });
      expect(archive(db, 'undo-snapshot', '1').originalText).toBe(undoText);
      for (const row of before.projects as { id: string }[])
        expect(JSON.parse(archive(db, 'project', row.id).originalText)).toEqual(
          row,
        );
      for (const row of before.tasks as { id: string }[])
        expect(JSON.parse(archive(db, 'task', row.id).originalText)).toEqual(
          row,
        );
      expect(
        db
          .prepare(
            'SELECT id,parentId,sortOrder,inputStart,inputFinish,durationDays FROM tasks ORDER BY id',
          )
          .all(),
      ).toEqual([
        {
          id: aId,
          parentId,
          sortOrder: 0,
          inputStart: null,
          inputFinish: '2026-10-06',
          durationDays: null,
        },
        {
          id: bId,
          parentId,
          sortOrder: 1,
          inputStart: null,
          inputFinish: null,
          durationDays: null,
        },
        {
          id: parentId,
          parentId: null,
          sortOrder: 0,
          inputStart: null,
          inputFinish: null,
          durationDays: null,
        },
      ]);
      const migratedUndo = JSON.parse(
        (
          db.prepare('SELECT beforeSnapshot FROM undo_snapshots').get() as {
            beforeSnapshot: string;
          }
        ).beforeSnapshot,
      );
      expect(snapshotV2Schema.safeParse(migratedUndo).success).toBe(true);
      expect(migratedUndo.tasks[0]).toMatchObject({
        id: dId,
        status: 'done',
        inputStart: '2026-10-05',
        inputFinish: '2026-10-07',
        durationDays: 3,
      });
      // Synthetic restore of the migrated snapshot exercises the target row shape.
      db.transaction(() =>
        insertTaskTarget(db, migratedUndo.tasks[0]),
      ).immediate();
      expect(
        db
          .prepare('SELECT status,inputStart,inputFinish FROM tasks WHERE id=?')
          .get(dId),
      ).toEqual({
        status: 'done',
        inputStart: '2026-10-05',
        inputFinish: '2026-10-07',
      });
      db.prepare('DELETE FROM tasks WHERE id=?').run(dId);
      db.prepare('DELETE FROM dependencies').run();
      db.prepare('DELETE FROM tasks WHERE id=?').run(aId);
      expect(archive(db, 'task', aId).sha256).toBe(
        sha(archive(db, 'task', aId).originalText),
      );
      expect(archive(db, 'undo-snapshot', '1').originalText).toBe(undoText);
      expect(
        (db.pragma('table_info(tasks)') as { name: string }[])
          .map((row) => row.name)
          .sort(),
      ).toEqual([
        'createdAt',
        'description',
        'durationDays',
        'id',
        'inputFinish',
        'inputStart',
        'parentId',
        'projectId',
        'sortOrder',
        'status',
        'title',
        'updatedAt',
      ]);
    }));
  it('M08 replays the frozen revision9 after restart without current tree, resolver, mutation or new history', () =>
    fixture((db, path) => {
      migrate(db);
      const cached = db.prepare('SELECT * FROM operations').get() as {
        response: string;
        payload: string;
        contractVersion: number;
        responseContractVersion: number;
        responseSha256: string;
      };
      expect(cached).toMatchObject({
        payload: originalPayload,
        contractVersion: 1,
        responseContractVersion: 2,
        responseSha256: sha(cached.response),
      });
      expect(
        projectTreeV2Schema.safeParse(JSON.parse(cached.response)).success,
      ).toBe(true);
      const before = state(db);
      expect(
        replayLegacyOperation(db, projectId, sessionId, {
          command: legacyBody.command,
          operationId,
          expectedRevision: 8,
        }),
      ).toMatchObject({ project: { revision: 9 }, canUndo: true });
      expect(state(db)).toEqual(before);
      db.close();
      const reopened = new Database(path);
      try {
        reopened
          .prepare('UPDATE projects SET calendarType=?, revision=11')
          .run('weekdays');
        reopened
          .prepare('UPDATE tasks SET inputStart=?,inputFinish=? WHERE id=?')
          .run('2026-10-12', '2026-10-13', aId);
        const beforeReplay = state(reopened);
        const replay = replayLegacyOperation(
          reopened,
          projectId,
          sessionId,
          legacyBody,
        );
        expect(replay).toEqual(JSON.parse(cached.response));
        expect(replay.schedule.analysisStatus).toBe('pending-policy');
        expect(state(reopened)).toEqual(beforeReplay);
        const frozenArchive = reopened
          .prepare(
            'SELECT * FROM scheduling_migration_archive ORDER BY projectId,kind,recordKey',
          )
          .all();
        reopened
          .transaction(() =>
            prepareOptionalMigration(reopened, sql(), new Map()),
          )
          .immediate();
        expect(state(reopened)).toEqual(beforeReplay);
        expect(
          reopened
            .prepare(
              'SELECT * FROM scheduling_migration_archive ORDER BY projectId,kind,recordKey',
            )
            .all(),
        ).toEqual(frozenArchive);
      } finally {
        reopened.close();
      }
      expect(() => openDatabase(path)).toThrowError(/schema/);
    }));
  it('lookup-only replay rejects changed payload/project/session/version and unknown operations', () =>
    fixture((db) => {
      migrate(db);
      const before = state(db);
      for (const [pid, sid, body] of [
        [bId, sessionId, legacyBody],
        [projectId, 'synthetic-other-session', legacyBody],
        [projectId, sessionId, { ...legacyBody, extra: true }],
        [projectId, sessionId, { ...legacyBody, contractVersion: 2 }],
        [projectId, sessionId, { ...legacyBody, command: { type: 'undo' } }],
      ] as const)
        expect(() => replayLegacyOperation(db, pid, sid, body)).toThrowError(
          'Идентификатор операции уже использован.',
        );
      expect(() =>
        replayLegacyOperation(db, projectId, sessionId, {
          operationId: bId,
          command: { type: 'synthetic-unknown' },
        }),
      ).toThrowError(
        'Прежняя операция не найдена. Проверьте актуальный проект.',
      );
      expect(state(db)).toEqual(before);
      db.prepare('UPDATE operations SET contractVersion=2').run();
      expect(() =>
        replayLegacyOperation(db, projectId, sessionId, legacyBody),
      ).toThrowError(
        'Прежняя операция не найдена. Проверьте актуальный проект.',
      );
    }));
  it('replays original rename envelopes without normalization or stripped fields', () =>
    fixture((db) => {
      const rename = {
        title: ' Synthetic renamed ',
        operationId,
        expectedRevision: 8,
      };
      db.prepare('UPDATE operations SET payload=?').run(canonical(rename));
      migrate(db);
      expect(
        replayLegacyOperation(db, projectId, sessionId, rename).project
          .revision,
      ).toBe(9);
      expect(() =>
        replayLegacyOperation(db, projectId, sessionId, {
          ...rename,
          title: 'Synthetic renamed',
        }),
      ).toThrowError('Идентификатор операции уже использован.');
    }));
  it.each(['digest', 'json', 'schema', 'version'])(
    'fails internally on frozen response %s corruption',
    (corruption) =>
      fixture((db) => {
        migrate(db);
        if (corruption === 'version') {
          // Deliberately corrupt a disposable fixture; production constraints stay enabled.
          db.pragma('ignore_check_constraints = ON');
          db.prepare('UPDATE operations SET responseContractVersion=1').run();
        } else {
          const response =
            corruption === 'json'
              ? '{'
              : JSON.stringify({ contractVersion: 99 });
          db.prepare('UPDATE operations SET response=?,responseSha256=?').run(
            response,
            corruption === 'digest' ? '0'.repeat(64) : sha(response),
          );
        }
        expect(() =>
          replayLegacyOperation(db, projectId, sessionId, legacyBody),
        ).toThrowError('Invalid frozen operation response');
      }),
  );
  it('binds Auto/done resolutions to all current/operation/undo contexts and counts history', () =>
    fixture((db) => {
      const current = {
        ...task,
        planMode: 'auto',
        inputFinish: null,
        durationDays: 3,
      };
      db.prepare(
        'UPDATE tasks SET planMode=?,inputFinish=NULL,durationDays=3 WHERE id=?',
      ).run('auto', aId);
      const historical = {
        ...task,
        status: 'done',
        inputStart: '2026-10-05',
        inputFinish: '2026-10-07',
        durationDays: 3,
        completedStart: '2026-10-06',
        completedFinish: '2026-10-08',
      };
      const response = JSON.stringify({ ...tree, tasks: [historical] });
      db.prepare('UPDATE operations SET response=?').run(response);
      expect(loadLegacyContexts(db).map(({ context }) => context)).toEqual([
        { kind: 'active', key: projectId },
        { kind: 'operation', key: operationId },
        { kind: 'undo', key: '1' },
      ]);
      expect(migrationCategoryCounts(db)).toEqual({
        auto: 1,
        completedAbsolute: 1,
        completedRelative: 1,
        inconsistent: 0,
      });
      const index = resolutions(db);
      const before = state(db);
      for (const omitted of index.keys()) {
        const missing = new Map(index);
        missing.delete(omitted);
        expect(() => migrate(db, missing)).toThrowError(
          'Требуется согласованная политика переноса прежнего плана.',
        );
        expect(state(db)).toEqual(before);
      }
      const wrong = new Map(index);
      const key = resolutionKey({ kind: 'active', key: projectId }, aId);
      wrong.set(key, {
        ...wrong.get(key)!,
        legacyDigest: sha(canonical({ ...current, durationDays: 4 })),
      });
      expect(() => migrate(db, wrong)).toThrowError(
        'Требуется согласованная политика переноса прежнего плана.',
      );
      expect(state(db)).toEqual(before);
      const extra = new Map(index);
      extra.set('unmatched', index.values().next().value!);
      expect(() => migrate(db, extra)).toThrowError(
        'Требуется согласованная политика переноса прежнего плана.',
      );
      expect(state(db)).toEqual(before);
      migrate(db, index);
      expect(
        db
          .prepare('SELECT inputStart,inputFinish FROM tasks WHERE id=?')
          .get(aId),
      ).toEqual({ inputStart: '2026-10-05', inputFinish: '2026-10-07' });
      expect(
        replayLegacyOperation(db, projectId, sessionId, legacyBody).tasks[0],
      ).toMatchObject({
        status: 'done',
        inputStart: '2026-10-06',
        inputFinish: '2026-10-08',
      });
      expect(archive(db, 'operation-response', operationId).originalText).toBe(
        response,
      );
    }));
  it.each([
    'response-json',
    'response-version',
    'undo-json',
    'undo-schema',
    'payload-json',
    'active-schema',
  ])('rejects invalid original %s before DDL or updates', (corruption) =>
    fixture((db) => {
      if (corruption === 'response-json')
        db.prepare('UPDATE operations SET response=?').run('{');
      if (corruption === 'response-version')
        db.prepare('UPDATE operations SET response=?').run(
          JSON.stringify({ ...tree, contractVersion: 99 }),
        );
      if (corruption === 'undo-json')
        db.prepare('UPDATE undo_snapshots SET beforeSnapshot=?').run('{');
      if (corruption === 'undo-schema')
        db.prepare('UPDATE undo_snapshots SET beforeSnapshot=?').run(
          JSON.stringify({
            project,
            tasks: [{ ...task, planMode: 'synthetic-unknown' }],
            dependencies: [],
          }),
        );
      if (corruption === 'payload-json')
        db.prepare('UPDATE operations SET payload=?').run('{');
      if (corruption === 'active-schema')
        db.prepare('UPDATE tasks SET inputStart=? WHERE id=?').run(
          '2026-02-30',
          aId,
        );
      const before = state(db);
      expect(() => migrate(db, new Map())).toThrowError(
        'Неверный прежний снимок плана.',
      );
      expect(state(db)).toEqual(before);
    }),
  );
  it('rolls back archive, column drops, projections, histories and version when outer insert aborts', () =>
    fixture((db) => {
      db.exec(
        "CREATE TRIGGER synthetic_migration_failure BEFORE INSERT ON migrations WHEN NEW.version=3 BEGIN SELECT RAISE(ABORT, 'Synthetic migration failure'); END",
      );
      const before = state(db);
      expect(() => migrate(db)).toThrowError('Synthetic migration failure');
      expect(state(db)).toEqual(before);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='scheduling_migration_archive'",
          )
          .get(),
      ).toBeUndefined();
    }));
  it('requires an outer transaction and exact reviewed SQL with one boundary', () =>
    fixture((db) => {
      const before = state(db);
      expect(() =>
        prepareOptionalMigration(db, sql(), resolutions(db)),
      ).toThrowError('Optional migration requires an outer transaction');
      for (const altered of [
        sql().replace('-- APPLY_AFTER_ARCHIVE', '-- absent'),
        `${sql()}\n-- APPLY_AFTER_ARCHIVE\n`,
        `${sql()}\nDROP TABLE account;`,
      ]) {
        expect(() => migrate(db, resolutions(db), altered)).toThrowError(
          'Invalid optional migration SQL',
        );
        expect(state(db)).toEqual(before);
      }
    }));
  it('reports inconsistent sources and incomplete lock pairs across history', () =>
    fixture((db) => {
      db.prepare(
        'UPDATE tasks SET inputStart=?,inputFinish=?,durationDays=3 WHERE id=?',
      ).run('2026-10-07', '2026-10-05', aId);
      db.prepare('UPDATE operations SET response=?').run(
        JSON.stringify({
          ...tree,
          tasks: [
            {
              ...task,
              status: 'done',
              completedStart: '2026-10-05',
              completedFinish: null,
            },
          ],
        }),
      );
      db.prepare('UPDATE undo_snapshots SET beforeSnapshot=?').run(
        JSON.stringify({
          project,
          tasks: [
            {
              ...task,
              status: 'done',
              completedStartIndex: 3,
              completedFinishIndex: 3,
            },
          ],
          dependencies: [],
        }),
      );
      expect(migrationCategoryCounts(db)).toEqual({
        auto: 0,
        completedAbsolute: 1,
        completedRelative: 1,
        inconsistent: 3,
      });
    }));
  it('returns safe conflict codes and statuses, and internal frozen errors', () =>
    fixture((db) => {
      migrate(db);
      for (const [body, code] of [
        [{ ...legacyBody, expectedRevision: 9 }, 'OPERATION_REUSED'],
        [{ operationId: bId }, 'LEGACY_REPLAY_NOT_FOUND'],
      ] as const) {
        try {
          replayLegacyOperation(db, projectId, sessionId, body);
          expect.fail('Expected a lookup conflict');
        } catch (error) {
          expect(error).toBeInstanceOf(DomainError);
          expect(error).toMatchObject({ code, statusCode: 409 });
        }
      }
      db.prepare('UPDATE operations SET response=?,responseSha256=?').run(
        '{}',
        sha('{}'),
      );
      try {
        replayLegacyOperation(db, projectId, sessionId, legacyBody);
        expect.fail('Expected an internal response error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(DomainError);
        expect(error).toMatchObject({
          message: 'Invalid frozen operation response',
        });
      }
    }));
});
function insertTaskTarget(db: Database.Database, value: object) {
  db.prepare(
    'INSERT INTO tasks(id,projectId,parentId,title,description,sortOrder,status,inputStart,inputFinish,durationDays,createdAt,updatedAt) VALUES (@id,@projectId,@parentId,@title,@description,@sortOrder,@status,@inputStart,@inputFinish,@durationDays,@createdAt,@updatedAt)',
  ).run(value);
}
