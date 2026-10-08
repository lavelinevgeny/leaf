import { expect, it } from 'vitest';
import { cascadeFs } from '../src/domain/fs-cascade.js';
import type { OptionalInput } from '../src/domain/scheduling-types.js';
import { leaf, edge } from './helpers/explicit-cpm-fixtures.js';
import { calculateSchedule } from '../src/domain/scheduling.js';
import type { OptionalTask } from '../src/domain/scheduling-types.js';

const input = (
  tasks: OptionalTask[],
  dependencies = [edge('AB', 'A', 'B')],
): OptionalInput => ({ calendarType: 'all-days', tasks, dependencies });
function edit(before: OptionalInput, replacement: OptionalTask): OptionalInput {
  const candidate = {
    ...before,
    tasks: before.tasks.map((task) =>
      task.id === replacement.id ? replacement : task,
    ),
  };
  return {
    ...candidate,
    tasks: cascadeFs(before, candidate, {
      changedSourceTaskIds: [replacement.id],
      explicitlyEditedTaskId: replacement.id,
      addedDependencyIds: [],
    }).tasks,
  };
}
function add(before: OptionalInput, dependency = edge('AB', 'A', 'B')) {
  const candidate = {
    ...before,
    dependencies: [...before.dependencies, dependency],
  };
  return {
    ...candidate,
    ...cascadeFs(before, candidate, {
      changedSourceTaskIds: [],
      explicitlyEditedTaskId: null,
      addedDependencyIds: [dependency.id],
    }),
  };
}

it('F01 moves tight chain without mutating inputs or filling duration', () => {
  const before: OptionalInput = {
    calendarType: 'all-days',
    tasks: [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('B', '2026-10-07', '2026-10-09'),
      leaf('C', '2026-10-10', '2026-10-11'),
    ],
    dependencies: [edge('AB', 'A', 'B'), edge('BC', 'B', 'C')],
  };
  const untouched = structuredClone(before);
  const candidate = {
    ...before,
    tasks: [
      leaf('A', '2026-10-07', '2026-10-08'),
      before.tasks[1]!,
      before.tasks[2]!,
    ],
  };
  for (const task of [...before.tasks, ...candidate.tasks]) Object.freeze(task);
  for (const dependency of before.dependencies) Object.freeze(dependency);
  Object.freeze(before.tasks);
  Object.freeze(before.dependencies);
  Object.freeze(before);
  Object.freeze(candidate.tasks);
  Object.freeze(candidate);
  const result = cascadeFs(before, candidate, {
    changedSourceTaskIds: ['A'],
    addedDependencyIds: [],
    explicitlyEditedTaskId: 'A',
  });
  expect(result.tasks).toEqual([
    leaf('A', '2026-10-07', '2026-10-08'),
    leaf('B', '2026-10-09', '2026-10-11'),
    leaf('C', '2026-10-12', '2026-10-13'),
  ]);
  expect(result.changedTaskIds).toEqual(['B', 'C']);
  expect(result.tasks[1]).not.toBe(candidate.tasks[1]);
  expect(before).toEqual(untouched);
  expect(candidate.tasks[1]!.inputStart).toBe('2026-10-07');
  const schedule = calculateSchedule({ ...candidate, tasks: result.tasks });
  expect(schedule.analysisStatus).toBe('ready');
  expect(schedule.criticalTaskIds).toEqual(['A', 'B', 'C']);
  expect(schedule.criticalDependencyIds).toEqual(['AB', 'BC']);
  expect(schedule.tasks.C).toMatchObject({
    finishDate: '2026-10-13',
    projectFloat: 0,
    constraintFloat: 0,
  });
});

it('F02 follows a tight chain earlier', () => {
  const before = input(
    [
      leaf('A', '2026-10-07', '2026-10-08'),
      leaf('B', '2026-10-09', '2026-10-11'),
      leaf('C', '2026-10-12', '2026-10-13'),
    ],
    [edge('AB', 'A', 'B'), edge('BC', 'B', 'C')],
  );
  const after = edit(before, leaf('A', '2026-10-05', '2026-10-06'));
  expect(after.tasks).toEqual([
    leaf('A', '2026-10-05', '2026-10-06'),
    leaf('B', '2026-10-07', '2026-10-09'),
    leaf('C', '2026-10-10', '2026-10-11'),
  ]);
  const schedule = calculateSchedule(after);
  expect(schedule.tasks.C).toMatchObject({
    finishDate: '2026-10-11',
    projectFloat: 0,
  });
});
it('F03 absorbs the gap, then follows the new tight boundary without an anchor', () => {
  let state = input([
    leaf('A', '2026-10-05', '2026-10-06'),
    leaf('B', '2026-10-10', '2026-10-11'),
  ]);
  for (const [a, b] of [
    [
      leaf('A', '2026-10-06', '2026-10-07'),
      leaf('B', '2026-10-10', '2026-10-11'),
    ],
    [
      leaf('A', '2026-10-09', '2026-10-10'),
      leaf('B', '2026-10-11', '2026-10-12'),
    ],
    [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('B', '2026-10-07', '2026-10-08'),
    ],
  ]) {
    state = edit(state, a!);
    expect(state.tasks[1]).toEqual(b);
  }
});
it('F04 processes fan-in using the controlling maximum', () => {
  let state = input(
    [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('X', '2026-10-05', '2026-10-08'),
      leaf('B', '2026-10-09', '2026-10-10'),
    ],
    [edge('AB', 'A', 'B'), edge('XB', 'X', 'B')],
  );
  state = edit(state, leaf('A', '2026-10-06', '2026-10-07'));
  expect(state.tasks[2]).toEqual(leaf('B', '2026-10-09', '2026-10-10'));
  state = edit(state, leaf('A', '2026-10-08', '2026-10-09'));
  expect(state.tasks[2]).toEqual(leaf('B', '2026-10-10', '2026-10-11'));
  state = edit(state, leaf('X', '2026-10-06', '2026-10-09'));
  expect(state.tasks[2]).toEqual(leaf('B', '2026-10-10', '2026-10-11'));
});
it('F05 shifts the diamond join once', () => {
  const state = input(
    [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('B', '2026-10-07', '2026-10-08'),
      leaf('C', '2026-10-07', '2026-10-09'),
      leaf('D', '2026-10-10', '2026-10-11'),
    ],
    [
      edge('AB', 'A', 'B'),
      edge('AC', 'A', 'C'),
      edge('BD', 'B', 'D'),
      edge('CD', 'C', 'D'),
    ],
  );
  expect(edit(state, leaf('A', '2026-10-07', '2026-10-08')).tasks).toEqual([
    leaf('A', '2026-10-07', '2026-10-08'),
    leaf('B', '2026-10-09', '2026-10-10'),
    leaf('C', '2026-10-09', '2026-10-11'),
    leaf('D', '2026-10-12', '2026-10-13'),
  ]);
});
it.each([
  ['weekdays', '2026-10-12', '2026-10-12', '2026-10-13'],
  ['all-days', '2026-10-10', '2026-10-10', '2026-10-11'],
] as const)(
  'F06 preserves span and null duration in %s',
  (calendarType, oldFinish, start, finish) => {
    const before = {
      ...input([
        leaf('A', '2026-10-08', '2026-10-08'),
        leaf('B', '2026-10-09', oldFinish),
      ]),
      calendarType,
    };
    expect(
      edit(before, leaf('A', '2026-10-09', '2026-10-09')).tasks[1],
    ).toEqual(leaf('B', start, finish));
  },
);
it('F07 finish-only predecessor shifts start-only successor without completing it', () => {
  const before = {
    ...input(
      [leaf('A', null, '2026-10-09'), leaf('B', '2026-10-08', null)],
      [],
    ),
    calendarType: 'weekdays' as const,
  };
  const after = add(before);
  expect(after.tasks[1]).toEqual(leaf('B', '2026-10-12', null));
  const schedule = calculateSchedule(after);
  expect(schedule.analysisStatus).toBe('incomplete');
  expect(schedule.criticalTaskIds).toEqual([]);
});
it('F08 empty new work stays empty with its supplied duration', () => {
  const before = input([leaf('A', '2026-10-05', '2026-10-07')], []);
  const candidate = {
    ...before,
    tasks: [...before.tasks, leaf('B', null, null, 1)],
    dependencies: [edge('AB', 'A', 'B')],
  };
  const result = cascadeFs(before, candidate, {
    changedSourceTaskIds: [],
    addedDependencyIds: ['AB'],
    explicitlyEditedTaskId: null,
  });
  expect(result.tasks[1]).toEqual(leaf('B', null, null, 1));
  expect(
    calculateSchedule({ ...candidate, tasks: result.tasks }).analysisStatus,
  ).toBe('incomplete');
});
it('F09 unknown predecessor permits a late bound but bars early pull', () => {
  let state = input(
    [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('U', null, null),
      leaf('B', '2026-10-07', '2026-10-08'),
    ],
    [edge('AB', 'A', 'B'), edge('UB', 'U', 'B')],
  );
  state = edit(state, leaf('A', '2026-10-07', '2026-10-08'));
  expect(state.tasks[2]).toEqual(leaf('B', '2026-10-09', '2026-10-10'));
  state = edit(state, leaf('A', '2026-10-05', '2026-10-06'));
  expect(state.tasks[2]).toEqual(leaf('B', '2026-10-09', '2026-10-10'));
});
it('F10 rejects explicit conflicting dates, but pushes relation-only additions', () => {
  const before = input([
    leaf('A', '2026-10-05', '2026-10-07'),
    leaf('B', '2026-10-08', '2026-10-09'),
  ]);
  expect(() => edit(before, leaf('B', '2026-10-07', '2026-10-08'))).toThrow(
    expect.objectContaining({
      code: 'EXPLICIT_PRECEDENCE_CONFLICT',
      message: expect.stringContaining('A → B'),
    }),
  );
  const relation = add(
    input([before.tasks[0]!, leaf('B', '2026-10-07', '2026-10-08')], []),
  );
  expect(relation.tasks[1]).toEqual(leaf('B', '2026-10-08', '2026-10-09'));
});
it.each([
  ['weekdays', '2026-10-12', '2026-10-12', '2026-10-13'],
  ['all-days', '2026-10-10', '2026-10-10', '2026-10-11'],
] as const)(
  'C25 normalizes an edited interval plus new incoming link in %s',
  (calendarType, finish, expectedStart, expectedFinish) => {
    const before = {
      ...input(
        [
          leaf('A', '2026-10-08', '2026-10-09'),
          leaf('B', '2026-10-05', '2026-10-06'),
        ],
        [],
      ),
      calendarType,
    };
    const candidate = {
      ...before,
      tasks: [before.tasks[0]!, leaf('B', '2026-10-09', finish)],
      dependencies: [edge('AB', 'A', 'B')],
    };
    expect(
      cascadeFs(before, candidate, {
        changedSourceTaskIds: ['B'],
        addedDependencyIds: ['AB'],
        explicitlyEditedTaskId: 'B',
      }).tasks[1],
    ).toEqual(leaf('B', expectedStart, expectedFinish));
  },
);
it('C25 added incoming link normalizes against all predecessors and cascades downstream', () => {
  const before = input(
    [
      leaf('A', null, '2026-10-09'),
      leaf('X', null, '2026-10-11'),
      leaf('U', null, null),
      leaf('B', '2026-10-12', '2026-10-13', 2),
      leaf('C', '2026-10-14', '2026-10-14', 1),
    ],
    [edge('XB', 'X', 'B'), edge('UB', 'U', 'B'), edge('BC', 'B', 'C')],
  );
  const candidate = {
    ...before,
    tasks: before.tasks.map((task) =>
      task.id === 'B' ? leaf('B', '2026-10-11', '2026-10-14', 4) : task,
    ),
    dependencies: [...before.dependencies, edge('AB', 'A', 'B')],
  };
  const result = cascadeFs(before, candidate, {
    changedSourceTaskIds: ['B'],
    addedDependencyIds: ['AB'],
    explicitlyEditedTaskId: 'B',
  });
  expect(result.tasks[3]).toEqual(leaf('B', '2026-10-12', '2026-10-15', 4));
  expect(result.tasks[4]).toEqual(leaf('C', '2026-10-16', '2026-10-16', 1));
});
it('C25 leaves a later explicit interval intact when adding a predecessor', () => {
  const before = input(
    [leaf('A', null, '2026-10-09'), leaf('B', '2026-10-05', '2026-10-06')],
    [],
  );
  const candidate = {
    ...before,
    tasks: [before.tasks[0]!, leaf('B', '2026-10-12', '2026-10-13')],
    dependencies: [edge('AB', 'A', 'B')],
  };
  const result = cascadeFs(before, candidate, {
    changedSourceTaskIds: ['B'],
    addedDependencyIds: ['AB'],
    explicitlyEditedTaskId: 'B',
  });
  expect(result.tasks).toEqual(candidate.tasks);
  expect(result.changedTaskIds).toEqual([]);
});
it('F11 rejects required done push but leaves optional done pull alone', () => {
  const before = input([
    leaf('A', '2026-10-05', '2026-10-06'),
    leaf('B', '2026-10-07', '2026-10-08', null, 'done'),
  ]);
  expect(() => edit(before, leaf('A', '2026-10-06', '2026-10-07'))).toThrow(
    expect.objectContaining({ code: 'DONE_PLAN_LOCKED' }),
  );
  const earlier = input([
    leaf('A', '2026-10-06', '2026-10-07'),
    leaf('B', '2026-10-08', '2026-10-09', null, 'done'),
  ]);
  expect(edit(earlier, leaf('A', '2026-10-05', '2026-10-06')).tasks[1]).toEqual(
    earlier.tasks[1],
  );
});
it('F12 removal never pulls work earlier', () => {
  const before = input([
    leaf('A', '2026-10-05', '2026-10-06'),
    leaf('B', '2026-10-07', '2026-10-08'),
  ]);
  expect(
    cascadeFs(
      before,
      { ...before, dependencies: [] },
      {
        changedSourceTaskIds: [],
        addedDependencyIds: [],
        explicitlyEditedTaskId: null,
      },
    ).tasks,
  ).toEqual(before.tasks);
});
it('F13 calendar overflow rejects without mutating candidate', () => {
  const before = input(
    [leaf('A', null, '9999-12-31'), leaf('B', '2026-10-05', null)],
    [],
  );
  expect(() => add(before)).toThrow(
    expect.objectContaining({ code: 'CALENDAR_RANGE_EXCEEDED' }),
  );
  expect(before.tasks[1]).toEqual(leaf('B', '2026-10-05', null));
});

it.each(['todo', 'done'] as const)(
  'F14 unchanged finish leaves historical conflict with %s successor intact',
  (status) => {
    const before: OptionalInput = {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-07'),
        leaf('B', '2026-10-07', '2026-10-08', null, status),
      ],
      dependencies: [edge('AB', 'A', 'B')],
    };
    const result = cascadeFs(
      before,
      {
        ...before,
        tasks: [leaf('A', '2026-10-06', '2026-10-07'), before.tasks[1]!],
      },
      {
        changedSourceTaskIds: ['A'],
        addedDependencyIds: [],
        explicitlyEditedTaskId: 'A',
      },
    );
    expect(result.tasks[1]).toEqual(before.tasks[1]);
    expect(result.changedTaskIds).toEqual([]);
  },
);

it.each(['todo', 'done-B', 'done-C'] as const)(
  'F15 unchanged controlling max preserves historical conflicts (%s)',
  (variant) => {
    const before = input(
      [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('X', '2026-10-05', '2026-10-09'),
        leaf(
          'B',
          '2026-10-09',
          '2026-10-10',
          null,
          variant === 'done-B' ? 'done' : 'todo',
        ),
        leaf(
          'C',
          '2026-10-10',
          '2026-10-11',
          null,
          variant === 'done-C' ? 'done' : 'todo',
        ),
      ],
      [edge('AB', 'A', 'B'), edge('XB', 'X', 'B'), edge('BC', 'B', 'C')],
    );
    expect(
      edit(before, leaf('A', '2026-10-06', '2026-10-07')).tasks.slice(1),
    ).toEqual(before.tasks.slice(1));
  },
);
it('F16 unshifted middle finish stops historical downstream repair', () => {
  const before = input(
    [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('B', '2026-10-10', '2026-10-11'),
      leaf('C', '2026-10-11', '2026-10-12'),
    ],
    [edge('AB', 'A', 'B'), edge('BC', 'B', 'C')],
  );
  expect(
    edit(before, leaf('A', '2026-10-06', '2026-10-07')).tasks.slice(1),
  ).toEqual(before.tasks.slice(1));
});
it('moving a lone start never activates its downstream finish boundary', () => {
  const before = input(
    [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('B', '2026-10-07', null, 2),
      leaf('C', '2026-10-06', '2026-10-07'),
    ],
    [edge('AB', 'A', 'B'), edge('BC', 'B', 'C')],
  );
  const after = edit(before, leaf('A', '2026-10-07', '2026-10-08'));
  expect(after.tasks[1]).toEqual(leaf('B', '2026-10-09', null, 2));
  expect(after.tasks[2]).toEqual(before.tasks[2]);
});
it('full pair movement preserves a supplied working span exactly', () => {
  const before = {
    ...input([
      leaf('A', '2026-10-08', '2026-10-08', 1),
      leaf('B', '2026-10-09', '2026-10-12', 2),
    ]),
    calendarType: 'weekdays' as const,
  };
  expect(
    edit(before, leaf('A', '2026-10-09', '2026-10-09', 1)).tasks[1],
  ).toEqual(leaf('B', '2026-10-12', '2026-10-13', 2));
});
it('finish becoming known activates successors; clearing it does not invent an early bound', () => {
  const before = input([
    leaf('A', null, null),
    leaf('B', '2026-10-07', '2026-10-08'),
  ]);
  const known = edit(before, leaf('A', null, '2026-10-08'));
  expect(known.tasks[1]).toEqual(leaf('B', '2026-10-09', '2026-10-10'));
  expect(edit(known, leaf('A', null, null)).tasks[1]).toEqual(known.tasks[1]);
});
it.each([
  leaf('B', null, '2026-10-06'),
  leaf('B', null, null, 3),
  leaf('B', null, null),
])('leaves incomplete successor unchanged: %j', (successor) => {
  expect(
    add(input([leaf('A', '2026-10-05', '2026-10-07'), successor], [])).tasks[1],
  ).toEqual(successor);
});
it('a lone weekend start remains a source note', () => {
  const before = {
    ...input(
      [leaf('A', null, '2026-10-09'), leaf('B', '2026-10-10', null)],
      [],
    ),
    calendarType: 'weekdays' as const,
  };
  expect(add(before).tasks[1]).toEqual(before.tasks[1]);
});
it('necessary repair rejects duration mismatch without normalizing invalid sources', () => {
  const before = input(
    [
      leaf('A', '2026-10-05', '2026-10-07'),
      leaf('B', '2026-10-07', '2026-10-08', 3),
    ],
    [],
  );
  expect(() => add(before)).toThrow(
    expect.objectContaining({ code: 'DURATION_MISMATCH' }),
  );
  expect(before.tasks[1]!.durationDays).toBe(3);
});
it('unavailable raw pair never supplies a bound or loses provenance', () => {
  const before = {
    ...input(
      [
        leaf('A', '2026-10-05', '2026-10-07'),
        leaf('B', '2026-10-08', '2026-10-09'),
      ],
      [],
    ),
    unavailableTaskIds: ['A'],
  };
  const after = add(before);
  expect(after.tasks).toEqual(before.tasks);
  expect(after.unavailableTaskIds).toEqual(['A']);
});
it('optional early pull leaves unavailable successor and its marker intact', () => {
  const before = {
    ...input([
      leaf('A', '2026-10-06', '2026-10-07'),
      leaf('B', '2026-10-08', '2026-10-09'),
    ]),
    unavailableTaskIds: ['B'],
  };
  const after = edit(before, leaf('A', '2026-10-05', '2026-10-06'));
  expect(after.tasks[1]).toEqual(before.tasks[1]);
  expect(after.unavailableTaskIds).toEqual(['B']);
});
it.each(['todo', 'done'] as const)(
  'a reduced historical raw conflict does not repair unavailable %s successor',
  (status) => {
    const before = {
      ...input([
        leaf('A', '2026-10-05', '2026-10-08'),
        leaf('B', '2026-10-07', '2026-10-09', null, status),
      ]),
      unavailableTaskIds: ['B'],
    };
    expect(
      edit(before, leaf('A', '2026-10-05', '2026-10-07')).tasks[1],
    ).toEqual(before.tasks[1]);
  },
);
it('optional early pull never normalizes an invalid full pair', () => {
  const before = input([
    leaf('A', '2026-10-06', '2026-10-07'),
    leaf('B', '2026-10-08', '2026-10-09', 3),
  ]);
  expect(edit(before, leaf('A', '2026-10-05', '2026-10-06')).tasks[1]).toEqual(
    before.tasks[1],
  );
});
it('an unchanged endpoint set supports early pull despite replacement edge IDs', () => {
  const before = input([
    leaf('A', '2026-10-06', '2026-10-07'),
    leaf('B', '2026-10-08', '2026-10-09'),
  ]);
  const candidate = {
    ...before,
    tasks: [leaf('A', '2026-10-05', '2026-10-06'), before.tasks[1]!],
    dependencies: [edge('new-AB', 'A', 'B')],
  };
  expect(
    cascadeFs(before, candidate, {
      changedSourceTaskIds: ['A'],
      addedDependencyIds: ['new-AB'],
      explicitlyEditedTaskId: 'A',
    }).tasks[1],
  ).toEqual(leaf('B', '2026-10-07', '2026-10-08'));
});
it('changed endpoints never authorize early pull', () => {
  const before = input([
    leaf('A', '2026-10-06', '2026-10-07'),
    leaf('X', '2026-10-05', '2026-10-06'),
    leaf('B', '2026-10-08', '2026-10-09'),
  ]);
  const candidate = { ...before, dependencies: [edge('XB', 'X', 'B')] };
  expect(
    cascadeFs(before, candidate, {
      changedSourceTaskIds: [],
      addedDependencyIds: ['XB'],
      explicitlyEditedTaskId: null,
    }).tasks,
  ).toEqual(before.tasks);
});
it.each(['predecessor', 'successor'] as const)(
  'new raw conflict with unavailable %s rejects',
  (side) => {
    const before = {
      ...input(
        [
          leaf('A', '2026-10-05', '2026-10-07'),
          leaf('B', '2026-10-07', '2026-10-08'),
        ],
        [],
      ),
      unavailableTaskIds: [side === 'predecessor' ? 'A' : 'B'],
    };
    expect(() => add(before)).toThrow();
  },
);
it('worsened raw conflict rejects but unchanged unrelated historical conflict survives', () => {
  const before = {
    ...input([
      leaf('A', '2026-10-05', '2026-10-07'),
      leaf('B', '2026-10-07', '2026-10-08'),
      leaf('X', '2026-10-05', '2026-10-06'),
    ]),
    unavailableTaskIds: ['B'],
  };
  expect(() => edit(before, leaf('A', '2026-10-05', '2026-10-08'))).toThrow();
  expect(edit(before, leaf('X', '2026-10-06', '2026-10-07')).tasks[1]).toEqual(
    before.tasks[1],
  );
});
