// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
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
        successorId={tree.tasks[1]!.id}
        selectedIds={[]}
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
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(tree.tasks[0]!.id);
  await user.tab();
  expect(screen.getByRole('searchbox')).not.toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
});
it('shows loading, no leaves, no query matches, paths, incomplete hints and missing selected IDs', async () => {
  const props = {
    successorId: null,
    selectedIds: [],
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
      selectedIds={['missing']}
    />,
  );
  expect(screen.getByText('Задача удалена')).toBeInTheDocument();
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
    successorId: null,
    selectedIds: [a.id],
    disabled: false,
    onAdd,
    onRemove,
    onClose: vi.fn(),
  };
  const view = render(<PredecessorPicker {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Убрать предшественника: ' + a.title }),
  );
  expect(onRemove).toHaveBeenCalledExactlyOnceWith(a.id);
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
    successorId: null,
    selectedIds: [],
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
    <PredecessorPicker {...props} selectedIds={[tree.tasks.at(-1)!.id]} />,
  );
  const clamped = screen.getAllByRole('option').at(-1)!;
  expect(clamped).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('searchbox')).toHaveAttribute(
    'aria-activedescendant',
    clamped.id,
  );
  await user.keyboard('{ArrowDown}{Enter}');
  expect(props.onAdd).toHaveBeenCalledExactlyOnceWith(tree.tasks[0]!.id);
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
    successorId: null,
    selectedIds: [],
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
        successorId={tree.tasks[1]!.id}
        selectedIds={[]}
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
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(tree.tasks[0]!.id);
  expect(submit).not.toHaveBeenCalled();
});
