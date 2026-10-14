// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ActionMenu,
  type ActionMenuItem,
} from '../../src/client/ActionMenu.js';

let visibility: ((entries: { isIntersecting: boolean }[]) => void) | null =
  null;
class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    visibility = callback;
  }
  observe() {}
  disconnect() {}
}
beforeEach(() => {
  visibility = null;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness({
  items,
  onRow,
  disabled = false,
  mounted = true,
  rowTabIndex,
}: {
  items: ActionMenuItem[];
  onRow?: () => void;
  disabled?: boolean;
  mounted?: boolean;
  rowTabIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="row"
      tabIndex={rowTabIndex}
      style={{ overflow: 'auto' }}
      onKeyDown={onRow}
      onClick={onRow}
    >
      {mounted && (
        <ActionMenu
          className="test-menu"
          label="Действия: A"
          items={items}
          open={open}
          onOpenChange={setOpen}
          disabled={disabled}
          triggerData={{ 'data-test-trigger': 'a' }}
        />
      )}
      <button type="button">Снаружи</button>
      <button type="button" onPointerDown={(event) => event.stopPropagation()}>
        Полоса
      </button>
      <output data-testid="open">{String(open)}</output>
    </div>
  );
}
const items = (onSelect = vi.fn()): ActionMenuItem[] => [
  { id: 'open', label: 'Открыть', onSelect },
  { id: 'off', label: 'Недоступно', onSelect, disabled: true },
  {
    id: 'delete',
    label: 'Удалить',
    onSelect,
    tone: 'danger',
    separatorBefore: true,
  },
];
const trigger = () => screen.getByRole('button', { name: 'Действия: A' });
const rect = (top: number, right: number) =>
  ({
    top,
    bottom: top + 26,
    left: right - 26,
    right,
    x: right - 26,
    y: top,
    width: 26,
    height: 26,
    toJSON: () => ({}),
  }) as DOMRect;

it('opens a portaled labelled menu, focuses the first item and skips disabled items', async () => {
  render(<Harness items={items()} />);
  expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  expect(trigger()).not.toHaveAttribute('aria-controls');
  expect(trigger()).toHaveAttribute('data-test-trigger', 'a');
  await userEvent.click(trigger());
  const menu = screen.getByRole('menu', { name: 'Действия: A' });
  expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  expect(trigger()).toHaveAttribute('aria-controls', menu.id);
  expect(screen.getByTestId('row')).not.toContainElement(menu);
  expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveClass(
    'danger',
  );
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();
  await userEvent.keyboard('{End}');
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
  await userEvent.keyboard('{Home}{ArrowUp}');
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
  expect(screen.getByRole('separator')).toBeInTheDocument();
});

it.each(['{Escape}', '{Tab}', '{Shift>}{Tab}{/Shift}'])(
  '%s closes the menu and returns focus to the trigger',
  async (key) => {
    render(<Harness items={items()} />);
    await userEvent.click(trigger());
    await userEvent.keyboard(key);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  },
);

it('a second trigger click closes the menu', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  await userEvent.click(trigger());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('keeps menu events away from row and window handlers and passes the trigger to onSelect', async () => {
  const onSelect = vi.fn();
  const onRow = vi.fn();
  const onWindow = vi.fn();
  window.addEventListener('keydown', onWindow);
  try {
    render(<Harness items={items(onSelect)} onRow={onRow} />);
    await userEvent.click(trigger());
    onRow.mockClear();
    onWindow.mockClear();
    const first = screen.getByRole('menuitem', { name: 'Открыть' });
    fireEvent.keyDown(first, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(onRow).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
    await userEvent.click(trigger());
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(trigger());
    expect(onRow).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  } finally {
    window.removeEventListener('keydown', onWindow);
  }
});

it('lets trigger shortcuts such as Ctrl+Z reach window handlers', async () => {
  const onWindow = vi.fn();
  window.addEventListener('keydown', onWindow);
  try {
    render(<Harness items={items()} />);
    trigger().focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(onWindow).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'z', ctrlKey: true }),
    );
  } finally {
    window.removeEventListener('keydown', onWindow);
  }
});

it('closes on outside pointerdown without taking focus, but not on its own pointerdown', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Открыть' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  const outside = screen.getByRole('button', { name: 'Снаружи' });
  const focusTrigger = vi.spyOn(trigger(), 'focus');
  fireEvent.pointerDown(outside);
  // Checked before any follow-up focus: the menu must not grab it for itself.
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(focusTrigger).not.toHaveBeenCalled();
  expect(trigger()).not.toHaveFocus();
});

it('closes on outside pointerdown even when the target stops propagation', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Полоса' }));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('returns focus to the trigger only when onSelect reports a refused action', async () => {
  render(<Harness items={items(vi.fn(() => false))} />);
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));
  expect(trigger()).toHaveFocus();
});

it('leaves focus to an accepted action, even when it moves focus later', async () => {
  const onSelect = vi.fn(() => {
    requestAnimationFrame(() =>
      screen.getByRole('button', { name: 'Снаружи' }).focus(),
    );
  });
  render(<Harness items={items(onSelect)} />);
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));
  expect(onSelect).toHaveBeenCalledOnce();
  expect(trigger()).not.toHaveFocus();
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(screen.getByRole('button', { name: 'Снаружи' })).toHaveFocus();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('repositions on ancestor scroll and resize and closes when the trigger is no longer visible', async () => {
  render(<Harness items={items()} />);
  const spy = vi
    .spyOn(trigger(), 'getBoundingClientRect')
    .mockReturnValue(rect(100, 326));
  await userEvent.click(trigger());
  expect(screen.getByRole('menu')).toHaveStyle({ top: '130px' });
  spy.mockReturnValue(rect(200, 326));
  fireEvent.scroll(screen.getByTestId('row'));
  expect(screen.getByRole('menu')).toHaveStyle({ top: '230px' });
  spy.mockReturnValue(rect(300, 326));
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('menu')).toHaveStyle({ top: '330px' });
  act(() => visibility?.([{ isIntersecting: false }]));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
});

it('closes when the trigger becomes invisible but keeps focus that was outside the menu', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  // Focus leaves for nowhere (window blur): relatedTarget is null, menu stays.
  act(() => (document.activeElement as HTMLElement).blur());
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(document.body).toHaveFocus();
  const focusTrigger = vi.spyOn(trigger(), 'focus');
  act(() => visibility?.([{ isIntersecting: false }]));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByTestId('open')).toHaveTextContent('false');
  expect(focusTrigger).not.toHaveBeenCalled();
  expect(document.body).toHaveFocus();
});

it('ignores focusout without a relatedTarget', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  const first = screen.getByRole('menuitem', { name: 'Открыть' });
  fireEvent.focusOut(first, { relatedTarget: null });
  expect(screen.getByRole('menu')).toBeInTheDocument();
  // Same event towards another control does close it: the check is not vacuous.
  fireEvent.focusOut(first, {
    relatedTarget: screen.getByRole('button', { name: 'Снаружи' }),
  });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('stays open after a click on the separator and still handles arrows and Escape', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole('separator'));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByRole('menu')).toHaveFocus();
  await userEvent.keyboard('{ArrowUp}');
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
  await userEvent.click(screen.getByRole('separator'));
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
});

it('moves focus with preventScroll on open, arrows and Escape', async () => {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  const callsOn = (element: HTMLElement) =>
    focus.mock.calls.filter(
      (_, index) => focus.mock.contexts[index] === element,
    );
  const first = screen.getByRole('menuitem', { name: 'Открыть' });
  expect(first).toHaveFocus();
  expect(callsOn(first)).toEqual([[{ preventScroll: true }]]);
  await userEvent.keyboard('{ArrowDown}');
  const last = screen.getByRole('menuitem', { name: 'Удалить' });
  expect(last).toHaveFocus();
  expect(callsOn(last)).toEqual([[{ preventScroll: true }]]);
  const button = trigger();
  focus.mockClear();
  await userEvent.keyboard('{Escape}');
  expect(button).toHaveFocus();
  expect(callsOn(button)).toEqual([[{ preventScroll: true }]]);
});

it('closes without moving focus to a trigger that became disabled', async () => {
  const { rerender } = render(<Harness items={items()} />);
  await userEvent.click(trigger());
  expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();
  const focusTrigger = vi.spyOn(trigger(), 'focus');
  expect(() => rerender(<Harness items={items()} disabled />)).not.toThrow();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByTestId('open')).toHaveTextContent('false');
  expect(trigger()).toBeDisabled();
  expect(focusTrigger).not.toHaveBeenCalled();
  expect(trigger()).not.toHaveFocus();
  // The plain row is not focusable, so there is no owner container to take it.
  expect(document.body).toHaveFocus();
});

it('moves focus from the menu to the focusable owner row when the trigger becomes disabled', async () => {
  const { rerender } = render(<Harness items={items()} rowTabIndex={-1} />);
  await userEvent.click(trigger());
  expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();
  const row = screen.getByTestId('row');
  const focusRow = vi.spyOn(row, 'focus');
  rerender(<Harness items={items()} rowTabIndex={-1} disabled />);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger()).toBeDisabled();
  expect(row).toHaveFocus();
  expect(focusRow).toHaveBeenCalledWith({ preventScroll: true });
});

it('closes when focus leaves the menu for another control', async () => {
  render(<Harness items={items()} />);
  await userEvent.click(trigger());
  act(() => screen.getByRole('button', { name: 'Снаружи' }).focus());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Снаружи' })).toHaveFocus();
});

it('closes and resets owner state when the trigger is disabled or unmounted', async () => {
  const { rerender } = render(<Harness items={items()} />);
  await userEvent.click(trigger());
  rerender(<Harness items={items()} disabled />);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByTestId('open')).toHaveTextContent('false');
  rerender(<Harness items={items()} />);
  await userEvent.click(trigger());
  rerender(<Harness items={items()} mounted={false} />);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByTestId('open')).toHaveTextContent('false');
  rerender(<Harness items={items()} />);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('disables the trigger while disabled or when every item is unavailable', async () => {
  const { rerender } = render(<Harness items={items()} disabled />);
  expect(trigger()).toBeDisabled();
  await userEvent.click(trigger());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  rerender(
    <Harness items={items().map((item) => ({ ...item, disabled: true }))} />,
  );
  expect(trigger()).toBeDisabled();
});
