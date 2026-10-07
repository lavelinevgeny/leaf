import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  commandEnvelopeSchema,
  createProjectSchema,
  projectTreeSchema,
  renameProjectSchema,
  type Command,
  type CommandEnvelope,
  type Project,
  type ProjectTree,
  type RenameProject,
  type Task,
  type Dependency,
} from '../shared/contracts.js';
import {
  assertCanMove,
  DomainError,
  orderedChildren,
  subtreeIds,
} from '../domain/tree.js';

import { calculateSchedule } from '../domain/scheduling.js';
import { requiresWorkPreservation } from '../shared/work-preservation.js';
import {
  applyTaskPlan,
  completedInterval,
  emptyPlanning,
  fixedDuration,
  validateDependencies,
  validateDependency,
} from '../domain/planning.js';

interface Snapshot {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
}
interface UndoRecord {
  sequence: number;
  afterRevision: number;
  beforeSnapshot: string;
}
interface OperationRecord {
  projectId: string;
  sessionId: string;
  payload: string;
  response: string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function validatedTreeResponse(value: unknown): ProjectTree {
  const parsed = projectTreeSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid internal tree response');
  return parsed.data;
}
export class Repository {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}
  listProjects(): Project[] {
    return this.db
      .prepare('SELECT * FROM projects ORDER BY createdAt,id')
      .all() as Project[];
  }
  createProject(title: string): Project {
    const input = createProjectSchema.parse({ title });
    const timestamp = new Date(this.now()).toISOString();
    const project: Project = {
      id: randomUUID(),
      title: input.title,
      revision: 0,
      startDate: null,
      calendarType: 'weekdays',
      timezone: 'UTC',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db
      .transaction(() => {
        this.db
          .prepare(
            'INSERT INTO projects(id,title,revision,createdAt,updatedAt) VALUES (@id,@title,@revision,@createdAt,@updatedAt)',
          )
          .run(project);
      })
      .immediate();
    return project;
  }
  private snapshot(projectId: string): Snapshot {
    const project = this.db
      .prepare('SELECT * FROM projects WHERE id=?')
      .get(projectId) as Project | undefined;
    if (!project)
      throw new DomainError('PROJECT_NOT_FOUND', 'Проект не найден.', 404);
    const tasks = this.db
      .prepare(
        'SELECT * FROM tasks WHERE projectId=? ORDER BY parentId,sortOrder,id',
      )
      .all(projectId) as Task[];
    const dependencies = this.db
      .prepare('SELECT * FROM dependencies WHERE projectId=? ORDER BY id')
      .all(projectId) as Dependency[];
    return { project, tasks, dependencies };
  }
  private latestUndo(
    projectId: string,
    sessionId: string,
  ): UndoRecord | undefined {
    return this.db
      .prepare(
        'SELECT sequence,afterRevision,beforeSnapshot FROM undo_snapshots WHERE projectId=? AND sessionId=? ORDER BY sequence DESC LIMIT 1',
      )
      .get(projectId, sessionId) as UndoRecord | undefined;
  }
  getTree(projectId: string, sessionId: string): ProjectTree {
    return this.db.transaction(() => {
      const snapshot = this.snapshot(projectId);
      return validatedTreeResponse({
        ...snapshot,
        schedule: this.calculate(snapshot),
        canUndo:
          this.latestUndo(projectId, sessionId)?.afterRevision ===
          snapshot.project.revision,
      });
    })();
  }
  private calculate(snapshot: Snapshot) {
    return calculateSchedule({
      startDate: snapshot.project.startDate,
      calendarType: snapshot.project.calendarType,
      tasks: snapshot.tasks,
      dependencies: snapshot.dependencies,
    });
  }
  getSchedule(projectId: string) {
    return this.db.transaction(() => {
      const snapshot = this.snapshot(projectId);
      return {
        projectId,
        revision: snapshot.project.revision,
        schedule: this.calculate(snapshot),
      };
    })();
  }
  applyCommand(
    projectId: string,
    envelope: CommandEnvelope,
    sessionId: string,
  ): ProjectTree {
    const input = commandEnvelopeSchema.parse(envelope);
    return this.mutate(
      projectId,
      input,
      sessionId,
      (snapshot, timestamp) => this.apply(snapshot, input.command, timestamp),
      input.command.type === 'undo',
    );
  }
  renameProject(
    projectId: string,
    input: RenameProject,
    sessionId: string,
  ): ProjectTree {
    const parsed = renameProjectSchema.parse(input);
    return this.mutate(
      projectId,
      parsed,
      sessionId,
      (snapshot) => {
        snapshot.project.title = parsed.title;
      },
      false,
    );
  }
  private mutate(
    projectId: string,
    input: { expectedRevision: number; operationId: string },
    sessionId: string,
    change: (snapshot: Snapshot, timestamp: string) => void,
    isUndo: boolean,
  ): ProjectTree {
    const payload = canonical(input);
    return this.db
      .transaction(() => {
        const existing = this.db
          .prepare(
            'SELECT projectId,sessionId,payload,response FROM operations WHERE operationId=?',
          )
          .get(input.operationId) as OperationRecord | undefined;
        if (existing) {
          if (
            existing.projectId !== projectId ||
            existing.sessionId !== sessionId ||
            existing.payload !== payload
          )
            throw new DomainError(
              'OPERATION_REUSED',
              'Идентификатор операции уже использован.',
              409,
            );
          return validatedTreeResponse(JSON.parse(existing.response));
        }
        let snapshot = this.snapshot(projectId);
        const revision = snapshot.project.revision;
        if (revision !== input.expectedRevision)
          throw new DomainError(
            'REVISION_CONFLICT',
            'Ревизия проекта изменилась. Обновите дерево.',
            409,
          );
        const beforeSnapshot = JSON.stringify(snapshot);
        const timestamp = new Date(this.now()).toISOString();
        if (isUndo) {
          const undo = this.latestUndo(projectId, sessionId);
          if (!undo || undo.afterRevision !== revision)
            throw new DomainError(
              'UNDO_CONFLICT',
              'Отмена недоступна после изменений другой сессии.',
              409,
            );
          snapshot = JSON.parse(undo.beforeSnapshot) as Snapshot;
          this.db
            .prepare('DELETE FROM undo_snapshots WHERE sequence=?')
            .run(undo.sequence);
          // Only contiguous commands from this session may remain eligible after undo.
          const previous = this.latestUndo(projectId, sessionId);
          if (previous?.afterRevision === snapshot.project.revision)
            this.db
              .prepare(
                'UPDATE undo_snapshots SET afterRevision=? WHERE sequence=?',
              )
              .run(revision + 1, previous.sequence);
        } else {
          change(snapshot, timestamp);
          this.db
            .prepare(
              'INSERT INTO undo_snapshots(projectId,sessionId,afterRevision,beforeSnapshot) VALUES (?,?,?,?)',
            )
            .run(projectId, sessionId, revision + 1, beforeSnapshot);
          this.db
            .prepare(
              'DELETE FROM undo_snapshots WHERE projectId=? AND sessionId=? AND sequence NOT IN (SELECT sequence FROM undo_snapshots WHERE projectId=? AND sessionId=? ORDER BY sequence DESC LIMIT 20)',
            )
            .run(projectId, sessionId, projectId, sessionId);
        }
        snapshot.project.revision = revision + 1;
        snapshot.project.updatedAt = timestamp;
        validateDependencies(snapshot.tasks, snapshot.dependencies);
        this.calculate(snapshot);
        this.save(snapshot);
        const result = this.getTree(projectId, sessionId);
        this.db
          .prepare(
            'INSERT INTO operations(operationId,projectId,sessionId,payload,response) VALUES (?,?,?,?,?)',
          )
          .run(
            input.operationId,
            projectId,
            sessionId,
            payload,
            JSON.stringify(result),
          );
        return result;
      })
      .immediate();
  }
  private save(snapshot: Snapshot): void {
    this.db
      .prepare(
        'UPDATE projects SET title=@title,revision=@revision,updatedAt=@updatedAt,startDate=@startDate,calendarType=@calendarType,timezone=@timezone WHERE id=@id',
      )
      .run(snapshot.project);
    this.db
      .prepare('DELETE FROM dependencies WHERE projectId=?')
      .run(snapshot.project.id);
    this.db
      .prepare('DELETE FROM tasks WHERE projectId=?')
      .run(snapshot.project.id);
    const insert = this.db.prepare(
      'INSERT INTO tasks(id,projectId,parentId,title,description,sortOrder,status,inputStart,inputFinish,createdAt,updatedAt,planMode,durationDays,notBefore,deadline,completedStart,completedFinish,completedStartIndex,completedFinishIndex) VALUES (@id,@projectId,@parentId,@title,@description,@sortOrder,@status,@inputStart,@inputFinish,@createdAt,@updatedAt,@planMode,@durationDays,@notBefore,@deadline,@completedStart,@completedFinish,@completedStartIndex,@completedFinishIndex)',
    );
    for (const task of snapshot.tasks) insert.run(task);
    const insertEdge = this.db.prepare(
      'INSERT INTO dependencies(id,projectId,predecessorId,successorId) VALUES (@id,@projectId,@predecessorId,@successorId)',
    );
    for (const edge of snapshot.dependencies) insertEdge.run(edge);
  }
  private apply(snapshot: Snapshot, command: Command, timestamp: string): void {
    const tasks = snapshot.tasks;
    const find = (id: string): Task => {
      const task = tasks.find((item) => item.id === id);
      if (!task)
        throw new DomainError('TASK_NOT_FOUND', 'Задача не найдена.', 404);
      return task;
    };
    const reindex = (parentId: string | null) => {
      orderedChildren(tasks, parentId).forEach((task, index) => {
        task.sortOrder = index;
      });
    };
    const convert = (
      parentId: string | null,
      preserveWork: boolean | undefined,
    ) => {
      if (parentId === null) return;
      const parent = find(parentId);
      if (tasks.some((task) => task.parentId === parentId)) return;
      if (requiresWorkPreservation(parent, snapshot.dependencies)) {
        if (preserveWork !== true)
          throw new DomainError(
            'PRESERVE_WORK_REQUIRED',
            'Подтвердите сохранение собственной работы отдельной подзадачей.',
            409,
          );
        const workId = randomUUID();
        tasks.push({
          ...parent,
          id: workId,
          parentId: parent.id,
          sortOrder: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        for (const edge of snapshot.dependencies) {
          if (edge.predecessorId === parent.id) edge.predecessorId = workId;
          if (edge.successorId === parent.id) edge.successorId = workId;
        }
        Object.assign(parent, emptyPlanning);
        parent.status = 'todo';
        parent.updatedAt = timestamp;
      }
    };
    switch (command.type) {
      case 'project.schedule': {
        Object.assign(snapshot.project, command.changes);
        for (const task of tasks)
          task.durationDays = fixedDuration(
            task,
            snapshot.project.calendarType,
          );
        break;
      }
      case 'task.plan': {
        const task = find(command.taskId);
        if (tasks.some((item) => item.parentId === task.id))
          throw new DomainError(
            'SUMMARY_PLANNING',
            'Сводная задача не имеет собственной работы.',
          );
        Object.assign(
          task,
          applyTaskPlan(task, command.plan, snapshot.project.calendarType),
          { updatedAt: timestamp },
        );
        break;
      }
      case 'dependency.create': {
        validateDependency(
          tasks,
          snapshot.dependencies,
          command.predecessorId,
          command.successorId,
        );
        snapshot.dependencies.push({
          id: randomUUID(),
          projectId: snapshot.project.id,
          predecessorId: command.predecessorId,
          successorId: command.successorId,
        });
        break;
      }
      case 'dependency.delete': {
        if (
          !snapshot.dependencies.some(
            (edge) => edge.id === command.dependencyId,
          )
        )
          throw new DomainError(
            'DEPENDENCY_NOT_FOUND',
            'Связь не найдена.',
            404,
          );
        snapshot.dependencies = snapshot.dependencies.filter(
          (edge) => edge.id !== command.dependencyId,
        );
        break;
      }
      case 'task.create': {
        if (
          command.parentId !== null &&
          !tasks.some((task) => task.id === command.parentId)
        )
          throw new DomainError(
            'INVALID_PARENT',
            'Родитель не принадлежит проекту.',
          );
        if (
          command.afterId !== undefined &&
          find(command.afterId).parentId !== command.parentId
        )
          throw new DomainError(
            'INVALID_POSITION',
            'Сосед не принадлежит выбранному родителю.',
          );
        convert(command.parentId, command.preserveWork);
        const siblings = orderedChildren(tasks, command.parentId);
        const position =
          command.afterId === undefined
            ? siblings.length
            : siblings.findIndex((task) => task.id === command.afterId) + 1;
        const task: Task = {
          id: randomUUID(),
          projectId: snapshot.project.id,
          parentId: command.parentId,
          title: command.title,
          description: '',
          sortOrder: position,
          status: 'todo',
          ...emptyPlanning,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        siblings.splice(position, 0, task);
        siblings.forEach((item, index) => {
          item.sortOrder = index;
        });
        tasks.push(task);
        break;
      }
      case 'task.update': {
        const task = find(command.taskId);
        if (
          tasks.some((item) => item.parentId === task.id) &&
          ('inputStart' in command.changes || 'inputFinish' in command.changes)
        )
          throw new DomainError(
            'SUMMARY_DATES',
            'Даты сводной задачи не редактируются.',
          );
        const changes = command.changes;
        if (
          task.planMode !== 'unscheduled' &&
          (('inputStart' in changes &&
            changes.inputStart !== task.inputStart) ||
            ('inputFinish' in changes &&
              changes.inputFinish !== task.inputFinish))
        )
          throw new DomainError(
            'SCHEDULED_DATES',
            'Изменяйте режим и даты работы командой планирования.',
          );
        if (changes.status === 'done' && task.status !== 'done')
          Object.assign(
            task,
            completedInterval(task, this.calculate(snapshot).tasks[task.id]),
          );
        else if (
          changes.status !== undefined &&
          changes.status !== 'done' &&
          task.status === 'done'
        )
          Object.assign(task, {
            completedStart: null,
            completedFinish: null,
            completedStartIndex: null,
            completedFinishIndex: null,
          });
        Object.assign(task, changes, { updatedAt: timestamp });
        break;
      }
      case 'task.move': {
        assertCanMove(tasks, command.taskId, command.parentId);
        const task = find(command.taskId);
        const previousParent = task.parentId;
        convert(command.parentId, command.preserveWork);
        const siblings = orderedChildren(tasks, command.parentId).filter(
          (item) => item.id !== task.id,
        );
        if (command.position > siblings.length)
          throw new DomainError(
            'INVALID_POSITION',
            'Недопустимая позиция задачи.',
          );
        task.parentId = command.parentId;
        task.updatedAt = timestamp;
        siblings.splice(command.position, 0, task);
        siblings.forEach((item, index) => {
          item.sortOrder = index;
        });
        if (previousParent !== command.parentId) reindex(previousParent);
        break;
      }
      case 'task.delete': {
        const task = find(command.taskId);
        const deleted = subtreeIds(tasks, task.id);
        snapshot.tasks = tasks.filter((item) => !deleted.has(item.id));
        snapshot.dependencies = snapshot.dependencies.filter(
          (edge) =>
            !deleted.has(edge.predecessorId) && !deleted.has(edge.successorId),
        );
        orderedChildren(snapshot.tasks, task.parentId).forEach(
          (item, index) => {
            item.sortOrder = index;
          },
        );
        break;
      }
      case 'undo':
        throw new DomainError(
          'INVALID_COMMAND',
          'Команда отмены требует транзакции.',
        );
    }
  }
}
