import { useLayoutEffect, useRef, useState } from 'react';
import type { PanelTab } from './TaskPanel.js';
import { panelScrollOwner } from './task-panel-view.js';

// Keep scrolling inside the panel: scrollIntoView can also move the workspace.
function reveal(owner: HTMLElement, target: HTMLElement) {
  const viewport = owner.getBoundingClientRect();
  const bounds = target.getBoundingClientRect();
  if (bounds.top < viewport.top) owner.scrollTop += bounds.top - viewport.top;
  else if (bounds.bottom > viewport.bottom)
    owner.scrollTop += bounds.bottom - viewport.bottom;
}

export function useTaskPanelLayout(tab: PanelTab) {
  const panel = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [shellScroll, setShellScroll] = useState(false);
  const currentMode = useRef(false);
  const pendingOffset = useRef<number | null>(null);

  useLayoutEffect(() => {
    const root = panel.current;
    const body = content.current;
    if (!root || !body) return;
    const chrome = Array.from(
      root.querySelectorAll<HTMLElement>(
        ':scope > .panel-edit-form, :scope > .panel-tabs, :scope > .panel-footer',
      ),
    );
    function measure() {
      if (!root || !body || !root.clientHeight) return;
      const style = getComputedStyle(body);
      const required =
        chrome.reduce(
          (height, node) => height + node.getBoundingClientRect().height,
          0,
        ) +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom);
      // Measure only natural fixed zones, never the shrinking content or its
      // scrollHeight. The test is stable in both modes and as feedback changes.
      const next = Math.ceil(required) > root.clientHeight;
      if (next === currentMode.current) return;
      pendingOffset.current = panelScrollOwner(root)?.scrollTop ?? 0;
      currentMode.current = next;
      setShellScroll(next);
    }
    let frame = 0;
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    measure();
    const sizes =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);
    sizes?.observe(root);
    for (const node of chrome) sizes?.observe(node);
    const changes = new MutationObserver(schedule);
    for (const node of chrome)
      changes.observe(node, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      sizes?.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  useLayoutEffect(() => {
    const root = panel.current;
    const body = content.current;
    const offset = pendingOffset.current;
    if (!root || !body || offset === null) return;
    pendingOffset.current = null;
    const owner = panelScrollOwner(root)!;
    const previous = shellScroll ? body : root;
    previous.scrollTop = 0;
    owner.scrollTop = offset;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && owner.contains(focused))
      reveal(owner, focused);
  }, [shellScroll]);

  useLayoutEffect(() => {
    const root = panel.current;
    if (!root || tab !== 'subtasks') return;
    // A legacy entry reveals the section without taking focus. Cancel the
    // deferred reveal when the user has already chosen a different focus.
    const initialFocus = document.activeElement;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== initialFocus) return;
      const heading = root.querySelector<HTMLElement>('.panel-subtasks h3');
      const owner = panelScrollOwner(root);
      if (heading && owner) reveal(owner, heading);
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  return { panel, content, shellScroll };
}
