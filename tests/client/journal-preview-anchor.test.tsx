// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { JournalFeed } from '../../src/client/JournalFeed.js';
import { useJournal } from '../../src/client/use-journal.js';
import {
  journalContext,
  journal5,
  mockJournalApp,
} from './journal-fixtures.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function setup(nextCursor: string | null = null) {
  mockJournalApp();
  const { result } = renderHook(() =>
    useJournal(journalContext({ taskId: journal5.taskId })),
  );
  await waitFor(() => expect(result.current.taskFeed?.phase).toBe('ready'));
  const controller = result.current;
  const loadMore = vi.spyOn(controller, 'loadMore').mockResolvedValue();
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation(() => {});
  const owner = document.createElement('div');
  document.body.append(owner);
  let rowTop = 300;
  let fullHeight = 1000;
  Object.defineProperties(owner, {
    scrollHeight: { get: () => fullHeight },
    clientHeight: { get: () => 400 },
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(
        0,
        this.dataset.journalEntry ? 100 + rowTop - owner.scrollTop : 100,
        300,
        100,
      );
    },
  );
  const state = {
    ...controller.taskFeed!,
    page: { ...controller.taskFeed!.page!, nextCursor },
  };
  const restorePosition = {
    id: journal5.id,
    date: journal5.workDate,
    offset: -50,
    top: 0,
    left: 0,
  };
  const feed = (changes = {}) => (
    <JournalFeed
      state={{ ...state, ...changes }}
      controller={controller}
      scrollContainer={owner}
      collapseBodies
      showTaskTitles={false}
      onOpenTask={() => {}}
      restorePosition={restorePosition}
    />
  );
  const view = render(feed(), { container: owner });
  return {
    owner,
    loadMore,
    cancel,
    frames,
    view,
    feed,
    state,
    rowTop: (value: number) => {
      rowTop = value;
    },
    fullHeight: (value: number) => {
      fullHeight = value;
    },
    flush: () => act(() => frames.at(-1)!(0)),
  };
}

it('applies the task anchor once against final child geometry and does not fetch when it fits', async () => {
  const test = await setup('synthetic-cursor');
  expect(test.owner.scrollTop).toBe(0);
  test.rowTop(500);
  test.flush();
  expect(test.owner.scrollTop).toBe(550);
  expect(test.loadMore).not.toHaveBeenCalled();
  test.view.unmount();
  expect(test.cancel).toHaveBeenCalled();
});

it('loads the next page before consuming an unreachable anchor and stops when no cursor remains', async () => {
  const test = await setup('synthetic-cursor');
  test.rowTop(700);
  test.flush();
  expect(test.loadMore).toHaveBeenCalledExactlyOnceWith('task');
  expect(test.owner.scrollTop).toBe(0);
  test.fullHeight(1200);
  test.view.rerender(
    test.feed({ page: { ...test.state.page, nextCursor: null } }),
  );
  test.flush();
  expect(test.owner.scrollTop).toBe(750);
  expect(test.loadMore).toHaveBeenCalledTimes(1);
});

it.each(['pointer', 'wheel', 'keyboard', 'hidden'])(
  'does not apply a stale frame after %s cancellation',
  async (kind) => {
    const test = await setup();
    if (kind === 'pointer') fireEvent.pointerDown(test.owner);
    if (kind === 'wheel') fireEvent.wheel(test.owner);
    if (kind === 'keyboard') fireEvent.keyDown(test.owner, { key: 'PageDown' });
    if (kind === 'hidden') test.owner.hidden = true;
    test.flush();
    expect(test.owner.scrollTop).toBe(0);
    expect(test.loadMore).not.toHaveBeenCalled();
  },
);

it('consumes an unreachable anchor without another page when the cursor is exhausted', async () => {
  const test = await setup();
  test.rowTop(900);
  test.flush();
  expect(test.loadMore).not.toHaveBeenCalled();
  expect(test.frames).toHaveLength(1);
});
