import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { indexToDate, nextWorkingDay } from '../domain/calendar.js';
import {
  liveProjectTreeV2Schema,
  liveScheduleResponseV2Schema,
  type Command,
  type SourceFields,
} from '../shared/contracts.js';
import { Repository } from './repository.js';
export function seedDemo(
  db: Database.Database,
  repository: Repository,
  now: () => number,
): void {
  const today = new Date(now()).toISOString().slice(0, 10);
  const base = nextWorkingDay(today, 'weekdays');
  const work = (n: number) => indexToDate(n, base, 'weekdays');
  const session = randomUUID();
  db.transaction(() => {
    const project = repository.createProject('Демо-проект');
    let tree = repository.getTree(project.id, session);
    const command = (command: Command) => {
      tree = repository.applyCommand(
        project.id,
        {
          contractVersion: 2,
          expectedRevision: tree.project.revision,
          operationId: randomUUID(),
          command,
        },
        session,
      );
    };
    const create = (
      title: string,
      parentId: string | null,
      source: SourceFields = {
        inputStart: null,
        inputFinish: null,
        durationDays: null,
      },
    ) => {
      command({ type: 'task.create', title, parentId, ...source });
      return tree.tasks.find((task) => task.title === title)!.id;
    };
    const launch = create('Запуск примера', null);
    const preparation = create('Подготовка', launch);
    const plan = create('План работ', preparation, {
      inputStart: base,
      inputFinish: work(1),
      durationDays: 2,
    });
    const implementation = create('Реализация', launch, {
      inputStart: work(2),
      inputFinish: work(4),
      durationDays: 3,
    });
    const verification = create('Проверка', launch, {
      inputStart: work(5),
      inputFinish: work(5),
      durationDays: 1,
    });
    const ideas = create('Идеи', null);
    const research = create('Исследовать вариант', ideas, {
      inputStart: null,
      inputFinish: null,
      durationDays: 2,
    });
    const discussion = create('Обсудить результат', ideas);
    create('Уточнить начало', ideas, {
      inputStart: base,
      inputFinish: null,
      durationDays: null,
    });
    create('Уточнить окончание', ideas, {
      inputStart: null,
      inputFinish: work(4),
      durationDays: null,
    });
    for (const [predecessorId, successorId] of [
      [plan, implementation],
      [implementation, verification],
      [research, discussion],
    ] as const)
      command({ type: 'dependency.create', predecessorId, successorId });
    db.prepare('DELETE FROM operations WHERE sessionId=?').run(session);
    db.prepare('DELETE FROM undo_snapshots WHERE sessionId=?').run(session);
    liveProjectTreeV2Schema.parse(repository.getTree(project.id, session));
    liveScheduleResponseV2Schema.parse(repository.getSchedule(project.id));
  }).immediate();
}
