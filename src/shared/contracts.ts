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
export const taskTitleSchema = z.string().trim().min(1).max(300);
export const projectTitleSchema = z.string().trim().min(1).max(120);
export const projectSchema = z.strictObject({
  id: uuidSchema,
  title: projectTitleSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const taskSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  parentId: uuidSchema.nullable(),
  title: taskTitleSchema,
  description: z.string().max(10000),
  sortOrder: z.number().int().nonnegative(),
  status: z.enum(['todo', 'doing', 'done']),
  inputStart: calendarDateSchema.nullable(),
  inputFinish: calendarDateSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const projectTreeSchema = z.strictObject({
  project: projectSchema,
  tasks: z.array(taskSchema),
  canUndo: z.boolean(),
});
export const taskChangesSchema = z
  .strictObject({
    title: taskTitleSchema.optional(),
    description: z.string().max(10000).optional(),
    status: z.enum(['todo', 'doing', 'done']).optional(),
    inputStart: calendarDateSchema.nullable().optional(),
    inputFinish: calendarDateSchema.nullable().optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'Empty changes');
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('task.create'),
    title: taskTitleSchema,
    parentId: uuidSchema.nullable(),
    afterId: uuidSchema.optional(),
    preserveWork: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('task.update'),
    taskId: uuidSchema,
    changes: taskChangesSchema,
  }),
  z.strictObject({
    type: z.literal('task.move'),
    taskId: uuidSchema,
    parentId: uuidSchema.nullable(),
    position: z.number().int().nonnegative(),
    preserveWork: z.boolean().optional(),
  }),
  z.strictObject({ type: z.literal('task.delete'), taskId: uuidSchema }),
  z.strictObject({ type: z.literal('undo') }),
]);
export const commandEnvelopeSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  operationId: uuidSchema,
  command: commandSchema,
});
export const createProjectSchema = z.strictObject({
  title: projectTitleSchema,
});
export const renameProjectSchema = z.strictObject({
  title: projectTitleSchema,
  expectedRevision: z.number().int().nonnegative(),
  operationId: uuidSchema,
});
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
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type ProjectTree = z.infer<typeof projectTreeSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type RenameProject = z.infer<typeof renameProjectSchema>;
export type AuthSession = z.infer<typeof sessionSchema>;
