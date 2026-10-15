import { expect, it } from 'vitest';
import {
  canonicalPredecessorIds,
  incomingPredecessorIds,
  predecessorCandidates,
  successorCandidates,
} from '../../src/client/predecessor-view.js';
import {
  sameQuickDraft,
  hasQuickDraft,
  type QuickDraft,
} from '../../src/client/quick-add-view.js';
import { optionalTreeFixture, task } from './fixtures.js';
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
    predecessorCandidates(tree, null, [], 'Работа').map(({ task, path }) => [
      task.id,
      path,
    ]),
  ).toEqual([
    [a.id, 'P'],
    [b.id, 'Q'],
  ]);
  expect(
    predecessorCandidates(tree, c.id, [], '').map(({ task }) => task.id),
  ).toEqual([a.id]);
  expect(
    predecessorCandidates(tree, null, [a.id], 'Работа').map(
      ({ task }) => task.id,
    ),
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
    predecessorCandidates(tree, c.id, [], '').map(({ task }) => task.id),
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
    successorCandidates(tree, b.id, '').map(({ task }) => task.id),
  ).toEqual([d.id]);
  expect(successorCandidates(tree, b.id, 'branch')).toEqual([
    expect.objectContaining({ task: d, path: 'Branch' }),
  ]);
});
