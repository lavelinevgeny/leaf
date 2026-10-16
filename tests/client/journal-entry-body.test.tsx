// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { JournalEntryBody } from '../../src/client/JournalEntryBody.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
});

it('keeps short unchanged plain text without a disclosure', () => {
  const body = '  Отступ <b>plain text</b>\nВторая строка  ';
  const { container } = render(<JournalEntryBody body={body} />);
  expect(container.querySelector('.journal-body')?.textContent).toBe(body);
  expect(container.querySelector('b')).toBeNull();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it.each(['\n', '\r\n'])(
  'compacts blank lines for %j and discloses the exact original even without overflow',
  async (newline) => {
    const original = ['', '', '  Абзац A ', '  ', '\t', 'Абзац B', '', ''].join(
      newline,
    );
    const { container } = render(<JournalEntryBody body={original} />);
    const text = () => container.querySelector('.journal-body')!;
    expect(text().textContent).toBe(`  Абзац A ${newline}${newline}Абзац B`);
    const toggle = screen.getByRole('button', { name: 'Показать полностью' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', text().id);
    await userEvent.click(toggle);
    expect(text().textContent).toBe(original);
    expect(toggle).toHaveAccessibleName('Свернуть');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(text().textContent).toBe(`  Абзац A ${newline}${newline}Абзац B`);
  },
);

it('preserves nonblank line endings, indentation and a single empty line', () => {
  render(<JournalEntryBody body={' A\r\n\r\n  B\r\nC'} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('measures overflow, updates on resize and preserves independent keyed expansion on refresh', async () => {
  let overflow = 100;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('journal-body') ? overflow : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80);
  const callbacks: (() => void)[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const entries = (suffix = '') => (
    <>
      {['A', 'B'].map((id) => (
        <JournalEntryBody key={id} body={`${id}${suffix}`} />
      ))}
    </>
  );
  const { rerender, unmount } = render(entries());
  const toggles = screen.getAllByRole('button', { name: 'Показать полностью' });
  await userEvent.click(toggles[0]!);
  expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
  expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
  rerender(entries(' refreshed'));
  expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
  overflow = 40;
  act(() => callbacks.forEach((callback) => callback()));
  expect(
    screen.queryByRole('button', { name: 'Показать полностью' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Свернуть' })).toBe(toggles[0]);
  await userEvent.click(toggles[0]!);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  unmount();
  expect(disconnect).toHaveBeenCalled();
});

it('remeasures after font readiness and font loading events and cleans up listeners', async () => {
  let height = 80;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    () => height,
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80);
  const fonts = new EventTarget();
  let ready!: () => void;
  Object.defineProperty(fonts, 'ready', {
    value: new Promise<void>((resolve) => {
      ready = resolve;
    }),
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  const remove = vi.spyOn(fonts, 'removeEventListener');
  const { unmount } = render(<JournalEntryBody body="Synthetic text" />);
  height = 120;
  await act(async () => ready());
  expect(
    screen.getByRole('button', { name: 'Показать полностью' }),
  ).toBeVisible();
  height = 40;
  act(() => fonts.dispatchEvent(new Event('loadingdone')));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  unmount();
  expect(remove).toHaveBeenCalledWith('loadingdone', expect.any(Function));
});

it.each([false, true])(
  'measures changed hidden text synchronously on reveal (initial overflow: %s)',
  (initialOverflow) => {
    let visible = true;
    let overflow = initialOverflow;
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      () => (visible ? 80 : 0),
    );
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
      () => (visible ? (overflow ? 100 : 20) : 0),
    );
    const { rerender } = render(
      <JournalEntryBody body="Initial text" visible />,
    );
    expect(screen.queryByRole('button') !== null).toBe(initialOverflow);
    visible = false;
    overflow = !initialOverflow;
    rerender(<JournalEntryBody body="Changed while hidden" visible={false} />);
    visible = true;
    rerender(<JournalEntryBody body="Changed while hidden" visible />);
    expect(screen.queryByRole('button') !== null).toBe(!initialOverflow);
  },
);
