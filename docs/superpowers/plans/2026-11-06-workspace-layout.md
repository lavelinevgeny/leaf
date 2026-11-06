# Workspace Layout Implementation Plan

**Итог исполнения, 2026-11-06:** Task 1 реализован и прошёл независимые reviews; UI1 локально слита в main. Приёмка L01–L08 завершена. Настоящий browser zoom 200% проверен координатором отдельно после реализации; первоначальное ограничение исполнителя снято. Actual-server проверки выявили native blur при переходе 600/601 px, исправленный локальным сохранением исходного фокуса. Итоговые проверки общего source UI1–UI3 и ограничения — в [STATUS](../../STATUS.md).

Ниже сохранён исходный план, включая незаполненные checkboxes как историческую запись; текущий статус задаёт итог исполнения, а не эти отметки. Повторно выполнять план не требуется.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить перекрытие desktop toolbar карточкой и добавить обратимое RAM-сворачивание проектов.

**Architecture:** Существующая `.app-shell` остаётся flex; при ≥1200 карточка становится статическим sibling `.workspace`, занимая 480 px ровно один раз. Локальное состояние App управляет Sidebar, CSS ограничивает ширину дерева, не перезаписывая пользовательскую ширину. API, scheduler, component mounting и существующие navigation guards сохраняются.

**Tech Stack:** React/TypeScript, существующие CSS, Vitest/Testing Library, Playwright actual-server fixtures; без новых зависимостей.

**Spec:** [workspace-layout-design](../specs/2026-11-06-workspace-layout-design.md).

## Global Constraints

- Desktop резерв: от **1200 CSS px включительно**, карточка **480 px**; overlay **900–1199 CSS px**; fullscreen **899 CSS px и меньше**.
- Collapse: полоса **48 px**, кнопка от **601 CSS px**, до **600 px** прежняя мобильная компоновка; RAM, без localStorage/серверного сохранения.
- Гант: видимая область минимум **160 px**; пользовательская ширина дерева 300–620 px, rendered width может быть меньше300 при недостатке места; прежний разделитель 6 px, toolbar 44 px без нового ряда.
- Не сбрасывать выбранную задачу, фильтры, раскрытие, шкалу, период, черновики и допустимую прокрутку. Resize не создаёт API-записей.
- Только синтетические данные. Изменение не завершает S4–S6, не разрешает push, публикацию или deployment.
- D25 — рабочая детализация, не новый C. Три PNG остаются неизменными; они и docs/UI.md просмотрены при подготовке.

## Карта файлов и границ

| Файл | Изменение |
|---|---|
| `src/client/App.tsx` | RAM collapse (начально false, reset при logout), wiring Sidebar/ProjectControls; `.workspace` modifier при selectedTask. Не перемещать header внутрь content и не перемонтировать timeline/panel. |
| `src/client/ProjectSidebar.tsx` | Управляемые `collapsed: boolean`, `onToggle: () => void`; одна постоянная toggle button, скрываемый mounted wrapper содержимого; локальный responsive focus fallback. |
| `src/client/ProjectControls.tsx` | `sidebarCollapsed?: boolean`; effect закрывает только временный menu, не action/dialog, не rename/settings drafts. |
| `src/client/strings.ts` | `collapseProjects: 'Свернуть проекты'`, `expandProjects: 'Развернуть проекты'`. |
| `src/client/styles/app.css` | Sidebar wrapper/collapse; старый header reserve ограничить 1001–1199; desktop main min-width:0. |
| `src/client/styles/planning.css` | Desktop static TaskPanel; дерево учитывает divider; компактный toolbar. |
| `src/client/styles/current.css` | Прежний margin карточки ограничить 900–1199. |
| `src/client/TaskTimeline.tsx` | Только полный title счётчика и sr-only span подписи scale; scheduling/width state не менять. |
| `tests/client/project-sidebar.test.tsx` (new), `tests/client/project-controls.test.tsx`, `tests/client/App.test.tsx` | State/focus/menu/logout tests в имеющемся mocking style. |
| `tests/e2e/workspace-layout.spec.ts` (new) | Actual-server geometry, interactions, boundary/state coverage. |
| `docs/UI.md`, `docs/ACCEPTANCE.md`, `docs/STATUS.md`, `docs/DECISIONS.md` | D25, L01–L08 и фактические результаты/ограничения. Без новой ADR: архитектура и зависимости не меняются. |

### Task 1: Доступный desktop layout и RAM-сворачивание проектов

**Interfaces:** `ProjectSidebar` получает `collapsed: boolean`, `onToggle: () => void`; App хранит `projectsCollapsed`. `ProjectControls` получает `sidebarCollapsed?: boolean` (default false). Новых публичных API/состояния timeline нет.

- [ ] **1. Добавить failing client tests.** Новый `project-sidebar.test.tsx` использует fixture `project` из `./fixtures.js`, jsdom, cleanup afterEach. Минимальный реальный тест:

```tsx
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
    return <ProjectSidebar projects={[project]} selectedId={project.id}
      onSelect={vi.fn()} onCreate={async () => false} onLogout={vi.fn()}
      busy={false} collapsed={collapsed}
      onToggle={() => setCollapsed(value => !value)} />;
  }
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Новый проект' }));
  await user.type(screen.getByLabelText('Название проекта'), 'Synthetic draft');
  const toggle = screen.getByRole('button', { name: 'Свернуть проекты' });
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('navigation', { name: 'Проекты' })).toBeNull();
  await user.keyboard(' ');
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAccessibleName('Свернуть проекты');
  expect(screen.getByLabelText('Название проекта')).toHaveValue('Synthetic draft');
});
```

Проверить реальные strings newProject/projectTitle перед запуском и использовать их точные значения. Дополнить существующий ProjectControls test: открыть menu, rerender с sidebarCollapsed=true, menu отсутствует; rename/settings draft не очищен. В App suite на независимых существующих HTTP fixtures проверить collapse → смена проекта/вкладки → состояние сохраняется; logout/login → раскрыто; dirty panel не вызывает confirm при collapse и не теряет ввод. Стабильный тестовый matchMedia mock должен поддерживать change events; не делать CSS assertions в jsdom.

- [ ] **2. Запустить красный цикл.** `npx vitest run tests/client/project-sidebar.test.tsx tests/client/project-controls.test.tsx tests/client/App.test.tsx`. Ожидание: new props/кнопка отсутствуют, новые assertions падают; не принимать прежние failures за нужный red.

- [ ] **3. Добавить actual-server red.** В новом spec импортировать `test, expect` из Playwright, `syntheticRuntime` из `../../scripts/e2e-server.js`, `seedOptionalRuntime, readTree` из `../helpers/optional-e2e.js`. Для каждого test runtime создаётся заново; `finally` сначала закрывает page.context, затем runtime. Seed до listener non-GET writes, затем goto и открыть `treeitem /^Этап P,/`. Основной независимый oracle:

```ts
const panel = page.getByRole('complementary', { name: 'Задача', exact: true });
const panelBox = (await panel.boundingBox())!;
const toolbar = page.locator('.gantt-toolbar');
const controls = toolbar.locator('button, select');
for (const control of await controls.all()) {
  const box = (await control.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + 1);
  expect(await control.evaluate(node => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit !== null && (hit === node || node.contains(hit));
  })).toBe(true);
}
expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
const treeBox = (await page.locator('.timeline-tree').boundingBox())!;
const timeBox = (await page.locator('.timeline-time').boundingBox())!;
if (page.viewportSize()!.width >= 1280)
  expect(treeBox.width).toBeGreaterThanOrEqual(300);
expect(timeBox.width).toBeGreaterThanOrEqual(160);
expect(timeBox.x + timeBox.width).toBeLessThanOrEqual(panelBox.x + 1);
```

Запустить `npx playwright test tests/e2e/workspace-layout.spec.ts`; нынешний overlay должен падать при обеих configured viewport 1280×800/1440×900. Listener writes включает все методы кроме GET/HEAD; сравнить readTree до/после чистых layout/view действий.

- [ ] **4. Реализовать малый layout patch.** В App main добавить `.workspace.panel-visible` по selectedTask. TaskPanel уже sibling main, оставить там. Desktop CSS:

```css
@media (min-width: 1200px) {
  .workspace { min-width: 0; }
  .task-panel { position: static; flex: 0 0 var(--leaf-task-panel-width); }
  .workspace-header.panel-visible { padding-inline-end: 28px; }
  .project-current-container.panel-visible { margin-inline-end: 0; }
  .timeline-tree { max-width: calc(100% - 166px); }
}
```

Последнее правило ставить перед существующим `.timeline-columns.list-view .timeline-tree` либо повторить list override после него, чтобы список занимал 100%. У карточки сохранить width480, height/stretch, z-index и внутренние scroll. Не добавлять margin/padding480 у main/content/header: flex panel уже вычитает480. Старый header media переписать в `min-width:1001px and max-width:1199px`; current.css — `min-width:900px and max-width:1199px`. Не менять существующий fullscreen899 и mobile600.

При 1200 раскрытая sidebar240 оставляет main480. Локально для 1200–1279 уменьшить горизонтальный padding planning-workspace до12px с каждой стороны (content456); max-width дерева290, divider6, Gantt160. Rendered дерево здесь вправе быть меньше300; не добавлять min-width300. При 1280 раскрытая sidebar240 оставляет main560, padding content48 оставляет512; дерево≤346 + divider6 + gantt≥160. Inline `--tree-width` и state width300..620 сохраняются, CSS только ограничивает rendered width. Не добавлять ResizeObserver/resize manager.

- [ ] **5. Уместить toolbar в456px при1200 и512px при1280.** Непосредственный текст scale label обернуть `<span className="gantt-scale-label">`; select aria-label остаётся. Счётчику добавить `title` с полным тем же текстом. Desktop≥1200 стили (более узкий padding только на нижней desktop-границе):

```css
@media (min-width: 1200px) and (max-width: 1279px) {
  .workspace-content.planning-workspace { padding-inline: 12px; }
}
@media (min-width: 1200px) {
  .gantt-toolbar { min-width: 0; gap: 4px; }
  .gantt-toolbar .filter-results {
    min-width: 0; flex: 0 1 auto; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .gantt-toolbar .task-view-control { gap: 0; }
  .gantt-toolbar .task-view-control button { gap: 4px; padding-inline: 6px; }
  .gantt-scale-controls { gap: 4px; }
  .gantt-toolbar .gantt-scale-controls button { padding-inline: 6px; }
  .gantt-scale-label {
    position: absolute; width: 1px; height: 1px; padding: 0;
    margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }
}
```

Высота44 неизменна и при list; viewControl и scale-controls не сжимаются, только secondary count. Проверить longest select label browser geometry, не угадывать по screenshot; не скрывать кнопки/переходить на второй ряд.

- [ ] **6. Реализовать Sidebar без потери состояния.** Одна toggle button вне mounted `.project-sidebar-content`; имя/title зависят от collapsed, aria-expanded=!collapsed. Wrapper содержит brand/nav/create/logout и controls, display:flex/column/flex:1/min-height:0; logout сохраняет auto margin. При min601 `.project-sidebar--collapsed` flex-basis48, padding-inline:4px, content display:none; при max600 toggle display:none, wrapper обычный вид независимо от RAM class. Скрытый wrapper не unmount: adding/title/ProjectControls drafts сохраняются. App onToggle только меняет boolean, не вызывает requestTaskNavigation/canNavigate. ProjectControls effect при collapsed делает setMenu(false) и ничего более; не менять key для закрытия menu.

В Sidebar один matchMedia('(max-width: 600px)') listener с cleanup, без persistence. На change проверить document.activeElement: если toggle становится невидимым, фокусировать первый enabled button внутри показанного content; если content скрывается при возврате601, фокусировать toggle. Если нет enabled sidebar action, фокусировать видимую выбранную кнопку текущего представления в `.workspace` (как fallback `.workspace` с tabIndex=-1). Не красть фокус у task panel либо элемента вне Sidebar. При обычном toggle оставить ту же кнопку DOM и фокус. App reset false при logout/new session, не при смене project/view.

- [ ] **7. Довести один test цикл L01–L08.** Добавить в этот же E2E файл следующие независимые сценарии; client suite проверяет branch/state, browser suite — реальные размеры и фокус:

| AC | Конкретная проверка |
|---|---|
| L01 | Обе configured viewport, открытая карточка, toggle оба состояния, активный поиск; oracle boxes/hit targets выше для каждого контрола. |
| L02 | `Масштаб Ганта` select options day/week/month сверить с реальным value; selectOption и keyboard ArrowDown+Enter; «Предыдущий период»/«Следующий период» click и Enter/Space меняют подписи дат шкалы; «Сегодня» возвращает текущий период. List/Gantt toggle оставляет toolbar height44 и y/row y, активный count не перекрывает controls. |
| L03 | Seed 30 задач (send task.create), длинное название, 6 уровней. Separator keyboard ArrowRight20 раз до620; pointer drag к краям; tree≥300 только в configured1280/1440 и Gantt≥160 во всех desktop cases. Для одинакового data-task-id сравнить y `.task-row` и соответствующего SVG row/bar; общий data-plan-scroll прокрутить. Сохранить inline --tree-width и после panel close/collapse убедиться, что возвращается прежняя ширина в допустимых пределах, не новое значение state. |
| L04 | Снимок readTree; заполнить quick-add title и task description, сменить scale/period, collapse/expand и resize; selected task/ввод/filter/expanded/scale неизменны, scroll offset = min(old,max). Non-GET writes пуст. |
| L05 | Новый project draft, menu→collapse, Enter/Space toggle; имя/expanded/focus, Tab не попадает в hidden nav; expand возвращает draft. Focus resize600/601 в обоих направлениях. |
| L06 | RAM при смене project и Tasks/Current/Journal; reload раскрывает. Current/Journal main right≤panel left и ширина main=viewport-sidebar480 (±1), без двойного current margin. Existing dirty navigation/focus tests также проходят. |
| L07 | Использовать Playwright route только для чтения tree: задержать ответ (loading), один503→retry, пустой synthetic project и no-match filter. Toggle доступен без строк, toolbar доступен где timeline смонтирован; error/retry не выданы за empty success. |
| L08 | `page.setViewportSize` 1199/1200: absolute/static; при1200 отдельно выполнить bbox/hit-target oracle для всех toolbar controls, Gantt≥160 и no page overflow, не требовать tree≥300;899/900: fullscreen480;600/601: toggle hidden/visible и RAM. Это CSS boundary test, не browser zoom. |

Для L08 дополнительно ручной настоящий browser zoom: запустить synthetic E2E runtime через существующий test fixture в headed режиме с `await page.pause()` временно локально (не коммитить pause); в Chromium меню установить Zoom200%, проверить `innerWidth` и полноэкранную карточку, Tab/закрытие и возврат фокуса. CSS zoom, CDP pageScaleFactor/deviceScaleFactor и уменьшение viewport не считаются этой проверкой. Если окружение не позволяет настоящий browser zoom, STATUS явно «не выполнено», не объявлять L08 полностью принятой.

- [ ] **8. Проверить и обновить документацию.** Запустить целевые client/E2E, затем `npm run verify`, `npm run format:check`, `npm run check:kit`, профильные регрессии:

```sh
npx vitest run tests/client/project-sidebar.test.tsx tests/client/project-controls.test.tsx tests/client/App.test.tsx
npx playwright test tests/e2e/workspace-layout.spec.ts tests/e2e/view-controls.spec.ts tests/e2e/current-tasks.spec.ts tests/e2e/task-panel-ux.spec.ts tests/e2e/task-filters.spec.ts tests/e2e/journal-navigation.spec.ts
npm run verify
npm run format:check
npm run check:kit
```

`verify` включает typecheck/lint/unit+integration/build, не заменяет actual-server E2E. Записать passed/failed/unrun по факту, ограничения overlay900–1199/mobile header/zoom и следующий task в STATUS, D25 в DECISIONS без C-промоции, L01–L08 в ACCEPTANCE, краткие desktop/sidebar правила в UI. Не трогать исторические originals/PNG.

- [ ] **9. Scoped local commit, independent review и исправления.** После проверок выполнить `git diff --check`, проверить status и staged security по repo workflow; stage только перечисленные реализованные файлы и документацию. Автор создаёт локальный commit `fix: keep workspace controls accessible beside task panel`, затем передаёт точный SHA reviewer. Reviewer читает `git show <SHA>`/`git diff <base> <SHA>` в текущем checkout и сверяет spec/AC, особенно header вне content, ровно один reserve480, toolbar456px при1200 и512px при1280. Исправления оформлять follow-up commits с релевантными повторными проверками, передавать новые точные SHA на review. Merge разрешён только после PASS; не включать чужие изменения, не push/deploy. Локальный reviewable commit не является публикацией.

## Передача

Этот план — один связный Task1; реализация и browser проверки ещё не выполнялись при его написании. Отдельные менеджеры layout, дополнительные hooks/components и новые библиотеки не требуются. Создание плана не изменяет production code/tests и не означает прохождения L01–L08.
