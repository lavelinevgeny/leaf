// @vitest-environment jsdom
import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useProjectToday } from '../../src/client/use-project-today.js';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function Today({ timezone }: { timezone: string }) {
  return <span>{useProjectToday(timezone)}</span>;
}
it('refreshes project day across midnight, timezone changes and tab focus', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T20:59:30Z'));
  const view = render(<Today timezone="Europe/Moscow" />);
  expect(screen.getByText('2026-10-08')).toBeDefined();
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByText('2026-10-09')).toBeDefined();
  view.rerender(<Today timezone="UTC" />);
  expect(screen.getByText('2026-10-08')).toBeDefined();
  vi.setSystemTime(new Date('2026-10-10T01:00:00Z'));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(screen.getByText('2026-10-10')).toBeDefined();
  vi.setSystemTime(new Date('2026-10-11T01:00:00Z'));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByText('2026-10-11')).toBeDefined();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
