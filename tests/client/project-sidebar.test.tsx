// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: 'Новый проект' })).toHaveFocus();
    view.unmount();
    expect(listeners.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

function sidebarProps() {
  return {
    projects: [project],
    selectedId: project.id,
    onSelect: vi.fn(),
    onCreate: vi.fn(async () => false),
    onLogout: vi.fn(),
    busy: false,
    collapsed: true,
    onToggle: vi.fn(),
  };
}

it.each([
  ['Демо проект', 'ДП'],
  ['  Лесной   дом  ', 'ЛД'],
  ['Развитие', 'РА'],
  ['Я', 'Я'],
  ['leaf — demo', 'LD'],
  ['🔥 План', 'ПЛ'],
  ['123', '12'],
  ['🌿', '•'],
])(
  'shows short initials for %s with the full accessible name',
  (title, initials) => {
    render(
      <ProjectSidebar {...sidebarProps()} projects={[{ ...project, title }]} />,
    );
    const link = screen.getByRole('button', {
      name: title.trim().replace(/\s+/g, ' '),
    });
    expect(link.querySelector('.project-initials')).toHaveTextContent(initials);
    expect(link.querySelector('.project-initials')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(link).toHaveAttribute('aria-current', 'page');
  },
);

it('selects a collapsed project with the keyboard and keeps the rail collapsed', async () => {
  const props = sidebarProps();
  const other = { ...project, id: 'demo-other', title: 'Другой проект' };
  const user = userEvent.setup();
  render(<ProjectSidebar {...props} projects={[project, other]} />);
  const link = screen.getByRole('button', { name: other.title });
  link.focus();
  await user.keyboard('{Enter}');
  expect(props.onSelect).toHaveBeenCalledWith(other.id);
  expect(props.onToggle).not.toHaveBeenCalled();
  expect(link).not.toHaveAttribute('aria-current');
});

it('shows and dismisses the full project name on focus and hover', async () => {
  const user = userEvent.setup();
  render(<ProjectSidebar {...sidebarProps()} />);
  const link = screen.getByRole('button', { name: project.title });
  await user.tab();
  await user.tab();
  await user.tab();
  expect(link).toHaveFocus();
  expect(screen.getByRole('tooltip')).toHaveTextContent(project.title);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).toBeNull();
  await user.tab();
  await user.hover(link);
  expect(screen.getByRole('tooltip')).toHaveTextContent(project.title);
  await user.unhover(link);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});

it('expands to create a project without clearing the existing title draft', async () => {
  const user = userEvent.setup();
  const props = sidebarProps();
  function Harness() {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <ProjectSidebar
        {...props}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
    );
  }
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Новый проект' }));
  await user.type(screen.getByLabelText('Название проекта'), 'Synthetic draft');
  await user.click(screen.getByRole('button', { name: 'Свернуть проекты' }));
  await user.click(screen.getByRole('button', { name: 'Новый проект' }));
  expect(
    screen.getByRole('button', { name: 'Свернуть проекты' }),
  ).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('Название проекта')).toHaveValue(
    'Synthetic draft',
  );
  expect(screen.getByLabelText('Название проекта')).toHaveFocus();
  expect(props.onCreate).not.toHaveBeenCalled();
});

it('keeps empty and busy rails usable without allowing disabled actions', async () => {
  const props = sidebarProps();
  const user = userEvent.setup();
  const view = render(<ProjectSidebar {...props} projects={[]} />);
  expect(
    screen.getByRole('navigation', { name: 'Проекты' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Выйти' }));
  expect(props.onLogout).toHaveBeenCalledOnce();
  view.rerender(<ProjectSidebar {...props} busy={true} />);
  for (const name of [project.title, 'Новый проект', 'Выйти']) {
    const button = screen.getByRole('button', { name });
    expect(button).toBeDisabled();
    await user.click(button);
  }
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(props.onCreate).not.toHaveBeenCalled();
  expect(props.onLogout).toHaveBeenCalledOnce();
  expect(
    screen.getByRole('button', { name: 'Развернуть проекты' }),
  ).toBeEnabled();
});

it('keeps the remembered collapsed state when mobile creation is toggled', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  try {
    const props = sidebarProps();
    const user = userEvent.setup();
    render(<ProjectSidebar {...props} />);
    const plus = screen.getByRole('button', { name: 'Новый проект' });
    await user.click(plus);
    expect(screen.getByLabelText('Название проекта')).toHaveFocus();
    await user.click(plus);
    expect(screen.queryByLabelText('Название проекта')).toBeNull();
    expect(props.onToggle).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
