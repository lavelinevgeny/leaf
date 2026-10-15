import type { Page } from '@playwright/test';

export async function openTaskDates(page: Page) {
  const trigger = page.getByRole('button', { name: /^Сроки задачи:/ });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click();
}
