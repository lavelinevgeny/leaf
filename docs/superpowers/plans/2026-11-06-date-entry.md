# Date Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Принимать короткие даты в сроках задачи с явным годом проекта и различать неполные сроки видимой подписью дерева.

**Architecture:** Один связный UI2 этап в существующем клиенте. `PlanFields` передаёт существующий `useProjectToday` обоим `CalendarDateInput` через необязательный `referenceToday`; локальный период редактирования фиксирует год. Отдельный formatter строки дерева использует существующие реальные даты, не меняя компактные чипы.

**Tech Stack:** TypeScript, React 19, Zod calendarDateSchema, Vitest/Testing Library, Playwright и syntheticRuntime.

**Spec:** [Согласованный дизайн D26](../specs/2026-11-06-date-entry-design.md), независимо одобрен перед подготовкой плана. Статус реализации фиксируется отдельно в STATUS.

## Global Constraints

- Только сроки задачи: карточка и общий быстрый ввод основного дерева/подзадач; журнал и фильтры периода сохраняют прежний ввод.
- Текущий год берётся в timezone проекта, независимо от браузера, Ганта, соседней даты и прежнего значения; прошедший день не переносится в следующий год.
- «Год фиксируется при фокусе текстового поля и используется до завершения этого редактирования»; blur, Enter, explicit commit и reset завершают период.
- «Недопустимый или незавершённый текст сохраняется для исправления»; сохранить точные исходные символы, включая краевые пробелы invalid input.
- C18 выполняется только по завершении ввода; nullable/C19, RAM drafts, guards, uncertain/exact retry сохраняются.
- «Новых колонок или высоты строки нет»; подписи читаются при 1280/1440, C30 временно скрывает дату под row actions.
- «API, schema, scheduler, зависимости пакетов и хранилище не меняются»; никаких date libraries, масок, автоназначения или новых настроек.
- D26 — рабочая детализация, не новое C-решение. S4–S6 и первый релиз остаются незавершёнными.
- Только синтетические данные; никаких push, публикации, deployment или чтения private runtime paths.

## File map

| Файл | Назначение изменения |
|---|---|
| `src/client/date-input.ts` (create) | Малый чистый parser с optional reference year и прежним legacy path. |
| `src/client/CalendarDateInput.tsx` | Новый optional prop, frozen edit year, полный display после commit, доступная постоянная подсказка. |
| `src/client/PlanFields.tsx` | `referenceToday={today}` для обоих редактируемых task fields; без изменения C18. |
| `src/client/gantt-view.ts` | `treeDateLabel` поверх `realDates`/`compactDateLabel`, без изменения compact formatter. |
| `src/client/TaskTree.tsx` | Только видимая `.task-date` использует `treeDateLabel`; title/aria остаются full computed labels. |
| `src/client/styles/planning.css`, `src/client/styles/app.css` | Компактная hint и достаточная ширина даты дерева в существующих сетках. |
| `tests/client/date-input.test.ts`, `tests/client/calendar-date-input.test.tsx` (create) | Parser и локальный edit lifecycle. |
| `tests/client/planning.test.tsx`, `tests/client/gantt-view.test.ts`, `tests/client/inline-add.test.tsx`, `tests/client/task-panel-schedule.test.tsx` | Интеграция C18, labels, quick draft и retry/guards. |
| `tests/e2e/date-entry.spec.ts` (create) | Actual-server сценарий в обоих существующих viewport projects. |
| `docs/DECISIONS.md`, `docs/UI.md`, `docs/ACCEPTANCE.md`, `docs/STATUS.md` | Рабочий D26, приёмка D01–D08 и фактические проверки. |

До UI edits прочитать `docs/UI.md`, `design/README.md`, открыть ровно три PNG из него; до commit прочитать `docs/PRIVACY.md`. Не менять исключённый экран подзадач. Существующие исходники: `CalendarDateInput` уже хранит raw/buffer и вызывает onChange на символах; `PlanFields.change` обновляет локальный source, а `commit` вызывает `completeSourceEdit`. Не заменять этот протокол deferred onChange: pending/current equality защищает obsolete buffer и C18.

### Task 1: Короткий ввод и подписи реальных сроков

**Interfaces:**
- Consumes: `calendarDateSchema`, `useProjectToday(timezone): string`, `completeSourceEdit(source, field, calendar)` и существующие imperative handles.
- Produces: `parseDateInput(raw: string, referenceYear?: string): string | null`; `CalendarDateInput` получает `referenceToday?: string`; `treeDateLabel(task: Task, schedule?: ProjectTree['schedule']): string`.
- `today?: string` сохраняет только кнопку «Сегодня»; отсутствие referenceToday не включает короткий ввод даже при наличии today. Summary disabled fields не получают новый prop.

- [ ] **1. Написать parser tests до кода.** В новом `tests/client/date-input.test.ts` использовать `it.each` с независимыми expected, не рассчитывать expected production parser:

```ts
import { expect, it } from 'vitest';
import { parseDateInput } from '../../src/client/date-input.js';
it.each([
  ['7.11', '2026', '2026-11-07'],
  ['07.11', '2026', '2026-11-07'],
  ['7.1', '2026', '2026-01-07'],
  [' 7.01.2024 ', '2026', '2024-01-07'],
  ['7.1.2030', '2026', '2030-01-07'],
  ['2024-02-29', '2026', '2024-02-29'],
  ['29.2', '2024', '2024-02-29'],
  ['31.2', '2026', '31.2'],
  [' 29.2 ', '2026', ' 29.2 '],
  ['7.', '2026', '7.'],
  ['7.11.26', '2026', '7.11.26'],
  ['7 /11', '2026', '7 /11'],
  ['7. 11', '2026', '7. 11'],
  ['  ', '2026', null],
  ['7.11', undefined, '7.11'],
  ['07.11.2026', undefined, '2026-11-07'],
  ['7.11.2026', undefined, '7.11.2026'],
])('%s with year %s → %s', (raw, year, expected) => {
  expect(parseDateInput(raw, year)).toBe(expected);
});
```

Run `npx vitest run tests/client/date-input.test.ts`; ожидается FAIL отсутствующего модуля.

- [ ] **2. Реализовать parser без изменения contracts.** Вынести старый inputDate в новый файл; legacy branch оставить прежним, scheduling invalid возвращает original raw:

```ts
import { calendarDateSchema } from '../shared/contracts.js';
export function parseDateInput(raw: string, referenceYear?: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const match = referenceYear
    ? /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(text)
    : /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  const iso = match
    ? `${match[3] ?? referenceYear}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`
    : text;
  return calendarDateSchema.safeParse(iso).success
    ? iso
    : referenceYear ? raw : text;
}
```

Повторить parser test; PASS. Не использовать `new Date` для нормализации invalid day/month.

- [ ] **3. Добавить red tests lifecycle компонента.** Новый jsdom test использует controlled harness, чтобы onChange отражался обратно в value, как в настоящем PlanFields:

```tsx
function Input({ referenceToday }: { referenceToday?: string }) {
  const [value, setValue] = useState<string | null>(null);
  return <CalendarDateInput label="Начало" value={value}
    referenceToday={referenceToday} onChange={setValue} />;
}
const user = userEvent.setup();
const view = render(<Input referenceToday="2026-12-31" />);
const input = screen.getByLabelText('Начало');
await user.click(input);
fireEvent.change(input, { target: { value: '7.11' } });
view.rerender(<Input referenceToday="2027-01-01" />);
expect(input).toHaveValue('7.11');
expect(screen.getByText('Без года — 2026')).toBeVisible();
await user.keyboard('{Enter}');
expect(input).toHaveValue('07.11.2026');
await user.click(input);
expect(screen.getByText('Без года — 2027')).toBeVisible();
```

Добавить отдельные cases: imperative commit при всё ещё focused input нормализует valid buffer и заканчивает период (следующая правка без blur берёт 2027); reset берёт свежий год; focus/blur без правки и referenceToday rerender не вызывают onChange/onCommit. Invalid ` 31.2 ` остаётся побайтно после blur/refocus, correction/whitespace работают. Без referenceToday нет hint/short conversion; today отдельно не включает short. Picker и Today оставляют один прежний commit. `aria-describedby` содержит и hint id, и внешний error/description id; обе строки существуют в DOM.

Run `npx vitest run tests/client/calendar-date-input.test.tsx`; red должен объясняться отсутствием short/frozen-year поведения.

- [ ] **4. Добавить minimal lifecycle в CalendarDateInput.** Добавить optional prop и локальные ref/state; helper для действующего года и начала периода:

```tsx
const [editYear, setEditYear] = useState<string | null>(null);
const frozenYear = useRef<string | null>(null);
function beginEdit() {
  frozenYear.current ??= referenceToday?.slice(0, 4) ?? null;
  setEditYear(frozenYear.current);
}
function endEdit() {
  frozenYear.current = null;
  setEditYear(null);
}
const hintYear = editYear ?? referenceToday?.slice(0, 4);
```

`onFocus` начинает период; `onChange` также начинает его, если explicit commit/reset уже завершил прошлый, и использует `parseDateInput(raw, frozenYear.current ?? undefined)`. `commit` парсит тем же frozen year, сохраняет existing `next === current.current` obsolete-buffer guard, нормализует buffer только для valid ISO/null и вызывает endEdit даже без edited. Invalid buffer не trim/format. Reset сбрасывает edited/buffer как прежде и завершает период; blur/Enter используют commit. Explicit commit при focused input обновляет raw до полного display и следующий onChange вновь фиксирует актуальный год. Picker/Today завершают прошлый период и очищают stale edited перед прежними onChange/onCommit. Не добавлять эффекты, меняющие дату при referenceToday.

Рядом с input вывести `<span id={yearHintId} className="date-year-hint">Без года — {hintYear}</span>` только с referenceToday; объединить id с descriptionId через `[descriptionId, referenceToday ? yearHintId : undefined].filter(Boolean).join(' ')`. Scheduling placeholder `ДД.ММ или ДД.ММ.ГГГГ`, legacy placeholder прежний. `displayDate` остаётся форматированием valid ISO, maxLength 10 сохраняется. Запустить оба новых tests, PASS.

- [ ] **5. Red tests PlanFields/C18 и timezone.** В `planning.test.tsx` расширить Editor optional timezone, фиксировать clock через `vi.useFakeTimers({ toFake: ['Date'] })`, очищать `vi.useRealTimers()` в afterEach. Проверить `2026-12-31T23:30:00Z`: UTC hint 2026, Asia/Tokyo hint 2027, browser zone не источник. При `2026-10-09T12:00:00Z`, start `12.10` с duration 2 до blur оставляет finish `12.10.2026`, после blur finish `13.10.2026`; finish `14.10` после Enter оставляет start `12.10.2026`, duration 3. Для обоих полей проверить leap, invalid/clear и error association. Прежние nullable tests должны пройти. Run `npx vitest run tests/client/planning.test.tsx`, ожидается red short/hint.

- [ ] **6. Подключить оба editable fields.** В mapping `CalendarDateInput` добавить ровно `referenceToday={today}`, сохранив условную передачу today и все callbacks. В `planning.css` добавить `.date-year-hint { font-size: 11px; color: var(--leaf-text-muted); line-height: 1.3; }`. Подсказка занимает место редактора, не строк дерева; проверить compact popup clipping и tab order. Run предыдущие tests, PASS.

- [ ] **7. Red tests labels и minimal row formatter.** В `gantt-view.test.ts` добавить импорт `treeDateLabel`; task без schedule с одной датой достаточно для independent fixture:

```ts
const start = task(1, { inputStart: '2026-11-07' });
const finish = task(2, { inputFinish: '2026-11-07' });
expect(treeDateLabel(start)).toBe('Начало: 7 нояб.');
expect(treeDateLabel(finish)).toBe('Окончание: 7 нояб.');
expect(compactDateLabel(start)).toBe('7 нояб.');
expect(compactDateLabel(finish)).toBe('7 нояб.');
```

Добавить explicit expected для full/same-day/empty/summary и conditional display: no real dates даёт пустую строку formatter, TaskTree даёт «Без дат»; start-only условная полоса не добавляет finish. Для summary prefix не добавляется, прежние computed title/aria полные ISO сохраняются. Run `npx vitest run tests/client/gantt-view.test.ts`, red missing export. Реализация рядом с compactDateLabel:

```ts
export function treeDateLabel(task: Task, schedule?: ProjectTree['schedule']) {
  const compact = compactDateLabel(task, schedule);
  if (schedule?.summaries[task.id]) return compact;
  const [start, finish] = realDates(task, schedule);
  return start && !finish ? `Начало: ${compact}`
    : finish && !start ? `Окончание: ${compact}` : compact;
}
```

Поменять только visible formatter в TaskTree (ныне около строки 293), не computedDateLabel и не остальные consumers compactDateLabel. Проверить фактическое monthLabels: для ноября сейчас `нояб.`; full date год остаётся в tooltip/accessible name. Run label tests, PASS. Подстроить существующий `.task-date` width/grid для readable longest partial label без новой колонки/высоты, не отменяя hover/focus C30.

- [ ] **8. Проверить drafts/guards/retry на short input.** В inline-add tests заменить один full-date happy path коротким с fixed Date и сохранить отдельный invalid raw draft другого parent. Проверить закрытие/reopen popup, переход между main/subtask quick drafts и ошибку создания: title, short-derived ISO, invalid raw остаются в своём draft; подтверждение одного не очищает другой. В task-panel-schedule tests добавить short start перед существующим failure/retry, проверить identical operation envelope и не потерянные description/dependencies; invalid date блокирует save, correction снимает error. Не менять механизм retry. Run `npx vitest run tests/client/inline-add.test.tsx tests/client/task-panel-schedule.test.tsx tests/client/planning.test.tsx` и исправлять только UI2 regressions.

- [ ] **9. Написать actual-server E2E до финальной UI подгонки.** Новый `tests/e2e/date-entry.spec.ts` импортирует test/expect, syntheticRuntime, seedOptionalRuntime/readTree/send и openTaskDates. Использовать existing try/finally закрытия page context/runtime как в linked-plan-fields; clock фиксируется до goto, реальные timers продолжают работать:

```ts
await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
let before = await seedOptionalRuntime(page, runtime);
const taskId = before.tasks.find((task) => task.title === 'Работа A')!.id;
before = await send(page, runtime.origin, before, {
  type: 'task.edit',
  taskId,
  changes: { durationDays: 2 },
});
await page.goto(runtime.origin);
await page.getByRole('treeitem', { name: /Работа A,/ }).click();
await openTaskDates(page);
const start = page.getByLabel('Начало', { exact: true });
await start.fill('9.11');
await start.press('Tab');
await expect(start).toHaveValue('09.11.2026');
await expect(page.getByLabel('Окончание', { exact: true })).toHaveValue('10.11.2026');
expect(await readTree(page, runtime.origin, before.project.id)).toEqual(before);
await start.fill('31.2');
await start.press('Tab');
await expect(start).toHaveValue('31.2');
await expect(start).toHaveAttribute('aria-invalid', 'true');
await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
expect(await readTree(page, runtime.origin, before.project.id)).toEqual(before);
await start.fill('9.11');
await start.press('Enter');
await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
```

После save проверить source snapshot start/finish ISO и revision +1. Через `send(task.create)` создать две leaf задачи «Только начало» и «Только окончание» с датой 2026-11-07 и duration null, в том же parent. Reload, проверить `.task-date` каждой строки видимым текстом `Начало: 7 нояб.` / `Окончание: 7 нояб.`; в List, Gantt left tree и подзадачах карточки родителя. Убрать hover на нейтральную шапку перед visible assertions C30. Проверить tooltip/accessible name с 2026, row heights совпадают с соседней ordinary строкой; bounding boxes даты остаются внутри tree viewport, без обрезки текста (`scrollWidth <= clientWidth`). Hint обоих полей видимы/описаны; keyboard Tab/Enter сохраняет доступ к duration и save. Прогнать `npx playwright test tests/e2e/date-entry.spec.ts tests/e2e/linked-plan-fields.spec.ts tests/e2e/workspace-layout.spec.ts`; конфигурация уже запускает **1440x900 и 1280x800**, не ограничивать одним project. Screenshots только synthetic при необходимости вне repo. Исправить layout и повторить affected E2E при изменениях.

- [ ] **10. Обновить документацию по фактам.** DECISIONS добавить D26 как working, UI описать scope short date и tree labels, ACCEPTANCE добавить D01–D08 с фактическим evidence, STATUS перечисляет файлы/команды/ограничения. Не повышать D26 до C и не заявлять release ready. Source финализировать до полного gate.

- [ ] **11. Финальные проверки один раз на финальном source.** Сначала форматировать только изменённые source/tests через `npx prettier --write` с явным списком файлов из diff. Затем `npm run verify` (включает typecheck/lint, все unit/integration и build), `npm run format:check`, `npm run check:kit`. Не дублировать отдельно полные unit/integration после verify. E2E из шага 9 должны относиться к тому же final source; если source менялся после них, повторить affected E2E до отчёта. При failures исправить и повторить затронутые проверки; перечислить реально passed/failed/not run. Для локального merge без публикации полный publication gate не требуется; push/deploy остаются неавторизованы.

- [ ] **12. Author local commit → независимые reviews → fix loop → coordinator merge.** Автор проверяет `git diff --check`, scoped diff и privacy, добавляет только собственные UI2 файлы и commit с английским subject `feat: simplify task date entry and clarify partial dates`. Согласованная исходная spec и чужие изменения не stage вслепую; docs координируются с владельцем текущего этапа. Записать `git rev-parse HEAD`; один независимый task reviewer, отличный от implementer, читает **этот exact SHA** через git show/diff в основном checkout и выдаёт два отдельных verdict: spec и quality. Spec verdict сверяет D01–D08 и границы, quality verdict — lifecycle/invalid buffer/C18/drafts/tests/layout. Никаких review по незафиксированному дереву или отдельного checkout. Замечания исправляет автор, делает fix commit, передаёт новый exact SHA task reviewer для scoped rereview исправлений и подтверждения обоих verdict. После принятых spec и quality verdict coordinator выполняет локальное слияние feat/date-entry в main по ранее данному разрешению, удаляет merged branch и сообщает branches/worktrees; автор сам main не меняет. Без push/deployment.

## Coverage / self-review

| Acceptance | Evidence в Task 1 |
|---|---|
| D01 | Шаги 1–2: mixed-length/full/ISO/explicit year; 3–6: оба поля, blur/Enter full format. |
| D02 | Шаг 3: frozen year, explicit commit/reset и новый edit; шаг 5: UTC/Tokyo около Нового года, same-year past date. |
| D03 | Parser leap/invalid/unfinished/2-digit/whitespace; controlled raw/error/correction/clear в шагах 3/5/9. |
| D04 | Optional prop isolation, aria hint и legacy/picker/Today tests шагов 3–6. |
| D05 | Before/after commit C18, nullable tests, unchanged server snapshot в шагах 5/9. |
| D06 | Scoped drafts, error, guard и exact retry шаг 8; существующий linked-plan-fields E2E шаг 9. |
| D07 | realDates/summary/conditional formatter fixtures шаг 7; все общие tree surfaces шаг 9, chips unchanged. |
| D08 | Реальный synthetic server, invalid→repair→save и layout в двух viewport projects шаг 9; final gates шаг 11. |

План не запускает реализацию сам по себе. Исполнение и review cycle уже поручены координатору; нового выбора режима или подтверждения не требуется.
