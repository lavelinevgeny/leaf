# Task Work Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Упростить добавление и чтение ручных записей во вкладке задачи «Ход работы».

**Architecture:** Существующие journal controller/API остаются источником данных. Новая task-only компоновка включается через компактный режим JournalEditor, сворачивание — отдельным компонентом JournalEntryBody и opt-in пропом JournalFeed. Проектный журнал сохраняет прежнее представление.

**Tech Stack:** TypeScript, React, CSS, Vitest/Testing Library, Playwright; существующие зависимости.

**Spec:** [2026-10-16-task-work-progress-design.md](../specs/2026-10-16-task-work-progress-design.md)

## Global Constraints

- Меняются только вкладка задачи и её composer/предпросмотр.
- Внутренние journal identifiers, URL `panel=journal`, API, схема, scheduler, CPM, FS и Undo плана сохраняются.
- Нормализация — исключительно представление, не содержимое запросов и БД.
- Enter — перенос строки; Ctrl/Cmd+Enter — сохранение.
- Только независимые синтетические fixtures.
- Вложения, вкладка «Файлы», аватары, исполнители, время и автоматическая история изменений исключены из объёма.
- По прямому поручению владельца существующая карточка сначала коммитится отдельно, затем работа продолжается в той же ветке. Последовательные исполнители используют один checkout; новые worktree не создаются. Коммиты разрешены, push/deploy не разрешены.

## File structure

`JournalEntryBody.tsx` отвечает за presentation-only preview и доступное независимое раскрытие. `JournalFeed.tsx` подключает его только при opt-in `collapseBodies?: boolean` и хранит раскрытые IDs; optional controlled props body сохраняют состояние после временной выгрузки строки. `TaskJournal.tsx` включает этот режим. `JournalEditor.tsx` использует компактное оформление только при `compactIdle`; полный редактор записи не меняется. `CalendarDateInput` переиспользуется, его подпись скрывается scoped CSS. `TaskPanel.tsx` и `strings.ts` различают подпись вкладки задачи и проекта. `styles/journal.css` содержит scoped layout/preview. Client/E2E тесты проверяют поведение; UI/DECISIONS/ACCEPTANCE/STATUS фиксируют результат без расширения C-решений.

### Task 1: Компактное добавление и название вкладки

**Files:** Modify `src/client/JournalEditor.tsx`, `src/client/TaskPanel.tsx`, `src/client/strings.ts`, `src/client/styles/journal.css`; Create `tests/client/work-progress.test.tsx`, `tests/e2e/work-progress.spec.ts`; update existing client/E2E task-tab expectations.

**Interfaces:** Consumes existing `JournalDraft`, `JournalController`, `CalendarDateInput`, `compactIdle` and `TaskJournal`. Produces task-tab label `strings.workProgress` while `strings.journal` remains project label; compact editor layout retains existing form callbacks and accessible labels.

- [x] **Step 1: Failing tests.** Use `mockJournalApp`, open task via its treeitem, assert task tab and two-row input; project tab still uses «Журнал». Assert Enter changes text without `api.journalCreate`, Ctrl+Enter produces one create with exact original body/date, IME submit does not send, invalid date preserves body. Example assertions:

```tsx
expect(within(panel).getByRole('tab', { name: 'Ход работы' })).toBeVisible();
expect(within(panel).getByLabelText('Текст записи')).toHaveAttribute('rows', '2');
expect(screen.getByRole('tab', { name: 'Журнал', exact: true })).toBeVisible();
expect(api.journalCreate).toHaveBeenCalledWith(project.id, expect.objectContaining({ body: original, workDate: '2024-02-29' }));
```

- [x] **Step 2: Run red.** `npx vitest run tests/client/work-progress.test.tsx`; verify missing name/rows/composition guard failures.
- [x] **Step 3: Implement.** Add `workProgress: 'Ход работы'`; use it only for the task journal tab. Retain accessible submit name «Сохранить запись» while showing an SVG and tooltip in compact mode. Group textarea/date/submit into responsive grid; hide only compact calendar label and normal hint visually. Show errors and limits visibly when invalid. Preserve retry/clear/conflict callbacks and edit-mode form. Add composition guard before Ctrl/Cmd+Enter. Keep two-row minimum in task compact CSS; maintain autogrow on width/font changes. No changes to controller/storage.

```tsx
if (event.nativeEvent.isComposing) return;
if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
  event.preventDefault();
  void submit();
}
```

- [x] **Step 4: Browser checks and green.** Actual-server E2E seed via `seedJournal`; open task, verify two-row idle geometry and autogrow for pasted multiline text, visible date/save/clear, mobile width 375 and low height, no panel overflow. Verify Enter and Ctrl+Enter, exact body persistence, backdated grouping and no plan revision change. Update task-tab selectors only; project selectors remain «Журнал». Run `npx vitest run tests/client/work-progress.test.tsx tests/client/journal-compact.test.tsx tests/client/journal.test.tsx tests/client/journal-drafts.test.tsx tests/client/journal-navigation.test.tsx` and `npx playwright test tests/e2e/work-progress.spec.ts tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/journal-navigation.spec.ts` after build.
- [x] **Step 5: Review and commit.** Format changed files; run typecheck/lint; inspect diff and staged guard/Gitleaks, commit `feat: simplify task work progress entry form`, independent spec/quality review on exact commit. Fix relevant findings before Task 2.

### Task 2: Четыре строки, исходное форматирование и завершение

**Files:** Create `src/client/JournalEntryBody.tsx`, `tests/client/journal-entry-body.test.tsx`, `tests/client/journal-preview-anchor.test.tsx`; Modify `src/client/App.tsx`, `src/client/TaskPanel.tsx`, `src/client/JournalEditor.tsx`, `src/client/JournalFeed.tsx`, `src/client/TaskJournal.tsx`, `src/client/styles/journal.css`, `tests/e2e/work-progress.spec.ts`; Update `docs/UI.md`, `docs/DECISIONS.md`, `docs/ACCEPTANCE.md`, `docs/STATUS.md` and this plan.

**Interfaces:** Consumes Task 1 form/name and existing keyed entry sections. Produces `JournalEntryBody({body}: {body: string})` and `JournalFeed` optional `collapseBodies?: boolean` default false; TaskJournal sets true. State is stored by entry ID in the feed, preserved across ordinary refresh/editor/page remount and isolated by task scope. `JournalEntryBody` additionally accepts optional `expanded?: boolean` and `onExpandedChange?: (expanded: boolean) => void`; `TaskJournal.visible?: boolean` (default true) forwards current tab visibility from App to JournalFeed; `JournalEntryBody.visible?: boolean` and `JournalEditor.visible?: boolean` (default true) synchronize reveal measurement and skip hidden zero-width geometry. TaskPanel retains a lazily visited journal under hidden; final anchor application uses one cancellable frame after body measurement and loads the next page only when the old offset is unreachable.

- [x] **Step 1: Failing tests.** Test short original has no toggle; normalized-short has toggle despite no layout overflow; LF/CRLF/space-only empty lines compact, full disclosure and editor preserve original; two rendered components expand independently. Stub layout only for unit overflow tests, use browser for real wrapping. Example:

```tsx
const original = '\n\nАбзац A\n  \n\t\nАбзац B\n\n';
render(<JournalEntryBody body={original} />);
expect(document.querySelector('.journal-body')?.textContent).toBe('Абзац A\n\nАбзац B');
await user.click(screen.getByRole('button', { name: 'Показать полностью' }));
expect(document.querySelector('.journal-body')?.textContent).toBe(original);
expect(screen.getByRole('button', { name: 'Свернуть' })).toHaveAttribute('aria-expanded', 'true');
```

- [x] **Step 2: Run red.** `npx vitest run tests/client/journal-entry-body.test.tsx`; confirm missing component/folding failures.
- [x] **Step 3: Implement.** Normalize preview only by removing blank edge lines and replacing internal blank runs with one blank line. Preserve original in expanded DOM and edit form. Measure actual four-line overflow via layout effect, ResizeObserver and font readiness/change; toggle appears for overflow or normalization difference. Render full body in ordinary project feed, opt-in body component in task feed; do not remount components on refresh. Keep keyset ordering and scroll owner unchanged.

```tsx
{collapseBodies ? <JournalEntryBody body={entry.body} /> : <p className="journal-body">{entry.body}</p>}
```

- [x] **Step 4: Browser and integration.** Extend actual-server E2E: short/5-line/wrapped-long/two-long/normalized-short entries; independently expand, refresh, switch tabs, check original text in editor/server and project feed. Check width/font changes and actual browser zoom 200%, keyboard toggle/menus, pagination and anchor. Run new client tests and affected journal/client suites; `npm run verify`, `npm run format:check`, `npm run check:kit`, `npm run check:package`, full `npm run test:e2e` once stable. Fix caused failures and record unrelated failures accurately without skip/empty tests.
- [x] **Step 5: Document, review, commit.** Add working D23 reference (not a new C-decision), UI/acceptance W01–W10 facts, STATUS changed areas, checks, limits and next task. Mark completed steps with evidence, run diff check and staged privacy/Gitleaks; commit `feat: collapse long task work progress entries`. Independent task review and final review over the feature range; no merge/push/deploy. Report existing branch/worktrees without deleting owner files.

## Plan self-review

Task 1 and Task 2 share scoped journal CSS, editor/panel and new browser tests; execute sequentially. Additional visibility props, lazy hidden mounting and feed-local disclosure are required by W06/W07 and have focused reveal/anchor regressions. Task 2 consumes Task 1 accessible labels and composer layout without changing controller contracts. W01–W03 are covered by Task 1; W04–W06 by Task 2; W07–W10 by both regression checks. Normalized-short disclosure, project opt-in boundary, original body, IME and uncertain retry have explicit checks. No schema/architecture change requires ADR.


## Execution result — 2026-10-16

Task 1: `c3e689a`, независимое spec/quality review Approved. Task 2: `3bb3764`, исправление hidden reveal `032b44d`; scoped re-review Approved. Форматирование regression test: `b6cdc00`. Итоговое feature review `bcb1c86..b6cdc00` Approved, открытых находок нет.

Root gates PASS: verify 1294/1294 unit/integration tests в 75 файлах, typecheck/lint/build; full E2E 328/328 в двух разрешениях без skips/retries; настоящий browser zoom 200%; format:check, check:kit, check:package, diff/staged guard/Gitleaks. Workspace privacy scan остаётся FAIL из-за прежних приватных локальных артефактов; history/preflight не запускались, внешних действий нет. Полные факты и ограничения — в [STATUS](../../STATUS.md), W01–W10 — в [ACCEPTANCE](../../ACCEPTANCE.md).
