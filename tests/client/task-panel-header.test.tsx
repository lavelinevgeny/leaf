// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { TaskPanelHeader } from '../../src/client/TaskPanelHeader.js';

afterEach(cleanup);

function Header({ draft = 'Saved task' }: { draft?: string }) {
  const [title, setTitle] = useState(draft);
  return (
    <TaskPanelHeader
      title={title}
      journalTitle="Saved task"
      unsavedTitle={title !== 'Saved task'}
      status="todo"
      onTitle={setTitle}
      onStatus={() => {}}
      disabled={false}
      closeDisabled={false}
      onClose={() => {}}
      back={null}
      schedule={null}
    />
  );
}

it('uses the journal heading itself to edit the title without an extra text row', () => {
  render(<Header />);
  const heading = screen.getByRole('heading', { name: 'Saved task' });
  const trigger = screen.getByRole('button', { name: 'Изменить название' });
  expect(heading).toContainElement(trigger);
  expect(trigger).toHaveTextContent('Saved task');
  expect(screen.queryByText('Изменить название')).toBeNull();
  expect(screen.getAllByRole('heading')).toHaveLength(1);
});

it('keeps coherent journal metadata visible while a local title draft exists', () => {
  render(<Header draft="Local draft" />);
  expect(screen.getByRole('heading', { name: 'Saved task' })).toContainElement(
    screen.getByRole('button', { name: 'Изменить название' }),
  );
  expect(screen.getByText('Несохранённое название: Local draft')).toBeVisible();
});

it('opens the local title editor with the keyboard and restores focus on Escape', async () => {
  const user = userEvent.setup();
  render(<Header draft="Local draft" />);
  const trigger = screen.getByRole('button', { name: 'Изменить название' });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('heading', { name: 'Saved task' })).toBeVisible();
  const editor = screen.getByRole('textbox', { name: 'Название задачи' });
  expect(editor).toHaveFocus();
  expect(editor).toHaveValue('Local draft');
  await user.type(editor, ' changed');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('Несохранённое название: Local draft')).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Изменить название' }),
    ).toHaveFocus(),
  );
  expect(screen.queryByText('Изменить название')).toBeNull();
});
