# FS link placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При новой FS-связи переносить ранние реальные даты и размещать бездатные полосы с учётом полного графа.

**Architecture:** Существующий серверный cascadeFs нормализует совместное изменение сроков и добавление связи. Чистая domain-проекция размещает условные полосы по DAG; server и client передают разные nullable today, реальные сроки/CPM не меняются. Клиент вычисляет проекцию полного графа один раз для рисунка и reveal.

**Tech Stack:** TypeScript, React/Vite, Fastify, SQLite, Vitest, Playwright; без новых зависимостей.

**Spec:** [C25](../specs/2026-10-08-fs-link-placement-design.md).

## Global Constraints

- Окончание включительно; реальный FS требует следующий рабочий день.
- Пустые исходные даты не материализуются. Условные значения не используются как реальные сроки/CPM/summary.
- Один authoritative server transaction для source/edges/cascade/revision/outcome/undo.
- Done/invalid/unavailable source, calendar overflow и DAG validation сохраняют текущие ограничения.
- Полный граф обрабатывается до фильтра/сворачивания; dependency-display pass итеративен и занимает O(V+E).
- Существующую чужую правку STATUS сохранить и исключить из коммитов этой задачи.
- Реальные данные/скриншот не копировать. Ни push, ни deployment не выполнять.

## Task 1: спецификация и план

Files: новая spec/plan; START_HERE.md, docs/DECISIONS.md, docs/SCHEDULING.md, docs/ACCEPTANCE.md, docs/STATUS.md.

- [x] Зафиксировать C25 и рабочий D18, явно ограничить исключение для source edit новым входящим ребром.
- [x] Связать новые правила с C19/C24, описать геометрию, календари, empty/invalid/overflow и атомарность.
- [x] Выполнить check:kit; отдельный агент проверяет требования и согласованность. Исправить замечания, повторить review.
- [x] Коммит документационного этапа после одобрения.

## Task 2: нормализация дат при добавлении связи

Files: src/domain/fs-cascade.ts; tests/fs-cascade.test.ts; tests/fs-cascade-repository.test.ts; tests/e2e/fs-dependencies.spec.ts.

- [x] Добавить сначала failing domain/repository tests L01–L03/L08: edited source + added edge, max fan-in, поздняя дата, span/null duration, done/rollback, retry/undo.
- [x] Разрешить push явно редактируемой задачи только при новом входящем ребре; без нового ребра оставить direct-source rejection. Existing validation не обходить.
- [x] Актуализировать прежний тест, ожидавший отказ совместного edit/add.
- [x] Browser test L02: сроки + picker keyboard, save, canonical fields, clean baseline, undo.
- [x] Запустить typecheck/lint, unit/integration и соответствующий actual-server E2E после build. Записать результаты в STATUS.
- [x] Отдельный агент делает scoped review; исправления и повторное review, затем коммит.

## Task 3: геометрия зависимостей для бездатных работ

Files: новый src/domain/dependency-display.ts; src/domain/scheduling.ts; src/client/gantt-view.ts, Gantt.tsx, TaskTimeline.tsx; tests/conditional-display.test.ts, tests/client/gantt-view.test.ts, tests/client/gantt.test.tsx, tests/e2e/fs-dependencies.spec.ts; при необходимости новые domain tests и package scripts для их включения.

- [x] Failing literal fixtures L04–L09: real→undated, all-undated chain/today в обе стороны, fan-in/diamond, group/today max, own source priority, invalid/unavailable/full/summary, reverse input order, deep DAG, clipped overflow.
- [x] Pure iterative projection: из full tasks/dependencies и C19 bases получить display; реальные проекции оставить неизменными. Общая projectExplicitSchedule(input, today=null) строит C19 bases и вызывает helper; сервер передаёт today=null.
- [x] Client переиспользует чистую projectExplicitSchedule для C19 bases от полного дерева и исходных полей, затем dependency display с today; memoize до visible rows. Reveal и initial window используют ту же карту. Не использовать прошлый shifted display как групповую опору.
- [x] Browser: новая связь и пунктирная полоса после предшественника, real source null, фильтр/скрытый predecessor, reload/undo, all-undated chain и отсутствие writes от keyboard/reveal.
- [x] Полный verify, format:check, check:kit, check:package; E2E зависимостей/conditional и затронутых timeline/filters/view controls. Workspace/staged checks перед коммитом.
- [x] Обновить STATUS и отметить выполненные шаги; отдельный агент проверяет этап и полный diff задачи. Исправить и повторно проверить замечания, затем коммит.

## Исполнение

Последовательное исполнение в текущей сессии; этапы зависят друг от друга. Реализацию ведёт основной агент, независимые агенты проводят review в отдельных worktrees до коммитов, как поручил владелец. Согласование продолжения между этапами не требуется.
