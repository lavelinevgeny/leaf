import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/server/database.js';
import { Repository } from '../../src/server/repository.js';
import type { Command } from '../../src/shared/contracts.js';
export function journalFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'leaf-journal-synthetic-'));
  const path = join(dir, 'synthetic.sqlite');
  const db = openDatabase(path);
  let clock = Date.parse('2026-10-10T12:00:00.000Z');
  const now = () => clock++;
  const plan = new Repository(db, now);
  const project = plan.createProject('Synthetic journal project');
  const command = (command: Command, operationId = randomUUID()) =>
    plan.applyCommand(
      project.id,
      {
        contractVersion: 2,
        operationId,
        expectedRevision: plan.getTree(project.id, 'synthetic-session').project
          .revision,
        command,
      },
      'synthetic-session',
    );
  const tree = command({
    type: 'task.create',
    title: 'Parent',
    parentId: null,
  });
  const taskId = tree.tasks[0]!.id;
  return {
    dir,
    path,
    db,
    now,
    plan,
    project,
    taskId,
    command,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export function createInput(
  taskId: string,
  expectedJournalRevision = 0,
  body = '  Первая строка\nВторая строка  ',
) {
  return {
    journalContractVersion: 1 as const,
    operationId: randomUUID(),
    expectedJournalRevision,
    taskId,
    workDate: '2024-02-29',
    body,
  };
}
export function rawTables(
  db: ReturnType<typeof openDatabase>,
  tables: readonly string[],
) {
  return tables.map((table) =>
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  );
}
