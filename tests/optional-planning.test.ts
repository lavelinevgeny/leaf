import { describe, expect, it } from 'vitest';
import {
  applySourcePatch,
  realInterval,
  validateSourceInput,
} from '../src/domain/optional-planning.js';
import {
  commandEnvelopeV2Schema,
  commandV2Schema,
  optionalEditSchema,
  projectTreeV2Schema,
  projectV2Schema,
  renameV2Schema,
  scheduleResponseV2Schema,
  scheduleResultV2Schema,
  snapshotV2Schema,
  sourceFieldsSchema,
  sourcePatchSchema,
  taskV2Schema,
  type SourceFields,
} from '../src/shared/optional-contracts.js';

const emptySource: SourceFields = {
  inputStart: null,
  inputFinish: null,
  durationDays: null,
};
const taskId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const operationId = '00000000-0000-4000-8000-000000000003';
const timestamp = '2026-10-07T00:00:00.000Z';
const project = {
  id: projectId,
  title: 'Demo project',
  revision: 0,
  calendarType: 'weekdays',
  timezone: 'UTC',
  createdAt: timestamp,
  updatedAt: timestamp,
};
const task = {
  id: taskId,
  projectId,
  parentId: null,
  title: 'Task A',
  description: '',
  sortOrder: 0,
  status: 'todo',
  ...emptySource,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const pendingResult = {
  analysisStatus: 'pending-policy',
  feasibility: 'incomplete',
  coverage: { knownLeafCount: 0, totalLeafCount: 1 },
  tasks: {
    [taskId]: {
      startDate: null,
      finishDate: null,
      calendarSpanDays: null,
    },
  },
  summaries: {},
  display: {},
  criticalTaskIds: [],
  criticalDependencyIds: [],
  diagnostics: [],
};

describe('optional source fields', () => {
  it.each([
    [null, null, null],
    ['2026-10-09', null, null],
    [null, '2026-10-12', null],
    [null, null, 2],
    ['2026-10-09', null, 2],
    [null, '2026-10-12', 2],
    ['2026-10-09', '2026-10-12', null],
    ['2026-10-09', '2026-10-12', 2],
  ] as const)(
    'stores %s / %s / %s independently',
    (inputStart, inputFinish, durationDays) => {
      const source = { inputStart, inputFinish, durationDays };
      expect(applySourcePatch(emptySource, source, 'weekdays')).toEqual(source);
      expect(sourceFieldsSchema.parse(source)).toEqual(source);
      expect(realInterval(source, 'weekdays')).toEqual(
        inputStart !== null && inputFinish !== null
          ? {
              startDate: '2026-10-09',
              finishDate: '2026-10-12',
              calendarSpanDays: 2,
            }
          : null,
      );
    },
  );

  it('keeps nullable duration and validates N01 without materializing it', () => {
    const source = {
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
      durationDays: null,
    };
    expect(realInterval(source, 'weekdays')).toEqual({
      startDate: '2026-10-09',
      finishDate: '2026-10-12',
      calendarSpanDays: 2,
    });
    expect(source.durationDays).toBeNull();
    expect(applySourcePatch(source, { inputFinish: null }, 'weekdays')).toEqual(
      { ...source, inputFinish: null },
    );
    expect(
      applySourcePatch(source, { durationDays: 2 }, 'weekdays').durationDays,
    ).toBe(2);
    expect(() =>
      applySourcePatch(source, { durationDays: 3 }, 'weekdays'),
    ).toThrowError(expect.objectContaining({ code: 'DURATION_MISMATCH' }));
    expect(
      sourcePatchSchema.safeParse({ deadline: '2026-10-20' }).success,
    ).toBe(false);
  });

  it('preserves omitted duration and clears each source field independently', () => {
    const source = {
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
      durationDays: 2,
    };
    expect(applySourcePatch(source, { inputFinish: null }, 'weekdays')).toEqual(
      { ...source, inputFinish: null },
    );
    expect(applySourcePatch(source, { inputStart: null }, 'weekdays')).toEqual({
      ...source,
      inputStart: null,
    });
    expect(
      applySourcePatch(source, { durationDays: null }, 'weekdays'),
    ).toEqual({ ...source, durationDays: null });
    expect(applySourcePatch(source, {}, 'weekdays')).toEqual(source);
    expect(sourcePatchSchema.parse({ inputFinish: null })).toEqual({
      inputFinish: null,
    });
  });

  it('rejects changing duration to a mismatch and leaves source untouched', () => {
    const source = {
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
      durationDays: 2,
    };
    expect(() =>
      applySourcePatch(source, { durationDays: 3 }, 'weekdays'),
    ).toThrowError(expect.objectContaining({ code: 'DURATION_MISMATCH' }));
    expect(source.durationDays).toBe(2);
  });

  it.each([0, -1, 1.5, 1000001])(
    'rejects input duration %s',
    (durationDays) => {
      expect(sourcePatchSchema.safeParse({ durationDays }).success).toBe(false);
      expect(
        sourceFieldsSchema.safeParse({ ...emptySource, durationDays }).success,
      ).toBe(false);
      expect(
        optionalEditSchema.safeParse({
          type: 'task.edit',
          taskId,
          changes: { durationDays },
        }).success,
      ).toBe(false);
    },
  );

  it('stores the maximum input duration without supplying dates', () => {
    const patch = { durationDays: 1000000 };
    expect(sourcePatchSchema.parse(patch)).toEqual(patch);
    const source = applySourcePatch(emptySource, patch, 'weekdays');
    expect(source).toEqual({ ...emptySource, durationDays: 1000000 });
    expect(realInterval(source, 'weekdays')).toBeNull();
  });

  it.each(['', '2026-02-29', '0000-01-01', '10000-01-01'])(
    'rejects malformed source date %s',
    (date) => {
      expect(sourcePatchSchema.safeParse({ inputStart: date }).success).toBe(
        false,
      );
      expect(sourcePatchSchema.safeParse({ inputFinish: date }).success).toBe(
        false,
      );
    },
  );

  it('does not apply the input duration cap to derived calendar span', () => {
    const source = {
      inputStart: '0001-01-01',
      inputFinish: '9999-12-31',
      durationDays: null,
    };
    expect(realInterval(source, 'all-days')).toEqual({
      startDate: '0001-01-01',
      finishDate: '9999-12-31',
      calendarSpanDays: 3652059,
    });
    expect(applySourcePatch(emptySource, source, 'all-days')).toEqual(source);
    expect(
      taskV2Schema.parse({ ...task, ...source, durationDays: 3652059 })
        .durationDays,
    ).toBe(3652059);
  });

  it.each([
    { inputStart: '2026-10-10', inputFinish: null, durationDays: 2 },
    { inputStart: null, inputFinish: '2026-10-11', durationDays: 2 },
  ])('retains a one-sided weekend date: %j', (source) => {
    expect(applySourcePatch(emptySource, source, 'weekdays')).toEqual(source);
    expect(() => validateSourceInput(source, 'weekdays')).not.toThrow();
    expect(realInterval(source, 'weekdays')).toBeNull();
  });

  it.each([
    ['2026-10-10', '2026-10-12'],
    ['2026-10-09', '2026-10-11'],
    ['2026-10-12', '2026-10-09'],
    ['invalid', '2026-10-12'],
  ])(
    'rejects a new invalid pair %s / %s and tolerates reading it',
    (inputStart, inputFinish) => {
      const source = { inputStart, inputFinish, durationDays: null };
      expect(() => validateSourceInput(source, 'weekdays')).toThrowError(
        expect.objectContaining({ code: 'INVALID_INTERVAL' }),
      );
      expect(() =>
        applySourcePatch(emptySource, source, 'weekdays'),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_INTERVAL' }));
      expect(realInterval(source, 'weekdays')).toBeNull();
    },
  );

  it('accepts a weekend pair only in the all-days calendar', () => {
    const source = {
      inputStart: '2026-10-10',
      inputFinish: '2026-10-11',
      durationDays: 2,
    };
    expect(applySourcePatch(emptySource, source, 'all-days')).toEqual(source);
    expect(realInterval(source, 'all-days')).toEqual({
      startDate: '2026-10-10',
      finishDate: '2026-10-11',
      calendarSpanDays: 2,
    });
  });

  it('does not revalidate unchanged legacy or calendar-invalid source', () => {
    const source = {
      inputStart: '2026-10-10',
      inputFinish: '2026-10-11',
      durationDays: 2,
      title: 'Task A',
      status: 'todo',
    };
    const saved = { ...source, title: 'Task B', status: 'doing' };
    expect(applySourcePatch(saved, {}, 'weekdays')).toEqual(saved);
    expect(
      applySourcePatch(
        saved,
        {
          inputStart: source.inputStart,
          inputFinish: source.inputFinish,
          durationDays: source.durationDays,
        },
        'weekdays',
      ),
    ).toEqual(saved);
    expect(() =>
      applySourcePatch(saved, { durationDays: 3 }, 'weekdays'),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INTERVAL' }));
    expect(applySourcePatch(saved, { inputFinish: null }, 'weekdays')).toEqual({
      ...saved,
      inputFinish: null,
    });
    expect(source.title).toBe('Task A');
  });

  it('does not throw or mutate a stored mismatched triple while reading', () => {
    const source = {
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
      durationDays: 3,
    };
    expect(realInterval(source, 'weekdays')).toBeNull();
    expect(applySourcePatch(source, {}, 'weekdays')).toEqual(source);
    expect(applySourcePatch(source, { durationDays: 3 }, 'weekdays')).toEqual(
      source,
    );
    expect(
      applySourcePatch(source, { durationDays: null }, 'weekdays'),
    ).toEqual({
      ...source,
      durationDays: null,
    });
    expect(source.durationDays).toBe(3);
  });
});

describe('inactive scheduling contract V2', () => {
  it('requires version 2 inside a new canonical command and rename body', () => {
    const envelope = {
      contractVersion: 2,
      expectedRevision: 0,
      operationId,
      command: { type: 'task.create', title: 'Task A', parentId: null },
    };
    expect(commandEnvelopeV2Schema.parse(envelope)).toEqual(envelope);
    const unversioned = {
      expectedRevision: envelope.expectedRevision,
      operationId: envelope.operationId,
      command: envelope.command,
    };
    expect(commandEnvelopeV2Schema.safeParse(unversioned).success).toBe(false);
    expect(
      commandEnvelopeV2Schema.safeParse({ ...envelope, contractVersion: 1 })
        .success,
    ).toBe(false);
    const rename = {
      contractVersion: 2,
      expectedRevision: 0,
      operationId,
      title: 'Demo project',
    };
    expect(renameV2Schema.parse(rename)).toEqual(rename);
    expect(
      renameV2Schema.safeParse({ ...rename, contractVersion: undefined })
        .success,
    ).toBe(false);
  });

  it('accepts an atomic nullable source edit and rejects empty changes', () => {
    const edit = {
      type: 'task.edit',
      taskId,
      changes: { title: 'Task B', status: 'doing', ...emptySource },
    };
    expect(commandV2Schema.parse(edit)).toEqual(edit);
    expect(optionalEditSchema.safeParse({ ...edit, changes: {} }).success).toBe(
      false,
    );
    expect(
      commandV2Schema.safeParse({
        type: 'task.update',
        taskId,
        changes: { inputStart: null },
      }).success,
    ).toBe(false);
  });

  it.each(['deadline', 'planMode', 'notBefore'])(
    'rejects legacy %s in source, edits and task responses',
    (field) => {
      expect(sourcePatchSchema.safeParse({ [field]: null }).success).toBe(
        false,
      );
      expect(
        optionalEditSchema.safeParse({
          type: 'task.edit',
          taskId,
          changes: { [field]: null },
        }).success,
      ).toBe(false);
      expect(taskV2Schema.safeParse({ ...task, [field]: null }).success).toBe(
        false,
      );
    },
  );

  it('rejects new legacy planning commands and project start dates', () => {
    expect(
      commandV2Schema.safeParse({
        type: 'task.plan',
        taskId,
        plan: { mode: 'unscheduled' },
      }).success,
    ).toBe(false);
    expect(
      commandV2Schema.safeParse({
        type: 'project.schedule',
        changes: { startDate: null },
      }).success,
    ).toBe(false);
    expect(
      projectV2Schema.safeParse({ ...project, startDate: null }).success,
    ).toBe(false);
    expect(
      commandV2Schema.parse({
        type: 'project.schedule',
        changes: { calendarType: 'all-days', timezone: 'UTC' },
      }),
    ).toEqual({
      type: 'project.schedule',
      changes: { calendarType: 'all-days', timezone: 'UTC' },
    });
  });

  it('keeps snapshots unversioned and versions public tree and schedule forms', () => {
    const snapshot = { project, tasks: [task], dependencies: [] };
    expect(snapshotV2Schema.parse(snapshot)).toEqual(snapshot);
    const tree = {
      ...snapshot,
      contractVersion: 2,
      canUndo: false,
      schedule: pendingResult,
    };
    expect(projectTreeV2Schema.parse(tree)).toEqual(tree);
    expect(
      projectTreeV2Schema.safeParse({ ...tree, contractVersion: undefined })
        .success,
    ).toBe(false);
    const response = {
      contractVersion: 2,
      projectId,
      revision: 0,
      schedule: pendingResult,
    };
    expect(scheduleResponseV2Schema.parse(response)).toEqual(response);
    expect(
      scheduleResponseV2Schema.safeParse({ ...response, contractVersion: 1 })
        .success,
    ).toBe(false);
  });

  it('keeps pending historical replies without CPM floats or critical ids', () => {
    expect(scheduleResultV2Schema.parse(pendingResult)).toEqual(pendingResult);
    expect(
      scheduleResultV2Schema.safeParse({
        ...pendingResult,
        analysisStatus: 'ready',
      }).success,
    ).toBe(false);
    expect(
      scheduleResultV2Schema.safeParse({
        ...pendingResult,
        criticalTaskIds: [taskId],
      }).success,
    ).toBe(false);
    expect(
      scheduleResultV2Schema.safeParse({
        ...pendingResult,
        criticalDependencyIds: [operationId],
      }).success,
    ).toBe(false);
    expect(
      scheduleResultV2Schema.safeParse({
        ...pendingResult,
        tasks: {
          [taskId]: { ...pendingResult.tasks[taskId], projectFloat: 0 },
        },
      }).success,
    ).toBe(false);
  });
});
