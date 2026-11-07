import { expect, it } from 'vitest';
import {
  canonicalPredecessorIds,
  incomingPredecessorIds,
  dependencyCandidates,
  dependencySelectionIssues,
  outgoingSuccessorIds,
  type DependencyProposal,
} from '../../src/client/predecessor-view.js';
import {
  sameQuickDraft,
  hasQuickDraft,
  type QuickDraft,
} from '../../src/client/quick-add-view.js';
import { optionalTreeFixture, task } from './fixtures.js';
const proposal = (
  current = task(99),
  predecessorIds: string[] = [],
  successorIds: string[] = [],
  isNew = true,
): DependencyProposal => ({
  task: current,
  predecessorIds,
  successorIds,
  isNew,
});
it('orders all real project leaves with explicit ancestor paths and excludes invalid endpoints', () => {
  const tree = optionalTreeFixture();
  const p = task(10, { title: 'P' }),
    q = task(11, { title: 'Q' });
  const a = task(12, { title: 'Работа', parentId: p.id }),
    b = task(13, { title: 'Работа', parentId: q.id });
  const c = task(14, { title: 'C' }),
    foreign = task(15, { projectId: 'foreign' });
  tree.tasks = [q, b, p, a, c, foreign];
  tree.dependencies = [
    {
      id: 'edge',
      projectId: tree.project.id,
      predecessorId: c.id,
      successorId: b.id,
    },
  ];
  expect(
    dependencyCandidates(tree, proposal(), 'predecessor', 'Работа').map(
      ({ task, path }) => [task.id, path],
    ),
  ).toEqual([
    [a.id, 'P'],
    [b.id, 'Q'],
  ]);
  expect(
    dependencyCandidates(
      tree,
      proposal(c, [], outgoingSuccessorIds(tree, c.id), false),
      'predecessor',
      '',
    ).map(({ task }) => task.id),
  ).toEqual([a.id]);
  expect(
    dependencyCandidates(
      tree,
      proposal(undefined, [a.id]),
      'predecessor',
      'Работа',
    ).map(({ task }) => task.id),
  ).toEqual([b.id]);
  // Replacing incoming edges uses the proposed selection, not obsolete stored IDs.
  tree.dependencies = [
    {
      id: 'edge',
      projectId: tree.project.id,
      predecessorId: a.id,
      successorId: c.id,
    },
  ];
  expect(
    dependencyCandidates(
      tree,
      proposal(c, [], outgoingSuccessorIds(tree, c.id), false),
      'predecessor',
      '',
    ).map(({ task }) => task.id),
  ).toContain(a.id);
  expect(incomingPredecessorIds(tree, c.id)).toEqual([a.id]);
  expect(canonicalPredecessorIds(['X', 'A', 'X'])).toEqual(['A', 'X']);
});
it('compares complete quick drafts, canonical predecessor sets and exact contexts', () => {
  const draft: QuickDraft = {
    title: 'B',
    context: { parentId: null },
    plan: { inputStart: null, inputFinish: null, durationDays: 1 },
    predecessorIds: ['A', 'X'],
    successorIds: [],
  };
  expect(sameQuickDraft(draft, { ...draft, predecessorIds: ['X', 'A'] })).toBe(
    true,
  );
  expect(sameQuickDraft(draft, { ...draft, predecessorIds: ['A'] })).toBe(
    false,
  );
  expect(sameQuickDraft(draft, { ...draft, title: ' B' })).toBe(false);
  expect(sameQuickDraft(draft, { ...draft, context: { parentId: 'P' } })).toBe(
    false,
  );
  expect(
    sameQuickDraft(draft, {
      ...draft,
      context: { parentId: null, afterId: 'A' },
    }),
  ).toBe(false);
  expect(
    sameQuickDraft(draft, {
      ...draft,
      plan: { ...draft.plan, durationDays: null },
    }),
  ).toBe(false);
  expect(hasQuickDraft({ ...draft, title: '', predecessorIds: ['A'] })).toBe(
    true,
  );
  expect(hasQuickDraft({ ...draft, title: '', predecessorIds: [] })).toBe(
    false,
  );
});

it('successor candidates exclude self duplicate summary foreign and cycles with ancestor search', () => {
  const tree = optionalTreeFixture(),
    p = task(10, { title: 'Branch' }),
    a = task(1),
    b = task(2),
    c = task(3),
    d = task(4, { parentId: p.id });
  tree.tasks = [p, a, b, c, d, task(5, { projectId: 'foreign' })];
  tree.dependencies = [
    {
      id: 'ab',
      projectId: tree.project.id,
      predecessorId: a.id,
      successorId: b.id,
    },
    {
      id: 'bc',
      projectId: tree.project.id,
      predecessorId: b.id,
      successorId: c.id,
    },
  ];
  expect(
    dependencyCandidates(
      tree,
      proposal(b, [a.id], [c.id], false),
      'successor',
      '',
    ).map(({ task }) => task.id),
  ).toEqual([d.id]);
  expect(
    dependencyCandidates(
      tree,
      proposal(b, [a.id], [c.id], false),
      'successor',
      'branch',
    ),
  ).toEqual([expect.objectContaining({ task: d, path: 'Branch' })]);
});

it('validates each selected edge against the complete mixed proposal independent of group order', () => {
  const tree = optionalTreeFixture();
  const a = task(1, { title: 'A' }),
    b = task(2, { title: 'B' }),
    t = task(3, { title: 'T' });
  tree.tasks = [a, b];
  tree.dependencies = [
    {
      id: 'BA',
      projectId: tree.project.id,
      predecessorId: b.id,
      successorId: a.id,
    },
  ];
  const draft = proposal(t, [a.id]);
  expect(
    dependencyCandidates(tree, draft, 'successor', '').map((x) => x.task.id),
  ).not.toContain(b.id);
  expect(
    dependencySelectionIssues(tree, { ...draft, successorIds: [b.id] }),
  ).toEqual([
    expect.objectContaining({
      direction: 'predecessor',
      taskId: a.id,
      reason: expect.any(String),
    }),
    expect.objectContaining({
      direction: 'successor',
      taskId: b.id,
      reason: expect.any(String),
    }),
  ]);
  expect(
    dependencyCandidates(
      tree,
      proposal({ ...t, parentId: b.id }),
      'predecessor',
      '',
    ).map((x) => x.task.id),
  ).not.toContain(b.id);
  // Existing parent edges are handled by server preserveWork; they do not invalidate an unrelated selected edge.
  tree.dependencies = [
    {
      id: 'AB',
      projectId: tree.project.id,
      predecessorId: a.id,
      successorId: b.id,
    },
  ];
  expect(
    dependencySelectionIssues(tree, proposal({ ...t, parentId: b.id }, [a.id])),
  ).toEqual([]);
});
it('uses full tree order, trimmed case-insensitive paths and includes completed undated leaves', () => {
  const tree = optionalTreeFixture();
  const parent = task(5, { title: 'Скрытая ВЕТКА' }),
    child = task(6, { title: 'Работа', parentId: parent.id, status: 'done' });
  const first = task(1, { title: 'Первая' }),
    foreign = task(2, { projectId: 'foreign' });
  tree.tasks = [child, parent, foreign, first];
  expect(
    dependencyCandidates(tree, proposal(), 'predecessor', '').map(
      (x) => x.task.id,
    ),
  ).toEqual([first.id, child.id]);
  expect(
    dependencyCandidates(tree, proposal(), 'successor', '  скрытая ветка  '),
  ).toEqual([{ task: child, path: parent.title, incomplete: true }]);
  expect(
    dependencyCandidates(
      tree,
      proposal(first, [], [], false),
      'successor',
      '',
    ).map((x) => x.task.id),
  ).toEqual([child.id]);
});
it('keeps invalid selected endpoints as issues on refresh and validates duplicates and both directions', () => {
  const tree = optionalTreeFixture();
  const a = task(1),
    b = task(2),
    t = task(3),
    foreign = task(4, { projectId: 'foreign' });
  tree.tasks = [a, b, t, foreign];
  const selected = proposal(
    t,
    [a.id, 'missing', foreign.id, t.id, a.id],
    [b.id],
    false,
  );
  expect(
    dependencySelectionIssues(tree, selected).map((x) => [
      x.direction,
      x.taskId,
    ]),
  ).toEqual([
    ['predecessor', a.id],
    ['predecessor', 'missing'],
    ['predecessor', foreign.id],
    ['predecessor', t.id],
    ['predecessor', a.id],
  ]);
  tree.tasks = [t, b, task(7, { parentId: b.id })];
  expect(
    dependencySelectionIssues(tree, proposal(t, [a.id], [b.id], false)),
  ).toEqual([
    expect.objectContaining({ taskId: a.id }),
    expect.objectContaining({ taskId: b.id }),
  ]);
});
it('replaces obsolete incident edges while preserving the opposite proposal and reports canonical outgoing IDs', () => {
  const tree = optionalTreeFixture();
  const a = task(1),
    b = task(2),
    t = task(3);
  tree.tasks = [a, b, t];
  tree.dependencies = [
    {
      id: 'AT',
      projectId: tree.project.id,
      predecessorId: a.id,
      successorId: t.id,
    },
    {
      id: 'TB',
      projectId: tree.project.id,
      predecessorId: t.id,
      successorId: b.id,
    },
  ];
  expect(outgoingSuccessorIds(tree, t.id)).toEqual([b.id]);
  expect(
    dependencyCandidates(tree, proposal(t, [], [], false), 'successor', '').map(
      (x) => x.task.id,
    ),
  ).toEqual([a.id, b.id]);
  expect(
    dependencyCandidates(
      tree,
      proposal(t, [a.id], [b.id], false),
      'successor',
      '',
    ),
  ).toEqual([]);
  expect(
    dependencySelectionIssues(tree, proposal(t, [a.id], [a.id], false)),
  ).toEqual([
    expect.objectContaining({ direction: 'predecessor', taskId: a.id }),
    expect.objectContaining({ direction: 'successor', taskId: a.id }),
  ]);
});

it('owns successor-only quick drafts and compares successor sets canonically', () => {
  const draft: QuickDraft = {
    title: '',
    context: { parentId: null },
    plan: { inputStart: null, inputFinish: null, durationDays: 1 },
    predecessorIds: [],
    successorIds: ['B'],
  };
  expect(hasQuickDraft(draft)).toBe(true);
  expect(sameQuickDraft(draft, { ...draft, successorIds: [] })).toBe(false);
  expect(
    sameQuickDraft(
      { ...draft, successorIds: ['B', 'C'] },
      { ...draft, successorIds: ['C', 'B'] },
    ),
  ).toBe(true);
});
