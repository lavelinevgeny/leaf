import { z } from 'zod';

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return (
      year >= 1 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= (days[month - 1] ?? 0)
    );
  }, 'Invalid calendar date');
export const uuidSchema = z.uuid();
const predecessorIdsSchema = z
  .array(uuidSchema)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate predecessors');
export const taskTitleSchema = z.string().trim().min(1).max(300);
export const projectTitleSchema = z.string().trim().min(1).max(120);
export const calendarTypeSchema = z.enum(['weekdays', 'all-days']);
export const timezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone');
export type SourceFields = {
  inputStart: string | null;
  inputFinish: string | null;
  durationDays: number | null;
};
export type SourcePatch = Partial<SourceFields>;

export const sourceFieldsSchema = z.strictObject({
  inputStart: calendarDateSchema.nullable(),
  inputFinish: calendarDateSchema.nullable(),
  durationDays: z.number().int().min(1).max(1000000).nullable(),
});
export const sourcePatchSchema = sourceFieldsSchema.partial();
export const optionalEditSchema = z.strictObject({
  type: z.literal('task.edit'),
  taskId: uuidSchema,
  changes: z
    .strictObject({
      title: taskTitleSchema.optional(),
      description: z.string().max(10000).optional(),
      status: z.enum(['todo', 'doing', 'done']).optional(),
      inputStart: calendarDateSchema.nullable().optional(),
      inputFinish: calendarDateSchema.nullable().optional(),
      durationDays: z.number().int().min(1).max(1000000).nullable().optional(),
      predecessorIds: predecessorIdsSchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'Empty changes'),
});

const statusV2Schema = z.enum(['todo', 'doing', 'done']);
const timestampV2Schema = z.iso.datetime();
export const projectV2Schema = z.strictObject({
  id: uuidSchema,
  title: projectTitleSchema,
  revision: z.number().int().nonnegative(),
  calendarType: calendarTypeSchema,
  timezone: timezoneSchema,
  createdAt: timestampV2Schema,
  updatedAt: timestampV2Schema,
});
export const taskV2Schema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  parentId: uuidSchema.nullable(),
  title: taskTitleSchema,
  description: z.string().max(10000),
  sortOrder: z.number().int().nonnegative(),
  status: statusV2Schema,
  inputStart: calendarDateSchema.nullable(),
  inputFinish: calendarDateSchema.nullable(),
  durationDays: z.number().int().positive().nullable(),
  createdAt: timestampV2Schema,
  updatedAt: timestampV2Schema,
});
export const dependencyV2Schema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  predecessorId: uuidSchema,
  successorId: uuidSchema,
});
export const snapshotV2Schema = z.strictObject({
  project: projectV2Schema,
  tasks: z.array(taskV2Schema),
  dependencies: z.array(dependencyV2Schema),
});
const countCpmSchema = z.number().int().nonnegative();
const floatCpmSchema = z.number().int().nonnegative();
const coverageCpmSchema = z
  .strictObject({
    knownLeafCount: countCpmSchema,
    totalLeafCount: countCpmSchema,
  })
  .refine((x) => x.knownLeafCount <= x.totalLeafCount, 'Invalid coverage');
const idsCpmSchema = z
  .array(uuidSchema)
  .refine(
    (ids) => ids.every((id, i) => i === 0 || ids[i - 1]! < id),
    'IDs must be unique and sorted',
  );
const diagnosticsCpmSchema = z.array(
  z.strictObject({
    code: z.string(),
    taskIds: z.array(uuidSchema),
    dependencyIds: z.array(uuidSchema),
    messageKey: z.string(),
  }),
);
const realCpmShape = {
  startDate: calendarDateSchema.nullable(),
  finishDate: calendarDateSchema.nullable(),
  calendarSpanDays: z.number().int().positive().nullable(),
};
const realCpmSchema = z
  .strictObject(realCpmShape)
  .refine(
    (x) =>
      [x.startDate, x.finishDate, x.calendarSpanDays].every(
        (v) => v === null,
      ) ||
      [x.startDate, x.finishDate, x.calendarSpanDays].every((v) => v !== null),
    'Incomplete real interval',
  );
const summaryCpmShape = {
  ...realCpmShape,
  knownLeafCount: countCpmSchema,
  totalLeafCount: countCpmSchema,
};
const displayCpmSchema = z.record(
  uuidSchema,
  z.strictObject({
    kind: z.literal('conditional'),
    startDate: calendarDateSchema,
    finishDate: calendarDateSchema,
    clipped: z.boolean(),
  }),
);

// Exact Task 1/5 form: no new validation, defaults, transforms or additions.
export const frozenPendingScheduleV2Schema = z.strictObject({
  analysisStatus: z.literal('pending-policy'),
  feasibility: z.enum(['feasible', 'incomplete', 'infeasible']),
  coverage: z.strictObject({
    knownLeafCount: countCpmSchema,
    totalLeafCount: countCpmSchema,
  }),
  tasks: z.record(uuidSchema, z.strictObject(realCpmShape)),
  summaries: z.record(uuidSchema, z.strictObject(summaryCpmShape)),
  display: displayCpmSchema,
  criticalTaskIds: z.array(uuidSchema).length(0),
  criticalDependencyIds: z.array(uuidSchema).length(0),
  diagnostics: diagnosticsCpmSchema,
});
const liveCommonCpmShape = {
  coverage: coverageCpmSchema,
  display: displayCpmSchema,
  diagnostics: diagnosticsCpmSchema,
};
const readyTaskCpmSchema = z
  .strictObject({
    startDate: calendarDateSchema,
    finishDate: calendarDateSchema,
    calendarSpanDays: z.number().int().positive(),
    projectFloat: floatCpmSchema,
    constraintFloat: floatCpmSchema,
  })
  .refine((x) => x.constraintFloat <= x.projectFloat, 'Invalid floats');
const unanalyzedTaskCpmSchema = z
  .strictObject({
    ...realCpmShape,
    projectFloat: z.null(),
    constraintFloat: z.null(),
  })
  .refine(
    (x) =>
      realCpmSchema.safeParse({
        startDate: x.startDate,
        finishDate: x.finishDate,
        calendarSpanDays: x.calendarSpanDays,
      }).success,
    'Incomplete real interval',
  );
const readySummaryCpmSchema = z
  .strictObject({
    startDate: calendarDateSchema,
    finishDate: calendarDateSchema,
    calendarSpanDays: z.number().int().positive(),
    knownLeafCount: countCpmSchema,
    totalLeafCount: countCpmSchema,
    containsCritical: z.boolean(),
  })
  .refine(
    (x) => x.knownLeafCount === x.totalLeafCount && x.totalLeafCount > 0,
    'Incomplete ready summary',
  );
const unanalyzedSummaryCpmSchema = z
  .strictObject({
    ...summaryCpmShape,
    containsCritical: z.null(),
  })
  .refine(
    (x) =>
      x.knownLeafCount <= x.totalLeafCount &&
      realCpmSchema.safeParse({
        startDate: x.startDate,
        finishDate: x.finishDate,
        calendarSpanDays: x.calendarSpanDays,
      }).success,
    'Invalid summary',
  );
export const partialAnalysisV2Schema = z
  .strictObject({
    labelKey: z.literal('scheduling.PARTIAL_ANALYSIS'),
    knownHorizonFinishDate: calendarDateSchema,
    coverage: z.strictObject({
      analyzedLeafCount: countCpmSchema,
      blockedLeafCount: countCpmSchema,
    }),
    tasks: z.record(
      uuidSchema,
      z.strictObject({ knownHorizonFloat: floatCpmSchema }),
    ),
    partialCriticalTaskIds: idsCpmSchema,
    partialCriticalDependencyIds: idsCpmSchema,
    partialCriticalSummaryIds: idsCpmSchema,
  })
  .refine(
    (x) =>
      Object.keys(x.tasks).length === x.coverage.analyzedLeafCount &&
      x.partialCriticalTaskIds.every(
        (id) => x.tasks[id]?.knownHorizonFloat === 0,
      ),
    'Invalid partial coverage/critical tasks',
  );
export const readyScheduleV2Schema = z
  .strictObject({
    ...liveCommonCpmShape,
    analysisStatus: z.literal('ready'),
    feasibility: z.literal('feasible'),
    tasks: z.record(uuidSchema, readyTaskCpmSchema),
    summaries: z.record(uuidSchema, readySummaryCpmSchema),
    horizonFinishDate: calendarDateSchema.nullable(),
    partialAnalysis: z.null(),
    criticalTaskIds: idsCpmSchema,
    criticalDependencyIds: idsCpmSchema,
  })
  .refine(
    (x) =>
      x.coverage.knownLeafCount === x.coverage.totalLeafCount &&
      Object.keys(x.tasks).length === x.coverage.totalLeafCount &&
      (x.coverage.totalLeafCount === 0
        ? x.horizonFinishDate === null
        : x.horizonFinishDate !== null) &&
      x.criticalTaskIds.every((id) => x.tasks[id]?.projectFloat === 0),
    'Invalid ready coverage/horizon/critical tasks',
  );
export const incompleteScheduleV2Schema = z
  .strictObject({
    ...liveCommonCpmShape,
    analysisStatus: z.literal('incomplete'),
    feasibility: z.literal('incomplete'),
    tasks: z.record(uuidSchema, unanalyzedTaskCpmSchema),
    summaries: z.record(uuidSchema, unanalyzedSummaryCpmSchema),
    horizonFinishDate: z.null(),
    partialAnalysis: partialAnalysisV2Schema.nullable(),
    criticalTaskIds: z.array(uuidSchema).length(0),
    criticalDependencyIds: z.array(uuidSchema).length(0),
  })
  .refine(
    (x) =>
      x.coverage.knownLeafCount < x.coverage.totalLeafCount &&
      Object.keys(x.tasks).length === x.coverage.totalLeafCount &&
      (x.partialAnalysis === null
        ? x.coverage.knownLeafCount === 0
        : x.partialAnalysis.coverage.analyzedLeafCount +
            x.partialAnalysis.coverage.blockedLeafCount ===
          x.coverage.totalLeafCount),
    'Invalid incomplete coverage',
  );
export const infeasibleScheduleV2Schema = z.strictObject({
  ...liveCommonCpmShape,
  analysisStatus: z.literal('infeasible'),
  feasibility: z.literal('infeasible'),
  tasks: z.record(uuidSchema, unanalyzedTaskCpmSchema),
  summaries: z.record(uuidSchema, unanalyzedSummaryCpmSchema),
  horizonFinishDate: z.null(),
  partialAnalysis: z.null(),
  criticalTaskIds: z.array(uuidSchema).length(0),
  criticalDependencyIds: z.array(uuidSchema).length(0),
});
export const liveScheduleResultV2Schema = z.discriminatedUnion(
  'analysisStatus',
  [
    readyScheduleV2Schema,
    incompleteScheduleV2Schema,
    infeasibleScheduleV2Schema,
  ],
);
export const scheduleResultV2Schema = z.union([
  frozenPendingScheduleV2Schema,
  liveScheduleResultV2Schema,
]);
export const liveProjectTreeV2Schema = snapshotV2Schema.extend({
  contractVersion: z.literal(2),
  canUndo: z.boolean(),
  schedule: liveScheduleResultV2Schema,
});
export const liveScheduleResponseV2Schema = z.strictObject({
  contractVersion: z.literal(2),
  projectId: uuidSchema,
  revision: countCpmSchema,
  schedule: liveScheduleResultV2Schema,
});
export type LiveProjectTreeV2 = z.infer<typeof liveProjectTreeV2Schema>;
export type LiveScheduleResponseV2 = z.infer<
  typeof liveScheduleResponseV2Schema
>;
export const projectTreeV2Schema = snapshotV2Schema.extend({
  contractVersion: z.literal(2),
  canUndo: z.boolean(),
  schedule: scheduleResultV2Schema,
});
export const scheduleResponseV2Schema = z.strictObject({
  contractVersion: z.literal(2),
  projectId: uuidSchema,
  revision: countCpmSchema,
  schedule: scheduleResultV2Schema,
});
export type FrozenPendingScheduleV2 = z.infer<
  typeof frozenPendingScheduleV2Schema
>;
export type LiveScheduleResultV2 = z.infer<typeof liveScheduleResultV2Schema>;
export type ScheduleResultV2 = z.infer<typeof scheduleResultV2Schema>;
export type PartialAnalysisV2 = z.infer<typeof partialAnalysisV2Schema>;
export type ProjectTreeV2 = z.infer<typeof projectTreeV2Schema>;
export type ScheduleResponseV2 = z.infer<typeof scheduleResponseV2Schema>;
export type ProjectTree = ProjectTreeV2;
export type ScheduleResponse = ScheduleResponseV2;
export const scheduleResultSchema = scheduleResultV2Schema;
export const projectTreeSchema = projectTreeV2Schema;
export const scheduleResponseSchema = scheduleResponseV2Schema;
const detailsPatchV2Schema = z
  .strictObject({
    title: taskTitleSchema.optional(),
    description: z.string().max(10000).optional(),
    status: statusV2Schema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Empty changes');
export const commandV2Schema = z.discriminatedUnion('type', [
  optionalEditSchema,
  z.strictObject({
    type: z.literal('task.resizeStart'),
    taskId: uuidSchema,
    inputStart: calendarDateSchema,
  }),
  z.strictObject({
    type: z.literal('task.update'),
    taskId: uuidSchema,
    changes: detailsPatchV2Schema,
  }),
  z.strictObject({
    type: z.literal('task.create'),
    ...sourcePatchSchema.shape,
    title: taskTitleSchema,
    parentId: uuidSchema.nullable(),
    afterId: uuidSchema.optional(),
    preserveWork: z.boolean().optional(),
    predecessorIds: predecessorIdsSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('task.move'),
    taskId: uuidSchema,
    parentId: uuidSchema.nullable(),
    position: z.number().int().nonnegative(),
    preserveWork: z.boolean().optional(),
  }),
  z.strictObject({ type: z.literal('task.delete'), taskId: uuidSchema }),
  z.strictObject({
    type: z.literal('dependency.create'),
    predecessorId: uuidSchema,
    successorId: uuidSchema,
  }),
  z.strictObject({
    type: z.literal('dependency.delete'),
    dependencyId: uuidSchema,
  }),
  z.strictObject({ type: z.literal('undo') }),
  z.strictObject({
    type: z.literal('project.schedule'),
    changes: z
      .strictObject({
        calendarType: calendarTypeSchema.optional(),
        timezone: timezoneSchema.optional(),
      })
      .refine((value) => Object.keys(value).length > 0, 'Empty changes'),
  }),
]);
export const commandEnvelopeV2Schema = z.strictObject({
  contractVersion: z.literal(2),
  expectedRevision: z.number().int().nonnegative(),
  operationId: uuidSchema,
  command: commandV2Schema,
});
export const renameV2Schema = z.strictObject({
  contractVersion: z.literal(2),
  title: projectTitleSchema,
  expectedRevision: z.number().int().nonnegative(),
  operationId: uuidSchema,
});
export type ProjectV2 = z.infer<typeof projectV2Schema>;
export type TaskV2 = z.infer<typeof taskV2Schema>;
export type DependencyV2 = z.infer<typeof dependencyV2Schema>;
export type SnapshotV2 = z.infer<typeof snapshotV2Schema>;
export type CommandV2 = z.infer<typeof commandV2Schema>;
export type CommandEnvelopeV2 = z.infer<typeof commandEnvelopeV2Schema>;
export type RenameV2 = z.infer<typeof renameV2Schema>;
export const loginSchema = z.strictObject({
  password: z.string().min(1).max(1024),
});
export const sessionSchema = z.strictObject({
  authenticated: z.boolean(),
  setupRequired: z.boolean(),
});
export const errorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
});
export const projectSchema = projectV2Schema;
export type Project = ProjectV2;
export const taskSchema = taskV2Schema;
export type Task = TaskV2;
export const dependencySchema = dependencyV2Schema;
export type Dependency = DependencyV2;
export const commandSchema = commandV2Schema;
export type Command = CommandV2;
export const commandEnvelopeSchema = commandEnvelopeV2Schema;
export type CommandEnvelope = CommandEnvelopeV2;
export const renameProjectSchema = renameV2Schema;
export type RenameProject = RenameV2;
export const createProjectSchema = z.strictObject({
  title: projectTitleSchema,
});
export type AuthSession = z.infer<typeof sessionSchema>;
