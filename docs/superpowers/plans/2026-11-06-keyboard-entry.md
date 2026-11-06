# Keyboard Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать существующий keyboard quick add обнаруживаемым и непрерывным, сохранив draft/context и не похищая фокус поздним ответом.

**Architecture:** Один связный UI3 этап: локальная кнопка и защита IME/возврата фокуса в `QuickAdd`, контекстная подсказка в существующей шапке дерева. `App` остаётся владельцем snapshot/ack/exact retry и `parentId/afterId`; новый hotkey framework, глобальное состояние и серверные изменения не нужны.

**Tech Stack:** Existing React/TypeScript, CSS, Vitest/Testing Library, Playwright с synthetic Fastify/SQLite runtime.

**Spec:** [D27: keyboard entry](../specs/2026-11-06-keyboard-entry-design.md). Исполнитель читает спецификацию вместе с планом.

## Global Constraints

- «Новая форма, справочный диалог, глобальная комбинация клавиш и менеджер hotkeys не нужны».
- Кнопка: `type=button`, имя/tooltip «Перейти к вводу задачи», pointer-зона не меньше 28×28 px.
- «Высота шапки, toolbar 44 px и общих строк 38 px не меняется»; существующая шапка дерева 58 px, ширина дерева 266–346 px.
- Row Enter открывает карточку; Insert — сосед, Shift+Enter и Shift+Insert — ребёнок. Tab/Shift+Tab меняют уровень только в активном названии.
- Inline: «Esc — отменить»; non-inline: «Esc — выйти». Даты, связи и прочие controls не показывают подсказку названия/строки.
- API, schema, scheduler, dependencies и хранение состояния не расширяются. Сохраняются C18/C19/C31, D25/D26 и только три утверждённых PNG.
- Только synthetic fixtures/runtime. Нет push, публикации или deployment; S4–S6 остаются незавершёнными.

---

### Task 1: Обнаруживаемый ввод, scoped hints и безопасный ack focus

**Files:**

- Modify: `src/client/QuickAdd.tsx` — плюс, title-focus state, IME и локальная аренда возврата фокуса.
- Modify: `src/client/TaskTimeline.tsx` — подсказка в существующей `.timeline-heading`.
- Modify: `src/client/TaskTree.tsx` — доступное описание row hotkeys; существующий `event.target !== event.currentTarget` сохраняется.
- Modify: `src/client/strings.ts`, `src/client/styles/app.css`, `src/client/styles/planning.css` — тексты и компактная геометрия.
- Modify only if needed: `src/client/App.tsx` — scoped visibility boolean для main/subtask input; не менять `createTask`, `sameQuickDraft`, `sentQuickRawVersion`, очищение snapshot или exact retry.
- Test: `tests/client/quick-add.test.tsx`, `tests/client/inline-add.test.tsx`, `tests/client/App.test.tsx`.
- Create: `tests/e2e/keyboard-entry.spec.ts`.
- Update: `docs/ACCEPTANCE.md`, `docs/STATUS.md`, `docs/UI.md`, `docs/DECISIONS.md` — факты D27 и результаты, без объявления нового C-решения.

**Interfaces:**

- Consumes unchanged: `AddContext { parentId: string | null; afterId?: string }`, `onCreate(title, context, plan, predecessorIds): Promise<boolean>`, `acknowledgement?: number`, controlled title/plan/predecessor/raw draft callbacks.
- Produces no new domain interface. При необходимости добавить только `active?: boolean` в QuickAdd (default `true`): main получает `projectView === 'tasks'`, subtask — только видимость своего раздела. Контролируется текущим UI, не отдельным store. Проверять также DOM `[hidden]` и `isConnected` непосредственно перед `.focus()`.
- Hint mode хранить в `TaskTimeline` локально как `'row' | 'input' | null`, вычислять по **точному** focus target в `.timeline-tree`: `[role=treeitem]` или `#quick-task`. Это не `:focus-within` всего дерева: даты, плюс, actions и связи не равны title/row focus.

- [ ] **Step 1: Добавить failing controlled tests K01/K06/K07.**

В `quick-add.test.tsx` сохранить существующий `Editor` для schedule tests; добавить отдельный `FocusEditor` с controlled title/plan/context/predecessors, двумя независимыми QuickAdd (`inputId="quick-task"` и `"quick-subtask"`), внешней кнопкой и props `busy`, `blocked`, `active`, `acknowledgement`, `create`. Context изначально `{ parentId: task(1).id, afterId: task(2).id }`, plan с датой и duration 3, predecessors `[task(3).id]`. Callback `create` получает эти значения без изменений. Не выдавать статический `title` за controlled draft. Для deferred ответа использовать:

```tsx
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
```

Первый конкретный regression test можно добавить сразу к существующему `Editor`:

```tsx
it('K01 plus focuses the title without creating or replacing its draft', async () => {
  const create = vi.fn(async () => true);
  render(<Editor create={create} />);
  const user = userEvent.setup();
  const input = screen.getByLabelText('Новая задача', { exact: true });
  await user.type(input, 'Сохранённый черновик');
  const plus = screen.getByRole('button', { name: 'Перейти к вводу задачи' });
  expect(plus).toHaveAttribute('type', 'button');
  expect(plus).toHaveAttribute('title', 'Перейти к вводу задачи');
  await user.click(plus);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Сохранённый черновик');
  plus.focus();
  await user.keyboard('{Enter}');
  expect(input).toHaveFocus();
  plus.focus();
  await user.keyboard(' ');
  expect(input).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
});
```

Добавить controlled race tests, сохраняя один и тот же экземпляр editor через `rerender`, а не remount. Варианты `outside` и `outside→blur→body` должны содержать именно `.focus()` внешней кнопки и `.blur()`; не только подмену `document.activeElement`. Каркас второй половины каждого теста:

```tsx
// create возвращает deferred.promise; пользователь уже отправил title.
view.rerender(<FocusEditor create={create} busy acknowledgement={0} />);
const outside = screen.getByRole('button', { name: 'Вне ввода' });
outside.focus();
outside.blur();
expect(document.activeElement).toBe(document.body);
await act(async () => request.resolve(true));
view.rerender(<FocusEditor create={create} acknowledgement={1} />);
expect(document.activeElement).toBe(document.body);
```

Парный позитивный test не переводит фокус наружу: browser-like disable может сбросить input в body, ack возвращает в **тот же** input. Использовать существующий подход тестов журнала, где spy на `HTMLElement.prototype.focus` не позволяет фокусировать disabled control: jsdom иначе маскирует race. Отдельно проверить hide (`hidden` wrapper)/`active=false`, смену контекста без ack и unmount до resolve: не фокусируется другой editor. Exact retry покрывается App fixture ниже, а не выдуманным QuickAdd retry API.

IME тест должен проверять и отсутствие native submit, и отдельный следующий Enter:

```tsx
const input = screen.getByLabelText('Новая задача', { exact: true });
fireEvent.change(input, { target: { value: 'Составленный текст' } });
fireEvent.compositionStart(input);
fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
expect(create).not.toHaveBeenCalled();
fireEvent.compositionEnd(input);
input.focus();
await userEvent.keyboard('{Enter}');
expect(create).toHaveBeenCalledTimes(1);
```

`fireEvent.keyDown` сам не имитирует browser implicit submit, поэтому добавить browser assertion K07 в Step 6. Запустить `npx vitest run tests/client/quick-add.test.tsx`: новые tests должны падать на отсутствующую кнопку/небезопасный focus. Existing schedule ack test обновить: восстановление разрешено для отправленного ввода, один лишь произвольный increment acknowledgement без отправки больше не даёт права похитить фокус из schedule.

- [ ] **Step 2: Добавить App fixtures и подсказки tests до реализации.**

В `App.test.tsx` переиспользовать существующие synthetic HTTP fixtures и tests «clears a quick draft only after an uncertain create is confirmed by exact retry», «confirms %s IDs and restores correct title focus after global exact retry», «keeps changed same-title %s draft on a late create acknowledgement». Для delayed ack удержать **только** command response:

```tsx
const originalFetch = fetchMock.getMockImplementation()!;
const response = deferred<Response>();
let accepted: Response | undefined;
fetchMock.mockImplementation((url: string, init?: RequestInit) => {
  if (url.endsWith('/commands') && init?.method === 'POST') {
    void Promise.resolve(originalFetch(url, init)).then((value) => { accepted = value; });
    return response.promise;
  }
  return originalFetch(url, init);
});
// После отправки через реальный App:
await waitFor(() => expect(accepted).toBeDefined());
const outside = screen.getByRole('tab', { name: 'Журнал', exact: true });
outside.focus();
outside.blur();
await act(async () => response.resolve(accepted!));
expect(document.activeElement).toBe(document.body);
expect(commands).toHaveLength(1);
```

Exact retry использует существующую lost-response fixture и тот же envelope/ID: focus retry → blur → ack не возвращает focus. Не ослаблять busy/blocked. Сохранить существующий queued `fireEvent.change` boundary более нового draft: поздний ack его не очищает. Два последовательных root/child submit проверяют parent/after из command payload и authoritative order/defaults.

В `inline-add.test.tsx` добавить проверки focus row → input → schedule/action/outside. Использовать `fireEvent.focus`/`blur` только для подсказок, реальные `.focus()` для focus race. Проверять видимый текст, а не только `aria-description`. Row Enter вызывает `onSelect` ровно один раз; Insert/Shift+Insert/Shift+Enter дают ожидаемые `onAction`; keydown дочернего input/button не вызывает row handler. Non-inline Escape оставляет текст и скрывает hint до следующей активации, inline Escape сохраняет прежние clear/return rules. Команды title, row и Escape ниже задаются через strings, не копиями условной бизнес-логики в tests.

Run: `npx vitest run tests/client/quick-add.test.tsx tests/client/inline-add.test.tsx tests/client/App.test.tsx`. Зафиксировать ожидаемые failures новых assertions; не исправлять unrelated tests и не отключать suites.

- [ ] **Step 3: Реализовать плюс, IME и локальную защиту focus.**

Поменять только декоративный `.draft-dot` на настоящий button с тем же SVG/знаком:

```tsx
<button type="button" className="draft-dot quick-focus"
  aria-label={strings.focusQuickInput} title={strings.focusQuickInput}
  disabled={busy || blocked}
  onClick={() => input.current?.focus()}>
  {/* существующий SVG/плюс */}
</button>
```

Никаких `onTitle`, `onContext`, `onPlan`, `onInputDraft`, `onPredecessors`, `cancel` в focus command. `submitBlockedReason` блокирует submit, а не эту кнопку. Style перекрывает нынешний `.inline-quick-add .quick-line > .draft-dot` (сейчас декоративные 10×10): `flex: 0 0 28px; width:28px; height:28px; min-width:28px; padding:0; display:grid; place-items:center`, явные border/background/hover и `:focus-visible` outline. В пределах 38px строки, без `position:absolute` поверх title.

Ввести `const composing = useRef(false)`; handlers `onCompositionStart`/`End` меняют ref. В начале title `onKeyDown`:

```tsx
if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
  if (event.key === 'Enter') event.preventDefault();
  event.stopPropagation();
  return;
}
if (event.key === 'Enter') event.stopPropagation();
```

В `onSubmit` после `preventDefault` проверить `!composing.current`, затем вызывать существующий `submit`. Не отправлять вручную второй create из title keydown. Все прежние Alt+D/Alt+L/Escape/Tab branches оставить.

Заменить широкий критерий `body || input || form.contains(active)` на локальную revocable lease. При реальном submit записать lease с текущим input/form и context; только одна отправка (`busy/blocked` и локальный ref до await предотвращают double Enter). Ядро локального guard (ref не является новым глобальным состоянием):

```tsx
const lease = useRef<{ input: HTMLInputElement; revoked: boolean } | null>(null);
useEffect(() => {
  const leave = (event: FocusEvent) => {
    const current = lease.current;
    if (current && event.target !== current.input) current.revoked = true;
  };
  document.addEventListener('focusin', leave);
  return () => {
    document.removeEventListener('focusin', leave);
    lease.current = null;
  };
}, []);
// После submit guards, до await:
if (input.current) lease.current = { input: input.current, revoked: false };
```

Полная lease также хранит отправленный editor/context; revoke listener: если lease существует и target — другой control, отозвать lease навсегда для этого отправленного запроса. Переход на собственную submit кнопку перед отправкой допустим, но **после** отправки любой самостоятельный уход с title отзывает lease, включая schedule controls и retry. Обычный blur disabled input в body без нового focusin не отзывает lease. Позднейший blur внешнего control не восстанавливает её. Не пересоздавать lease при ack и не возобновлять из `activeElement === body`.

Ack/success должны только запросить restore для существующей lease; consume один раз после `!busy && !blocked`. Проверить `input.isConnected`, `active`, отсутствие ancestor `[hidden]`, enabled, принадлежность прежнему editor и неизменность пользовательского контекста. Само подтверждение create законно меняет `afterId`: context-change effect разрешает изменение в том же commit, что increment `acknowledgement`, но отзывает при самостоятельном `onContext`/смене parent/project/root/editor. После восстановления lease потребляется; новый submit создаёт новую. Для uncertain ответа `false` нельзя автоматически отозвать lease, потому что ack может прийти exact retry; уход пользователя на retry всё равно её отзывает. Cleanup при unmount отзывает lease. Не использовать layout visibility `getClientRects` в jsdom как единственный признак видимости; явный active/hidden + browser E2E проверяют скрытие.

Сохранять `acknowledgeFields`/raw version semantics. Удалить повторное право восстановления из прямого `onCreate === true` и acknowledgement: оба пути могут запросить одну lease, но только один её потребляет. Доработать точный алгоритм по tests, без глобального focus manager и без изменений snapshot ownership в App.

- [ ] **Step 4: Встроить hints без увеличения header.**

Добавить strings:

```ts
focusQuickInput: 'Перейти к вводу задачи',
treeKeyboardHint: 'Enter — открыть · Insert — сосед · Shift+Enter — подзадача',
quickKeyboardHint: 'Enter — добавить · Tab / Shift+Tab — уровень',
quickCancelHint: 'Esc — отменить',
quickExitHint: 'Esc — выйти',
```

QuickAdd title держит отдельное `titleFocused` (не `editing`: schedule тоже включает editing). Установка на title focus, очистка на blur/Escape; повторный focus активирует. Non-inline hint рендерить в существующей quick-meta только при `titleFocused && editing`; родительский контекст/dirty marker сохранить. Inline описание title содержит правильный Esc; визуальный hint размещает TaskTimeline. Подсказки не получают tabindex и live announcement на каждый символ. В treeitem `aria-description` объединить существующие context/error labels с `treeKeyboardHint`. Для subtask `TaskTree` (существующий `rootId`) показывать тот же row hint в существующей области раздела только когда exact treeitem владеет focus; локальный boolean очищается при blur в child control/вне дерева. Main hint остаётся только в header, без дублирования. Добавить assertion subtask row → action → title → dates к K02.

TaskTimeline `.timeline-tree` получает focus/blur capture: определить mode только по `event.target.matches('[role="treeitem"]')` или `event.target.id === 'quick-task'`; не считать вложенную кнопку строкой через closest. При blur очистить; при Escape title очистить input hint (фокус может остаться на non-inline title). Main inline Escape уходит по существующему App onCancel. В неактивной tasks вкладке hint скрыт через существующий `active` TaskTimeline prop; refs не возвращают фокус при `active=false`.

В `.timeline-heading` оставить оба заголовка в верхней строке, а hint разместить отдельной нижней областью **внутри** неизменных 58px:

```css
.timeline-heading { display:grid; grid-template-rows:16px 30px;
  row-gap:2px; padding:5px 10px; box-sizing:border-box; }
.timeline-heading-labels { display:flex; justify-content:space-between;
  min-width:0; gap:8px; }
.tree-keyboard-hint { min-width:0; margin:0; font-size:10px;
  line-height:10px; font-weight:400; overflow-wrap:normal; }
```

Сумма 16+30+2+10 = 58; hint может занять три строки при 266px, labels не пересекаются с ним. Существующие height/sticky/border и Gantt header alignment сохранить; удалить конфликтующий прежний flex/padding, не добавлять новый toolbar или offset. При пустом hint нижняя область сохраняет размер. Не обрезать текст ellipsis: проверка при минимальной ширине должна видеть все команды. CSS значения подтвердить браузером, при необходимости уменьшить horizontal padding/межсловные gaps, не увеличивая высоту и не пряча заголовки.

Run: `npx vitest run tests/client/quick-add.test.tsx tests/client/inline-add.test.tsx tests/client/App.test.tsx`. Все новые и существующие assertions проходят; особенно non-inline Esc, dates navigation и raw draft protection.

- [ ] **Step 5: Добавить короткую actual-server E2E K08.**

Новый `keyboard-entry.spec.ts` импортирует `test, expect`, `syntheticRuntime`, `seedOptionalRuntime`, `readTree` по примеру `inline-add.spec.ts`. Один сценарий автоматически выполняется обоими существующими Playwright projects; runtime закрывается в `finally`.

Последовательность: seed → goto → plus Click/Space → две root tasks → row Shift+Enter → две child tasks. Для каждого create ждать `toHaveValue('')` и `toBeFocused()`; читать authoritative tree и проверять parentId/sortOrder и counts, не считать только DOM строки. Даты пусты/duration 1/связи пусты после ack; before submit подготовить даты/связь, повторно нажать плюс, проверить chip/draft и сохранённые source fields без изменения context. Затем invalid duration в существующем schedule popover → Enter не создаёт → исправление → Enter создаёт ровно одну → следующее создание работает. Это реальная validation error; неопределённый HTTP outcome и exact retry остаются в client fixtures, без искусственной подмены server успеха browser-route mock.

Проверить row Enter открывает карточку и не создаёт задачу; subtask плюс фокусирует `#quick-subtask`, сохраняя main draft. Закрыть панель штатно. Переключить список/Гант и проверить один smoke повторного focus без дублирования всей матрицы.

IME browser проверка: `input.dispatchEvent('compositionstart')`, затем `evaluate` создаёт `new KeyboardEvent('keydown', { key:'Enter', code:'Enter', isComposing:true, cancelable:true, bubbles:true })`; assert `input.dispatchEvent(event) === false`, authoritative task count прежний. После `compositionend` отдельный `input.press('Enter')` создаёт ровно одну задачу. Это доказывает подавление default; аппаратная OS IME automation не заявляется.

Снять bounding boxes `.timeline-heading`, `.gantt-toolbar`, реальной `.task-row` до/после focus row/input/date; высоты 58/44/38 и первая row.y неизменны. Через `page.addStyleTag` ограничить `.timeline-tree` шириной 266px, затем 346px (локальная test-only fixture), проверить hint `scrollHeight <= clientHeight`, labels/hint rectangles не пересекаются и header не выше 58; удалить style перед следующими действиями. На обоих viewport проверить viewport overflow, наличие title/date headings и 28×28 hit target plus. Не увеличивать min-width продукта ради теста. Синтетические screenshot только во временную директорию при необходимости визуального осмотра; не сохранять runtime/скриншоты в репозиторий.

- [ ] **Step 6: Выполнить финальную проверку, обновить документы.**

После task review/fix-loop и завершения UI1–UI3 координатор выполняет один финальный `npm run verify` (включает typecheck, lint, все unit/integration и свежий build); затем `npm run format:check`, `npm run check:kit`, `git diff --check`. На **этом свежем build** выполнить headless:

```sh
npx playwright test tests/e2e/keyboard-entry.spec.ts tests/e2e/inline-add.spec.ts tests/e2e/date-entry.spec.ts tests/e2e/workspace-layout.spec.ts
```

Playwright config уже содержит `1440x900` и `1280x800`; не ставить `--headed`, не запускать старый dist, не повторять весь E2E suite без причины. Если требуется исправление после verify, повторить затронутый test и финальный gate для изменённого кандидата; не дублировать полный verify из-за одного documentation-only исправления. Записать фактические passed/failed/not run, ограничения IME automation и дальнейшую S4 задачу в STATUS; acceptance K01–K08 ниже перенести/сослаться из ACCEPTANCE. Не объявлять push/deployment или первый релиз.

| ID | Адресная проверка |
|---|---|
| K01 | Controlled main/subtask plus Click/Enter/Space; busy/blocked и submitBlockedReason; весь draft/context неизменен; browser hit target/focus outline. |
| K02 | Timeline row/input/date/action focus hints; non-inline Esc; 266/346px и оба viewport; header/toolbar/row 58/44/38, без overlap/shift. |
| K03 | Existing row shortcuts + Shift+Insert, child control isolation, title Tab/Shift+Tab и обычный date Tab; plus не меняет подготовленный context. |
| K04 | App/server по две root и child creations; exact parent/after/order/defaults, empty Enter и отсутствие auto-open panel. |
| K05 | App deferred failure/uncertain/pending/exact envelope retry; одна запись, новый draft/raw values переживают late ack. |
| K06 | Controlled/App positive restore; outside→blur→body, retry→blur, context/hide/unmount revoke; другой editor не получает focus. |
| K07 | Client composition + следующий Enter; browser default canceled, ровно одна запись; row children не запускают shortcuts. |
| K08 | Actual-server root→child→validation error/correction→next create; list/Gantt/subtask smoke, даты/связи, geometry на обоих viewport. |

- [ ] **Step 7: Scoped commit, независимый review и локальное завершение.**

Коммит выполняет исполнитель/координатор после чтения PRIVACY, review staged diff и требуемых локальных guards; plan writer Git не меняет. Stage только перечисленные UI3 файлы и согласованные документы. Subject: `feat: make keyboard task entry discoverable`. Никаких unrelated изменений, credentials, runtime files или отключения hooks.

Передать независимому reviewer точный commit SHA, spec и план. Reviewer читает `git show`/`git diff` в текущем checkout и возвращает **два отдельных verdicts**: соответствие spec K01–K08 и соответствие repo standards/security/maintainability. При findings исполнитель исправляет в scoped follow-up commit, прогоняет адресные checks и reviewer повторно оценивает новые exact commits; цикл до отсутствия blocking findings. Координатор выполняет разрешённый владельцем локальный merge в main после двух положительных verdicts, удаляет merged branch, сообщает оставшиеся branches/worktrees. Без нового запроса разрешения для уже согласованного локального цикла; remote actions по-прежнему вне задачи.
