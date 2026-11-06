// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectSidebar } from '../../src/client/ProjectSidebar.js';
import { project } from './fixtures.js';
afterEach(cleanup);
it('keeps project title draft and keyboard focus through collapse', async () => {
  const user = userEvent.setup();
  function Harness() {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <ProjectSidebar
        projects={[project]}
        selectedId={project.id}
        onSelect={vi.fn()}
        onCreate={async () => false}
        onLogout={vi.fn()}
        busy={false}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
    );
  }
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Новый проект' }));
  await user.type(screen.getByLabelText('Название проекта'), 'Synthetic draft');
  const toggle = screen.getByRole('button', { name: 'Свернуть проекты' });
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.keyboard(' ');
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAccessibleName('Свернуть проекты');
  expect(screen.getByLabelText('Название проекта')).toHaveValue(
    'Synthetic draft',
  );
});

it('moves only sidebar focus when the mobile breakpoint hides controls', async () => {
  let mobile = false;
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return mobile;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => media);
  try {
    const view = render(
      <ProjectSidebar
        projects={[project]}
        selectedId={project.id}
        onSelect={vi.fn()}
        onCreate={async () => false}
        onLogout={vi.fn()}
        busy={false}
        collapsed={true}
        onToggle={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Развернуть проекты' });
    toggle.focus();
    mobile = true;
    listeners.forEach((listener) => listener());
    expect(screen.getByRole('button', { name: 'Новый проект' })).toHaveFocus();
    mobile = false;
    listeners.forEach((listener) => listener());
    expect(toggle).toHaveFocus();
    view.unmount();
    expect(listeners.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
