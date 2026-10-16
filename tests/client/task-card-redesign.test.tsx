// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskPanel, type PanelTab } from '../../src/client/TaskPanel.js';
import { taskSchema } from '../../src/shared/contracts.js';
import { optionalTreeFixture, task } from './fixtures.js';

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
afterEach(cleanup);
function fixture() {
  return {
    ...optionalTreeFixture(),
    tasks: [
      task(1, {
        title: 'Карточка',
        description: 'Исходный текст',
        inputStart: '2026-10-09',
        inputFinish: '2026-10-12',
        durationDays: 2,
      }),
    ],
  };
}
function Harness({
  write,
  ...props
}: Partial<ComponentProps<typeof TaskPanel>> & {
  write?: (
    changes: Parameters<ComponentProps<typeof TaskPanel>['onSave']>[0],
  ) => void;
}) {
  const [tree, setTree] = useState(fixture);
  const [tab, onTab] = useState<PanelTab>('details');
  return (
    <TaskPanel
      task={tree.tasks[0]!}
      tree={tree}
      tasks={tree.tasks}
      removed={false}
      tab={tab}
      onTab={onTab}
      onDependency={async () => true}
      onNeighbor={() => {}}
      onShow={() => {}}
      backTask={null}
      onBack={() => {}}
      collapsed={new Set()}
      onToggle={() => {}}
      onSelect={() => {}}
      onAction={() => {}}
      onMove={() => {}}
      onSave={async (changes) => {
        write?.(changes);
        const next = {
          ...tree,
          project: { ...tree.project, revision: tree.project.revision + 1 },
          tasks: [taskSchema.parse({ ...tree.tasks[0]!, ...changes })],
        };
        setTree(next);
        return next;
      }}
      onDirty={() => {}}
      onClose={() => {}}
      busy={false}
      retry={false}
      conflict={false}
      locked={false}
      feedback={null}
      {...props}
    />
  );
}
it.each(['Отмена', 'Escape'])(
  'description %s restores the text without writing',
  async (action) => {
    const user = userEvent.setup(),
      write = vi.fn();
    render(<Harness write={write} />);
    await user.click(screen.getByRole('button', { name: 'Изменить описание' }));
    await user.type(screen.getByLabelText('Описание'), ' изменён');
    if (action === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('textbox', { name: 'Описание' })).toBeNull();
    expect(screen.getByText('Исходный текст')).toBeVisible();
    expect(write).not.toHaveBeenCalled();
  },
);
it('description save preserves unrelated title draft and whitespace', async () => {
  const user = userEvent.setup(),
    write = vi.fn();
  render(<Harness write={write} />);
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  fireEvent.change(screen.getByLabelText('Название задачи'), {
    target: { value: 'Черновик названия' },
  });
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: 'Изменить описание' }));
  fireEvent.change(screen.getByLabelText('Описание'), {
    target: { value: '  Первая\n\nВторая  ' },
  });
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(write).toHaveBeenCalledExactlyOnceWith({
    description: '  Первая\n\nВторая  ',
  });
  expect(screen.queryByRole('textbox', { name: 'Описание' })).toBeNull();
  expect(
    screen.getByRole('heading', { name: 'Черновик названия' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(write).toHaveBeenLastCalledWith({ title: 'Черновик названия' });
});
it('failed description save retains input and offers local retry', async () => {
  const user = userEvent.setup(),
    onSave = vi.fn(async () => null);
  render(<Harness onSave={onSave} />);
  await user.click(screen.getByRole('button', { name: 'Изменить описание' }));
  await user.type(screen.getByLabelText('Описание'), ' черновик');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(screen.getByLabelText('Описание')).toHaveValue(
    'Исходный текст черновик',
  );
  expect(
    within(document.querySelector('.panel-description-section')!).getByRole(
      'alert',
    ),
  ).toBeVisible();
});
it('status commits alone while retaining other drafts, and Escape never writes', async () => {
  const user = userEvent.setup(),
    write = vi.fn();
  render(<Harness write={write} />);
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  fireEvent.change(screen.getByLabelText('Название задачи'), {
    target: { value: 'Черновик' },
  });
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: /^Статус:/ }));
  await user.keyboard('{Escape}');
  expect(write).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /^Статус:/ }));
  await user.click(screen.getByRole('menuitem', { name: /В работе/ }));
  expect(write).toHaveBeenCalledExactlyOnceWith({ status: 'doing' });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Статус: В работе' }),
    ).toBeVisible(),
  );
  expect(screen.getByRole('heading', { name: 'Черновик' })).toBeVisible();
});
it('failed status leaves the saved value visible', async () => {
  const user = userEvent.setup(),
    onSave = vi.fn(async () => null);
  render(<Harness onSave={onSave} />);
  const before = screen.getByRole('button', { name: /^Статус:/ }).textContent;
  await user.click(screen.getByRole('button', { name: /^Статус:/ }));
  await user.click(screen.getByRole('menuitem', { name: /В работе/ }));
  expect(screen.getByRole('button', { name: /^Статус:/ }).textContent).toBe(
    before,
  );
  expect(screen.getByRole('alert')).toBeVisible();
});
it.each(['Отмена', 'Закрыть сроки'])(
  'dates %s discards raw and canonical edits without writing',
  async (action) => {
    const user = userEvent.setup(),
      write = vi.fn();
    render(<Harness write={write} />);
    await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
    fireEvent.change(screen.getByLabelText('Начало'), {
      target: { value: '31.02.2026' },
    });
    if (action === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: action }));
    await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
    expect(screen.getByLabelText('Начало')).toHaveValue('09.10.2026');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(write).not.toHaveBeenCalled();
  },
);
it('Done saves recalculated dates, and clearing persists nulls only after Done', async () => {
  const user = userEvent.setup(),
    write = vi.fn();
  render(<Harness write={write} />);
  await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
  const finish = screen.getByLabelText('Окончание');
  await user.click(finish);
  fireEvent.change(finish, { target: { value: '09.10.2026' } });
  await user.click(screen.getByRole('button', { name: 'Готово' }));
  expect(write).toHaveBeenCalledExactlyOnceWith({
    inputFinish: '2026-10-09',
    durationDays: 1,
  });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Сроки задачи' })).toBeNull(),
  );
  await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
  await user.click(screen.getByRole('button', { name: 'Очистить все сроки' }));
  expect(write).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Готово' }));
  expect(write).toHaveBeenLastCalledWith({
    inputStart: null,
    inputFinish: null,
    durationDays: null,
  });
});
it('dirty description tab navigation offers save, discard and continue', async () => {
  const user = userEvent.setup(),
    write = vi.fn();
  render(<Harness write={write} />);
  await user.click(screen.getByRole('button', { name: 'Изменить описание' }));
  await user.type(screen.getByLabelText('Описание'), ' черновик');
  await user.click(screen.getByRole('tab', { name: 'Ход работы' }));
  const dialog = screen.getByRole('dialog');
  expect(screen.getByRole('tab', { name: 'Задача' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Не сохранять' }),
  );
  await user.click(screen.getByRole('tab', { name: 'Задача' }));
  expect(screen.getByText('Исходный текст')).toBeVisible();
  expect(write).not.toHaveBeenCalled();
});
it('does not reserve a save footer or show expansion for short description', () => {
  render(<Harness />);
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
});

it('a delayed description acknowledgement preserves newer text in the editor', async () => {
  const user = userEvent.setup();
  const tree = fixture();
  let resolve!: (value: typeof tree) => void;
  const onSave = vi.fn(
    () =>
      new Promise<typeof tree>((done) => {
        resolve = done;
      }),
  );
  render(<Harness onSave={onSave} />);
  await user.click(screen.getByRole('button', { name: 'Изменить описание' }));
  fireEvent.change(screen.getByLabelText('Описание'), {
    target: { value: 'Отправленный текст' },
  });
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  fireEvent.change(screen.getByLabelText('Описание'), {
    target: { value: 'Более новый текст' },
  });
  resolve({
    ...tree,
    project: { ...tree.project, revision: tree.project.revision + 1 },
    tasks: [{ ...tree.tasks[0]!, description: 'Отправленный текст' }],
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Описание')).toHaveValue('Более новый текст');
  expect(screen.queryByText('Сохранено')).toBeNull();
});

it('date cancellation uses the latest acknowledged dates after a global save of a suspended editor', async () => {
  const user = userEvent.setup(),
    write = vi.fn();
  render(<Harness write={write} />);
  await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
  const duration = screen.getByLabelText('Длительность, рабочих дней');
  await user.clear(duration);
  await user.type(duration, '3');
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull(),
  );
  await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
  await user.clear(duration);
  await user.type(duration, '7');
  await user.click(screen.getByRole('button', { name: 'Отмена' }));
  await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
  expect(duration).toHaveValue('3');
  expect(screen.getByLabelText('Окончание')).toHaveValue('13.10.2026');
  expect(write).toHaveBeenCalledTimes(1);
});

it.each(['description', 'schedule'] as const)(
  'a confirmed exact retry closes the %s editor',
  async (scope) => {
    const user = userEvent.setup();
    const ack = fixture();
    ack.project.revision++;
    if (scope === 'description')
      ack.tasks[0]!.description = 'Подтверждённое описание';
    else {
      ack.tasks[0]!.durationDays = 3;
      ack.tasks[0]!.inputFinish = '2026-10-13';
    }
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ack);
    const view = render(<Harness onSave={onSave} />);
    if (scope === 'description') {
      await user.click(
        screen.getByRole('button', { name: 'Изменить описание' }),
      );
      fireEvent.change(screen.getByLabelText('Описание'), {
        target: { value: 'Подтверждённое описание' },
      });
      await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    } else {
      await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
      const duration = screen.getByLabelText('Длительность, рабочих дней');
      await user.clear(duration);
      await user.type(duration, '3');
      await user.click(screen.getByRole('button', { name: 'Готово' }));
    }
    view.rerender(<Harness onSave={onSave} retry locked />);
    await user.click(
      screen.getByRole('button', { name: 'Повторить сохранение' }),
    );
    await waitFor(() => {
      if (scope === 'description')
        expect(screen.queryByRole('textbox', { name: 'Описание' })).toBeNull();
      else
        expect(
          screen.queryByRole('dialog', { name: 'Сроки задачи' }),
        ).toBeNull();
    });
    expect(onSave).toHaveBeenCalledTimes(2);
  },
);
