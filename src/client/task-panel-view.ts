import type { PanelTab } from './TaskPanel.js';

export function visiblePanelTab(
  tab: PanelTab,
): 'details' | 'dependencies' | 'journal' {
  return tab === 'subtasks' ? 'details' : tab;
}
