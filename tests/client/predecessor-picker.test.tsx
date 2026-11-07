// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import {
  cleanup,
  render,
  screen,
  act,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PredecessorPicker } from '../../src/client/PredecessorPicker.js';
import { optionalTreeFixture, task } from './fixtures.js';
import type { DependencyProposal } from '../../src/client/predecessor-view.js';
const proposal = (
  current = task(99),
  predecessorIds: string[] = [],
  successorIds: string[] = [],
): DependencyProposal => ({
  task: current,
  predecessorIds,
  successorIds,
  isNew: current.id === task(99).id,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('focuses search, adds once with keyboard and contains Escape without trapping Tab', async () => {
  const tree = optionalTreeFixture();
  tree.tasks = [task(1, { title: 'A' }), task(2, { title: 'B' })];
  const onAdd = vi.fn(),
    onClose = vi.fn(),
    outer = vi.fn();
  render(
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') outer();
      }}
    >
      <PredecessorPicker
        tree={tree}
        proposal={proposal(tree.tasks[1]!)}
        direction="predecessor"
        disabled={false}
        onAdd={onAdd}
        onRemove={vi.fn()}
        onClose={onClose}
      />
    </div>,
  );
  const user = userEvent.setup();
  expect(screen.getByRole('searchbox')).toHaveFocus();
  await user.type(screen.getByRole('searchbox'), 'A');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(
    'predecessor',
    tree.tasks[0]!.id,
  );
  await user.tab();
  expect(screen.getByRole('searchbox')).not.toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
});
it('shows loading, no leaves, no query matches, paths, incomplete hints and missing selected IDs', async () => {
  const props = {
    proposal: proposal(),
    direction: 'predecessor' as const,
    disabled: false,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<PredecessorPicker {...props} tree={null} />);
  expect(screen.getByRole('status')).toHaveTextContent('Загрузка');
  const tree = optionalTreeFixture();
  tree.tasks = [];
  view.rerender(<PredecessorPicker {...props} tree={tree} />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Нет других конечных работ',
  );
  const p = task(1, { title: 'P' }),
    q = task(2, { title: 'Q' });
  tree.tasks = [
    p,
    task(3, { title: 'Работа', parentId: p.id }),
    q,
    task(4, { title: 'Работа', parentId: q.id }),
  ];
  view.rerender(
    <PredecessorPicker
      {...props}
      tree={{ ...tree }}
      proposal={proposal(undefined, ['missing'])}
    />,
  );
  expect(screen.getByText('Задача удалена → Работа 99')).toBeInTheDocument();
  expect(screen.getByText('P')).toBeInTheDocument();
  expect(screen.getByText('Q')).toBeInTheDocument();
  expect(
    screen.getAllByText(
      'Связь сохранится; перенос использует только заданные даты',
    ),
  ).toHaveLength(2);
  await userEvent.type(screen.getByRole('searchbox'), 'unknown');
  expect(screen.getByRole('status')).toHaveTextContent('Ничего не найдено');
});
it('renders selected removal actions and errors, prevents disabled mutations', async () => {
  const tree = optionalTreeFixture();
  const a = tree.tasks[1]!;
  const onAdd = vi.fn(),
    onRemove = vi.fn();
  const props = {
    tree,
    proposal: proposal(undefined, [a.id]),
    direction: 'predecessor' as const,
    disabled: false,
    onAdd,
    onRemove,
    onClose: vi.fn(),
  };
  const view = render(<PredecessorPicker {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Убрать предшественника: ' + a.title }),
  );
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('predecessor', a.id);
  view.rerender(
    <PredecessorPicker {...props} disabled error="Ошибка сервера" />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Ошибка сервера');
  expect(
    screen.getByRole('button', { name: 'Убрать предшественника: ' + a.title }),
  ).toBeDisabled();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onAdd).not.toHaveBeenCalled();
});

it('keeps keyboard-active options in the bounded list and clamps selected semantics after a candidate disappears', async () => {
  const tree = optionalTreeFixture();
  tree.tasks = Array.from({ length: 20 }, (_, index) =>
    task(index + 1, { title: `Работа ${index + 1}` }),
  );
  const props = {
    tree,
    proposal: proposal(),
    direction: 'predecessor' as const,
    disabled: false,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<PredecessorPicker {...props} />);
  const list = screen.getByRole('listbox');
  Object.defineProperty(list, 'clientHeight', {
    configurable: true,
    value: 220,
  });
  vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => ({
    top: 100,
    bottom: 320,
    left: 0,
    right: 320,
    width: 320,
    height: 220,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  }));
  for (const [index, option] of screen.getAllByRole('option').entries())
    vi.spyOn(option, 'getBoundingClientRect').mockImplementation(() => ({
      top: 100 + index * 44 - list.scrollTop,
      bottom: 144 + index * 44 - list.scrollTop,
      left: 0,
      right: 320,
      width: 320,
      height: 44,
      x: 0,
      y: 100 + index * 44 - list.scrollTop,
      toJSON: () => ({}),
    }));
  const user = userEvent.setup();
  await user.keyboard('{ArrowUp}');
  const last = screen.getAllByRole('option').at(-1)!;
  expect(last).toHaveAttribute('aria-selected', 'true');
  expect(last.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    list.getBoundingClientRect().top,
  );
  expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    list.getBoundingClientRect().bottom,
  );
  expect(screen.getByRole('searchbox')).toHaveFocus();
  list.scrollTop = 0;
  fireEvent.scroll(list);
  expect(list.scrollTop).toBe(0);
  view.rerender(
    <PredecessorPicker
      {...props}
      proposal={proposal(undefined, [tree.tasks.at(-1)!.id])}
    />,
  );
  const clamped = screen.getAllByRole('option').at(-1)!;
  expect(clamped).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('searchbox')).toHaveAttribute(
    'aria-activedescendant',
    clamped.id,
  );
  await user.keyboard('{ArrowDown}{Enter}');
  expect(props.onAdd).toHaveBeenCalledExactlyOnceWith(
    'predecessor',
    tree.tasks[0]!.id,
  );
  const first = screen.getAllByRole('option')[0]!;
  expect(first.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    list.getBoundingClientRect().top,
  );
  expect(first.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    list.getBoundingClientRect().bottom,
  );
});
it('repositions after intrinsic growth without window scroll or resize and cleans up observation', () => {
  let notify!: (
    entries: ResizeObserverEntry[],
    observer: ResizeObserver,
  ) => void;
  const disconnect = vi.fn(),
    observe = vi.fn();
  class SyntheticResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      notify = callback;
    }
    observe = observe;
    unobserve = vi.fn();
    disconnect = disconnect;
  }
  vi.stubGlobal('ResizeObserver', SyntheticResizeObserver);
  const trigger = document.createElement('button');
  document.body.append(trigger);
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
    top: 750,
    bottom: 780,
    left: 400,
    right: 430,
    width: 30,
    height: 30,
    x: 400,
    y: 750,
    toJSON: () => ({}),
  });
  trigger.focus();
  const props = {
    proposal: proposal(),
    direction: 'predecessor' as const,
    disabled: false,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<PredecessorPicker {...props} tree={null} />);
  const popup = screen.getByRole('dialog');
  let height = 120;
  Object.defineProperty(popup, 'offsetHeight', {
    configurable: true,
    get: () => height,
  });
  // jsdom geometry is explicit; the browser probe below uses real layout and native observation.
  act(() => notify([], {} as ResizeObserver));
  expect(Number.parseFloat(popup.style.top) + height).toBeLessThanOrEqual(
    window.innerHeight - 12,
  );
  const oldTop = Number.parseFloat(popup.style.top);
  height = 340;
  view.rerender(
    <PredecessorPicker
      {...props}
      tree={optionalTreeFixture()}
      error="Синтетическая ошибка, увеличивающая содержимое"
    />,
  );
  act(() => notify([], {} as ResizeObserver));
  expect(Number.parseFloat(popup.style.top)).toBeLessThan(oldTop);
  expect(Number.parseFloat(popup.style.top) + height).toBeLessThanOrEqual(
    window.innerHeight - 12,
  );
  expect(observe).toHaveBeenCalledWith(popup);
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
  trigger.remove();
  vi.unstubAllGlobals();
});

it('Enter selects the first search result without submitting its enclosing form', async () => {
  const tree = optionalTreeFixture();
  tree.tasks = [task(1, { title: 'A' }), task(2, { title: 'B' })];
  const onAdd = vi.fn(),
    submit = vi.fn();
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PredecessorPicker
        tree={tree}
        proposal={proposal(tree.tasks[1]!)}
        direction="predecessor"
        disabled={false}
        onAdd={onAdd}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    </form>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole('searchbox'), 'A');
  await user.keyboard('{Enter}');
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(
    'predecessor',
    tree.tasks[0]!.id,
  );
  expect(submit).not.toHaveBeenCalled();
});

it('uses the successor direction for labels, endpoints and shared keyboard search', async () => {
  const tree = optionalTreeFixture();
  tree.tasks = [task(1, { title: 'A' }), task(2, { title: 'B' })];
  const onAdd = vi.fn();
  render(
    <PredecessorPicker
      tree={tree}
      direction="successor"
      proposal={proposal(tree.tasks[0]!)}
      disabled={false}
      onAdd={onAdd}
      onRemove={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(
    screen.getByRole('dialog', { name: 'Добавить последователя' }),
  ).toBeVisible();
  await userEvent.type(screen.getByRole('searchbox'), 'B{Enter}');
  expect(onAdd).toHaveBeenCalledExactlyOnceWith('successor', tree.tasks[1]!.id);
});

it('switches direction without losing query, previews the first result and removes chips by their own group', async () => {
  const tree = optionalTreeFixture();
  const t = task(3, { title: 'T' }),
    a = task(1, { title: 'A' }),
    b = task(2, { title: 'B' }),
    c = task(4, { title: 'C' });
  tree.tasks = [a, b, t, c];
  const onAdd = vi.fn(),
    onRemove = vi.fn();
  render(
    <PredecessorPicker
      tree={tree}
      proposal={proposal(t, [a.id], [c.id])}
      direction="selectable"
      disabled={false}
      onAdd={onAdd}
      onRemove={onRemove}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'После' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await userEvent.type(screen.getByRole('searchbox'), 'B');
  const before = screen.getByRole('button', { name: 'Перед' });
  await userEvent.click(before);
  expect(before).toHaveFocus();
  expect(screen.getByRole('searchbox')).toHaveValue('B');
  expect(screen.getByText('T → B')).toBeVisible();
  expect(screen.getByLabelText('T выполняется перед B')).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Убрать предшественника: A' }),
  );
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('predecessor', a.id);
  await userEvent.click(screen.getByRole('searchbox'));
  await userEvent.keyboard('{Enter}');
  expect(onAdd).toHaveBeenCalledExactlyOnceWith('successor', b.id);
  expect(screen.getByText('A → T')).toBeVisible();
  expect(screen.getByText('T → C')).toBeVisible();
});
it('contains composition Enter and suppresses outer submit and shortcuts', () => {
  const tree = optionalTreeFixture();
  tree.tasks = [task(1), task(2)];
  const onAdd = vi.fn(),
    outer = vi.fn();
  render(
    <form onSubmit={outer} onKeyDown={outer}>
      <PredecessorPicker
        tree={tree}
        proposal={proposal()}
        direction="selectable"
        disabled={false}
        onAdd={onAdd}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    </form>,
  );
  const search = screen.getByRole('searchbox');
  fireEvent.compositionStart(search);
  expect(fireEvent.keyDown(search, { key: 'Enter', isComposing: true })).toBe(
    false,
  );
  fireEvent.keyDown(search, { key: 'Enter' });
  fireEvent.compositionEnd(search);
  expect(onAdd).not.toHaveBeenCalled();
  expect(outer).not.toHaveBeenCalled();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(
    'predecessor',
    tree.tasks[0]!.id,
  );
});
it('keeps fixed mode chips scoped, exposes reload and retained invalid selection separately from write errors', async () => {
  const tree = optionalTreeFixture();
  tree.tasks = [];
  const onReload = vi.fn(),
    onRemove = vi.fn();
  const props = {
    proposal: proposal(undefined, ['missing'], ['outgoing']),
    direction: 'predecessor' as const,
    disabled: false,
    onAdd: vi.fn(),
    onRemove,
    onClose: vi.fn(),
  };
  const view = render(
    <PredecessorPicker
      {...props}
      tree={null}
      loadError="Не удалось загрузить задачи"
      onReload={onReload}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Не удалось загрузить задачи',
  );
  expect(screen.queryByText('Загрузка…')).toBeNull();
  await userEvent.click(
    screen.getByRole('button', { name: 'Загрузить актуальный проект' }),
  );
  expect(onReload).toHaveBeenCalledOnce();
  view.rerender(
    <PredecessorPicker {...props} tree={tree} error="Запись отклонена" />,
  );
  expect(screen.queryByRole('button', { name: 'Перед' })).toBeNull();
  expect(screen.getAllByRole('button', { name: /Убрать/ })).toHaveLength(1);
  expect(
    screen.getByText('Обе работы должны принадлежать проекту.'),
  ).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Запись отклонена');
  expect(screen.getByRole('status')).toHaveTextContent(
    'Нет других конечных работ',
  );
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Убрать предшественника: Задача удалена',
    }),
  );
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('predecessor', 'missing');
});
it('blocks toggle add and remove while pending and leaves close and keyboard navigation available', async () => {
  const tree = optionalTreeFixture();
  tree.tasks = [task(1), task(2)];
  const onAdd = vi.fn(),
    onRemove = vi.fn(),
    onClose = vi.fn();
  render(
    <PredecessorPicker
      tree={tree}
      proposal={proposal(undefined, [task(1).id])}
      direction="selectable"
      disabled
      blockedReason="Ожидание сохранения"
      onAdd={onAdd}
      onRemove={onRemove}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole('button', { name: 'Перед' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: /Убрать предшественника/ }),
  ).toBeDisabled();
  expect(screen.getByRole('option')).toBeDisabled();
  expect(screen.getByText('Ожидание сохранения')).toBeVisible();
  await userEvent.keyboard('{Enter}');
  expect(onAdd).not.toHaveBeenCalled();
  expect(onRemove).not.toHaveBeenCalled();
  await userEvent.tab({ shift: true });
  expect(
    screen.getByRole('button', { name: 'Закрыть выбор предшественников' }),
  ).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledOnce();
});
it('supports native Enter on direction removal and close buttons, with Tab in both directions', async () => {
  const tree = optionalTreeFixture();
  tree.tasks = [task(1), task(2)];
  const onRemove = vi.fn(),
    onClose = vi.fn();
  render(
    <PredecessorPicker
      tree={tree}
      proposal={proposal(undefined, [task(1).id])}
      direction="selectable"
      disabled={false}
      onAdd={vi.fn()}
      onRemove={onRemove}
      onClose={onClose}
    />,
  );
  const user = userEvent.setup();
  await user.tab({ shift: true });
  expect(
    screen.getByRole('button', { name: /Убрать предшественника/ }),
  ).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('predecessor', task(1).id);
  expect(screen.getByRole('searchbox')).toHaveFocus();
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  const before = screen.getByRole('button', { name: 'Перед' });
  expect(before).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(before).toHaveAttribute('aria-pressed', 'true');
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  expect(
    screen.getByRole('button', { name: 'Закрыть выбор последователей' }),
  ).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onClose).toHaveBeenCalledOnce();
});
it('uses full accessible paths for duplicate results and keeps query and selected issues across snapshot changes', async () => {
  const tree = optionalTreeFixture(),
    p = task(1, { title: 'P' }),
    q = task(2, { title: 'Q' }),
    a = task(3, { title: 'Same', parentId: p.id }),
    b = task(4, { title: 'Same', parentId: q.id });
  tree.tasks = [p, q, a, b];
  const props = {
    proposal: proposal(),
    direction: 'selectable' as const,
    disabled: false,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<PredecessorPicker {...props} tree={tree} />);
  await userEvent.type(screen.getByRole('searchbox'), 'Same');
  expect(screen.getByRole('option', { name: /Same · P/ })).toBeVisible();
  expect(screen.getByRole('option', { name: /Same · Q/ })).toBeVisible();
  view.rerender(
    <PredecessorPicker
      {...props}
      proposal={proposal(undefined, [a.id])}
      tree={{ ...tree, tasks: [p, q, b] }}
    />,
  );
  expect(screen.getByRole('searchbox')).toHaveValue('Same');
  expect(
    screen.getByText('Обе работы должны принадлежать проекту.'),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: /Убрать предшественника/ }),
  ).toBeEnabled();
});

it('keeps fixed chip arrows and distinguishes duplicate selected titles by their full path', async () => {
  const tree = optionalTreeFixture(),
    p = task(1, { title: 'P' }),
    q = task(2, { title: 'Q' }),
    a = task(3, { title: 'Same', parentId: p.id }),
    b = task(4, { title: 'Same', parentId: q.id });
  tree.tasks = [p, q, a, b];
  const onRemove = vi.fn();
  render(
    <PredecessorPicker
      tree={tree}
      proposal={proposal(undefined, [a.id, b.id])}
      direction="predecessor"
      disabled={false}
      onAdd={vi.fn()}
      onRemove={onRemove}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getAllByText('Same → Работа 99')).toHaveLength(2);
  expect(screen.getByTitle('P / Same → Работа 99')).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Убрать предшественника: Same · Q' }),
  );
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('predecessor', b.id);
});

it.each([false, true])(
  'keyboard removal returns to search before Escape (last: %s)',
  async (last) => {
    const onClose = vi.fn(),
      outsideEscape = vi.fn();
    function Editor() {
      const [ids, setIds] = useState(
        last ? [task(1).id] : [task(1).id, task(2).id],
      );
      return (
        <div
          onKeyDown={(e) => {
            if (e.key === 'Escape') outsideEscape();
          }}
        >
          <PredecessorPicker
            tree={{ ...optionalTreeFixture(), tasks: [task(1), task(2)] }}
            proposal={proposal(undefined, [], ids)}
            direction="selectable"
            disabled={false}
            onAdd={vi.fn()}
            onRemove={(_direction, id) =>
              setIds((previous) =>
                previous.filter((selected) => selected !== id),
              )
            }
            onClose={onClose}
          />
        </div>
      );
    }
    render(<Editor />);
    const user = userEvent.setup();
    screen
      .getByRole('button', { name: 'Убрать последователя: Работа 1' })
      .focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outsideEscape).not.toHaveBeenCalled();
    if (!last)
      expect(
        screen.getByRole('button', { name: 'Убрать последователя: Работа 2' }),
      ).toBeVisible();
  },
);

it('does not overwrite focus deliberately moved by a removal owner', async () => {
  const onRemove = () =>
    screen.getByRole('button', { name: 'Вне выбора' }).focus();
  render(
    <>
      <PredecessorPicker
        tree={{ ...optionalTreeFixture(), tasks: [task(1)] }}
        proposal={proposal(undefined, [task(1).id])}
        direction="selectable"
        disabled={false}
        onAdd={vi.fn()}
        onRemove={onRemove}
        onClose={vi.fn()}
      />
      <button>Вне выбора</button>
    </>,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Убрать предшественника: Работа 1' }),
  );
  expect(screen.getByRole('button', { name: 'Вне выбора' })).toHaveFocus();
});
