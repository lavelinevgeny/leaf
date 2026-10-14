import { uuidSchema } from '../shared/contracts.js';
export type ProjectView = 'tasks' | 'journal';
export type WorkspaceVisit = {
  projectId: string;
  view: ProjectView;
  taskId: string | null;
  panel: 'details' | 'subtasks' | 'dependencies' | 'journal';
};
export type WorkspaceHistoryState = { leaf: { version: 1; visitId: string } };
export function parseWorkspaceUrl(url: URL): WorkspaceVisit | null {
  const projectId = url.searchParams.get('project'),
    taskId = url.searchParams.get('task'),
    view = url.searchParams.get('view') ?? 'tasks',
    panel = url.searchParams.get('panel') ?? 'details';
  if (
    !uuidSchema.safeParse(projectId).success ||
    (taskId !== null && !uuidSchema.safeParse(taskId).success) ||
    !['tasks', 'journal'].includes(view) ||
    !['details', 'subtasks', 'dependencies', 'journal'].includes(panel)
  )
    return null;
  for (const key of ['project', 'view', 'task', 'panel'])
    if (url.searchParams.getAll(key).length > 1) return null;
  return {
    projectId: projectId!,
    taskId,
    view: view as ProjectView,
    panel: panel as WorkspaceVisit['panel'],
  };
}
export function workspaceUrl(visit: WorkspaceVisit): string {
  const params = new URLSearchParams({
    project: visit.projectId,
    view: visit.view,
  });
  if (visit.taskId) params.set('task', visit.taskId);
  params.set('panel', visit.panel);
  return `?${params}`;
}
export function writeWorkspaceVisit(
  visit: WorkspaceVisit,
  visitId: string,
  mode: 'push' | 'replace',
) {
  const state: WorkspaceHistoryState = { leaf: { version: 1, visitId } };
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](
    state,
    '',
    workspaceUrl(visit),
  );
}
