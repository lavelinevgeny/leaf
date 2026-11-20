import { expect, type Locator, type Page } from '@playwright/test';

export async function expectPanelScrollLayout(
  card: Locator,
  { requireOverflow = false, timeout = 5000 } = {},
) {
  // Mode can change in an observer/animation frame between Playwright calls.
  // Recompute every invariant in the same browser turn on every poll.
  await expect
    .poll(
      () =>
        card.evaluate((root, overflowRequired) => {
          const content = root.querySelector('.panel-content');
          const nodes = [root, ...root.querySelectorAll('*')];
          const owners = nodes.filter((node) =>
            node.hasAttribute('data-panel-scroll-owner'),
          );
          const shell = root.classList.contains('task-panel--scroll-shell');
          const expectedOwner = shell ? root : content;
          const owner = owners[0];
          const scrollers = nodes.filter((node) => {
            const style = getComputedStyle(node);
            return (
              node.getClientRects().length &&
              ['auto', 'scroll'].includes(style.overflowY) &&
              node.scrollHeight > node.clientHeight + 1
            );
          });
          return {
            ownerCount: owners.length,
            ownerMatchesMode: !!expectedOwner && owner === expectedOwner,
            contentOverflowMatchesMode:
              !!content &&
              getComputedStyle(content).overflowY ===
                (shell ? 'visible' : 'auto'),
            ownerAllowsScroll:
              !!owner &&
              ['auto', 'scroll'].includes(getComputedStyle(owner).overflowY),
            scrollersMatchOwner:
              (!overflowRequired || scrollers.length === 1) &&
              scrollers.every((node) => node === owner),
          };
        }, requireOverflow),
      {
        timeout,
        message: 'Task panel scroll layout must have one coherent owner',
      },
    )
    .toEqual({
      ownerCount: 1,
      ownerMatchesMode: true,
      contentOverflowMatchesMode: true,
      ownerAllowsScroll: true,
      scrollersMatchOwner: true,
    });
}

export async function openTaskDates(page: Page) {
  const trigger = page.getByRole('button', { name: /^Сроки задачи:/ });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click();
}

export async function setTaskStatus(page: Page, label: string) {
  const trigger = page.getByRole('button', { name: /^Статус:/ });
  await trigger.click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(trigger).toHaveAccessibleName(`Статус: ${label}`);
  await expect(trigger).toBeEnabled();
}
