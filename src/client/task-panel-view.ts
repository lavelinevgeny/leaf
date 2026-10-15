import type { Project, SourceFields } from '../shared/contracts.js';
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

const months = [
  'янв.',
  'февр.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
];
function shortDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return `${Number(date.slice(8))} ${months[Number(date.slice(5, 7)) - 1]}`;
}
export function taskScheduleLabel(
  source: SourceFields,
  calendar: Project['calendarType'],
): string {
  const {
    inputStart: start,
    inputFinish: finish,
    durationDays: duration,
  } = source;
  let label = 'Без дат';
  if (start && finish) {
    label =
      start === finish
        ? shortDate(start)
        : start.slice(0, 7) === finish.slice(0, 7)
          ? `${Number(start.slice(8))}–${shortDate(finish)}`
          : `${shortDate(start)}–${shortDate(finish)}`;
  } else if (start) label = `Начало: ${shortDate(start)}`;
  else if (finish) label = `Окончание: ${shortDate(finish)}`;
  if (duration !== null) {
    const n = duration % 100;
    const unit =
      n >= 11 && n <= 14
        ? 'дней'
        : duration % 10 === 1
          ? 'день'
          : duration % 10 >= 2 && duration % 10 <= 4
            ? 'дня'
            : 'дней';
    label += ` · ${duration} ${calendar === 'weekdays' ? 'раб. ' : ''}${unit}`;
  }
  return label;
}
