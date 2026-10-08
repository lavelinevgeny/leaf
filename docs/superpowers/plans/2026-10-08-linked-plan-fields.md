# Linked plan fields implementation plan

**Goal:** согласовать начало, окончание и длительность при явном редактировании панели по принятому C18.

**Architecture:** чистая функция domain рассчитывает связанное поле по существующему календарю. React завершает ввод по blur/Enter/выбору календаря и показывает черновик; прежняя task.edit сохраняет изменения атомарно с серверной валидацией, CPM и undo. API, schema, migration и фоновые расчёты не меняются.

**Tech Stack:** существующие TypeScript, React, Vitest, Playwright, Fastify/SQLite; без новых зависимостей.

**Spec:** [optional scheduling design, §3.3](../specs/2026-10-07-optional-scheduling-design.md).

## Constraints

Пустые поля допустимы; открытие/очистка не заполняет их. Окончание включительно; календарь weekdays/all-days. Не менять done без явного возврата; summary не редактируется. Все фикстуры синтетические; без runtime production и remote actions.

## Task 1: чистый пересчёт и контракт

Files: `src/domain/planning.ts`, `tests/optional-planning.test.ts`, `docs/DECISIONS.md`, `docs/SCHEDULING.md`, `docs/UI.md`, specification, `docs/ACCEPTANCE.md`.

Interface: `completeSourceEdit(source: SourceFields, field: keyof SourceFields, calendar: CalendarType): SourceFields`. Source уже содержит введённое значение. Возвращается новая согласованная тройка; очистка оставляет остальные значения; ошибки календаря/диапазона не исправляют source.

- [x] Добавить независимые literal tests: начало 09.10 + 2 рабочих дня → 12.10; окончание 13.10 при начале 09.10 → 3; длительность 3 при начале 09.10 → 13.10; окончание 12.10 + длительность 2 → начало 09.10. Проверить null, оба календаря, leap/year boundary, invalid/overflow и отсутствие mutation.
- [x] Запустить `npx vitest run tests/optional-planning.test.ts`, зафиксировать RED.
- [x] Реализовать таблицу C18 через `indexToDate(duration - 1, start, calendar)`, `indexToDate(1 - duration, finish, calendar)` и `workingDaysInclusive`; проверить итоговую тройку прежним validator.
- [x] Запустить тот же suite до GREEN и обновить нормативные тексты, различая editor gesture и независимое API хранение.

## Task 2: ввод, компактный UI и сквозная проверка

Files: `src/client/PlanFields.tsx`, new `src/client/CalendarDateInput.tsx`, `src/client/TaskPanel.tsx`, `src/client/strings.ts`, `src/client/styles/planning.css`, `tests/client/planning.test.tsx`, `tests/e2e/linked-plan-fields.spec.ts`, affected existing UI tests, `docs/STATUS.md`.

Interface: Date input принимает/возвращает ISO/null, показывает DD.MM.YYYY, поддерживает ручной ввод и native calendar. PlanFields сообщает validity родителю и вызывает чистый domain helper только после явного завершения изменённого поля.

- [x] Написать interaction tests: до blur второе поле прежнее; после blur/Enter согласовано; очистка не восстанавливается; календарь, error, disabled/done/summary, discard, focused keyboard, подсветка с доступной текстовой подписью.
- [x] Реализовать компактное число с единицами рядом и подсказкой о правилах. Save получает один patch после завершения ввода; ошибки блокируют сохранение и сохраняют черновик.
- [x] Проверить реальные browser/API/SQLite: ноль writes до Save, одна revision/operation/undo после Save, реальные даты/CPM/Гант, undo/restart, duration-only, очистка, invalid input, оба viewports. Обновить прежний UI mismatch case до нового согласованного ввода, сохранить проверку API rollback.
- [x] Запустить `npm run verify`, `npm run test:e2e`, `npm run format:check`, `npm run check:kit`, `npm run check:package`, `npm run security:workspace`; просмотреть synthetic panel в обоих viewports и diff.
- [x] Обновить STATUS фактами, ограничениями и следующим действием. Commit/push/deployment не входят в задачу.
