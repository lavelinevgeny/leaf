import type { PanelTab } from './TaskPanel.js';

export function visiblePanelTab(
  tab: PanelTab,
): 'details' | 'dependencies' | 'journal' {
  return tab === 'subtasks' ? 'details' : tab;
}

// Journal anchors and local navigation must consult the current owner: on a
// very low screen the entire panel scrolls instead of just panel-content.
export function panelScrollOwner(panel: HTMLElement): HTMLElement | null {
  return panel.matches('[data-panel-scroll-owner]')
    ? panel
    : panel.querySelector<HTMLElement>('[data-panel-scroll-owner]');
}
