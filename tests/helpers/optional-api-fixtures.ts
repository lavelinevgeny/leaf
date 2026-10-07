import type Database from 'better-sqlite3';
export function rawSyntheticCountsAndRevision(
  db: Database.Database,
  projectId: string,
) {
  return {
    revision: (
      db.prepare('SELECT revision FROM projects WHERE id=?').get(projectId) as {
        revision: number;
      }
    ).revision,
    counts: [
      'projects',
      'tasks',
      'dependencies',
      'operations',
      'undo_snapshots',
    ].map(
      (table) =>
        (
          db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n,
    ),
  };
}
export function validLegacyBodyForRoute(method: string, url: string) {
  if (method === 'POST' && url === '/api/projects')
    return { title: 'Synthetic legacy project' };
  if (method === 'PATCH')
    return {
      title: 'Synthetic rename',
      expectedRevision: 0,
      operationId: '33333333-3333-4333-8333-333333333333',
    };
  return {
    expectedRevision: 0,
    operationId: '44444444-4444-4444-8444-444444444444',
    command: {
      type: 'task.create',
      title: 'Synthetic legacy task',
      parentId: null,
    },
  };
}
