type IconName = 'search' | 'filter' | 'chevron' | 'list' | 'gantt' | 'undo';

const paths: Record<IconName, string> = {
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  filter: 'M3 4h18l-7 8v7l-4 2v-9L3 4Z',
  chevron: 'm6 9 6 6 6-6',
  list: 'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',
  gantt: 'M3 3h5v18H3zM10 8h5v13h-5zM17 13h4v8h-4z',
  undo: 'M4 10h8a7 7 0 0 1 7 7M4 10l5-5M4 10l5 5',
};

export function ControlIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="control-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={paths[name]}
        fill={name === 'gantt' ? 'currentColor' : 'none'}
        stroke={name === 'gantt' ? 'none' : 'currentColor'}
      />
    </svg>
  );
}
