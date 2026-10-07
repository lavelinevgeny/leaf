import type {
  OptionalInput,
  OptionalTask,
} from '../../src/domain/scheduling-types.js';
export const leaf = (
  id: string,
  inputStart: string | null,
  inputFinish: string | null,
  durationDays: number | null = null,
  status: OptionalTask['status'] = 'todo',
  parentId: string | null = null,
): OptionalTask => ({
  id,
  inputStart,
  inputFinish,
  durationDays,
  status,
  parentId,
});
export const edge = (
  id: string,
  predecessorId: string,
  successorId: string,
) => ({ id, predecessorId, successorId });
export type ReadyFixture = {
  id: string;
  input: OptionalInput;
  horizon: string;
  floats: [string, number, number][];
  critical: string[];
  criticalEdges: string[];
};
export const readyFixtures: ReadyFixture[] = [
  {
    id: 'P01',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-07', '2026-10-09'),
        leaf('C', '2026-10-10', '2026-10-11'),
      ],
      dependencies: [edge('AB', 'A', 'B'), edge('BC', 'B', 'C')],
    },
    horizon: '2026-10-11',
    floats: [
      ['A', 0, 0],
      ['B', 0, 0],
      ['C', 0, 0],
    ],
    critical: ['A', 'B', 'C'],
    criticalEdges: ['AB', 'BC'],
  },
  {
    id: 'P02',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-10', '2026-10-11'),
      ],
      dependencies: [edge('AB', 'A', 'B')],
    },
    horizon: '2026-10-11',
    floats: [
      ['A', 3, 3],
      ['B', 0, 0],
    ],
    critical: ['B'],
    criticalEdges: [],
  },
  {
    id: 'P03',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-07', '2026-10-09'),
        leaf('C', '2026-10-05', '2026-10-14'),
      ],
      dependencies: [edge('AB', 'A', 'B')],
    },
    horizon: '2026-10-14',
    floats: [
      ['A', 5, 0],
      ['B', 5, 5],
      ['C', 0, 0],
    ],
    critical: ['C'],
    criticalEdges: [],
  },
  {
    id: 'P04',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-07', '2026-10-09'),
        leaf('C', '2026-10-05', '2026-10-07'),
        leaf('D', '2026-10-08', '2026-10-09'),
      ],
      dependencies: [edge('AB', 'A', 'B'), edge('CD', 'C', 'D')],
    },
    horizon: '2026-10-09',
    floats: [
      ['A', 0, 0],
      ['B', 0, 0],
      ['C', 0, 0],
      ['D', 0, 0],
    ],
    critical: ['A', 'B', 'C', 'D'],
    criticalEdges: ['AB', 'CD'],
  },
  {
    id: 'P05',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-07', '2026-10-11'),
        leaf('C', '2026-10-05', '2026-10-07'),
        leaf('D', '2026-10-08', '2026-10-09'),
      ],
      dependencies: [edge('AB', 'A', 'B'), edge('CD', 'C', 'D')],
    },
    horizon: '2026-10-11',
    floats: [
      ['A', 0, 0],
      ['B', 0, 0],
      ['C', 2, 0],
      ['D', 2, 2],
    ],
    critical: ['A', 'B'],
    criticalEdges: ['AB'],
  },
  {
    id: 'P06',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06', null, 'done'),
        leaf('B', '2026-10-07', '2026-10-09'),
        leaf('C', '2026-10-05', '2026-10-14'),
      ],
      dependencies: [edge('AB', 'A', 'B')],
    },
    horizon: '2026-10-14',
    floats: [
      ['A', 5, 0],
      ['B', 5, 5],
      ['C', 0, 0],
    ],
    critical: ['C'],
    criticalEdges: [],
  },
  {
    id: 'P10',
    input: {
      calendarType: 'weekdays',
      tasks: [
        leaf('A', '2026-10-09', '2026-10-09'),
        leaf('B', '2026-10-12', '2026-10-13'),
      ],
      dependencies: [edge('AB', 'A', 'B')],
    },
    horizon: '2026-10-13',
    floats: [
      ['A', 0, 0],
      ['B', 0, 0],
    ],
    critical: ['A', 'B'],
    criticalEdges: ['AB'],
  },
  {
    id: 'P10-all-days',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-09', '2026-10-09'),
        leaf('B', '2026-10-12', '2026-10-13'),
      ],
      dependencies: [edge('AB', 'A', 'B')],
    },
    horizon: '2026-10-13',
    floats: [
      ['A', 2, 2],
      ['B', 0, 0],
    ],
    critical: ['B'],
    criticalEdges: [],
  },
  {
    id: 'N06',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-10', '2026-10-10'),
        leaf('C', '2026-10-05', '2026-10-14'),
      ],
      dependencies: [edge('AB', 'A', 'B')],
    },
    horizon: '2026-10-14',
    floats: [
      ['A', 7, 3],
      ['B', 4, 4],
      ['C', 0, 0],
    ],
    critical: ['C'],
    criticalEdges: [],
  },
  {
    id: 'N06-done',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-10', '2026-10-10', null, 'done'),
        leaf('C', '2026-10-05', '2026-10-14'),
      ],
      dependencies: [edge('AB', 'A', 'B')],
    },
    horizon: '2026-10-14',
    floats: [
      ['A', 7, 3],
      ['B', 4, 0],
      ['C', 0, 0],
    ],
    critical: ['C'],
    criticalEdges: [],
  },
  {
    id: 'C17-unmarked-done-control',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('D', '2026-10-05', '2026-10-07', 3, 'done'),
        leaf('K', '2026-10-09', '2026-10-10'),
        leaf('C', '2026-10-05', '2026-10-08'),
      ],
      dependencies: [edge('DK', 'D', 'K')],
    },
    horizon: '2026-10-10',
    floats: [
      ['C', 2, 2],
      ['D', 1, 0],
      ['K', 0, 0],
    ],
    critical: ['K'],
    criticalEdges: [],
  },
  {
    id: 'F01-fork-join',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-07', '2026-10-09'),
        leaf('C', '2026-10-07', '2026-10-08'),
        leaf('D', '2026-10-10', '2026-10-11'),
      ],
      dependencies: [
        edge('AB', 'A', 'B'),
        edge('AC', 'A', 'C'),
        edge('BD', 'B', 'D'),
        edge('CD', 'C', 'D'),
      ],
    },
    horizon: '2026-10-11',
    floats: [
      ['A', 0, 0],
      ['B', 0, 0],
      ['C', 1, 1],
      ['D', 0, 0],
    ],
    critical: ['A', 'B', 'D'],
    criticalEdges: ['AB', 'BD'],
  },
  {
    id: 'F02-tied-fork-join',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-07', '2026-10-09'),
        leaf('C', '2026-10-07', '2026-10-09'),
        leaf('D', '2026-10-10', '2026-10-11'),
      ],
      dependencies: [
        edge('AB', 'A', 'B'),
        edge('AC', 'A', 'C'),
        edge('BD', 'B', 'D'),
        edge('CD', 'C', 'D'),
      ],
    },
    horizon: '2026-10-11',
    floats: [
      ['A', 0, 0],
      ['B', 0, 0],
      ['C', 0, 0],
      ['D', 0, 0],
    ],
    critical: ['A', 'B', 'C', 'D'],
    criticalEdges: ['AB', 'AC', 'BD', 'CD'],
  },
  {
    id: 'F03-nontight-extra-edge',
    input: {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('B', '2026-10-07', '2026-10-09'),
        leaf('C', '2026-10-10', '2026-10-11'),
      ],
      dependencies: [
        edge('AB', 'A', 'B'),
        edge('BC', 'B', 'C'),
        edge('AC', 'A', 'C'),
      ],
    },
    horizon: '2026-10-11',
    floats: [
      ['A', 0, 0],
      ['B', 0, 0],
      ['C', 0, 0],
    ],
    critical: ['A', 'B', 'C'],
    criticalEdges: ['AB', 'BC'],
  },
];
