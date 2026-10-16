import { expect, type Page } from '@playwright/test';

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
