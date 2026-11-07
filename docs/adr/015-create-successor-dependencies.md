# ADR 015 — Исходящие FS при атомарном создании

Дата: 2026-11-07. Статус: принятое рабочее техническое решение для поручения C33/D28; реализовано; результаты проверок и текущий цикл исправлений финального review — в [STATUS](../STATUS.md). Нормативные UX и приёмка — [спецификация](../superpowers/specs/2026-11-07-dependency-ux-design.md).

## Контекст

QuickAdd должен создавать задачу с выбранными предшественниками и последователями одной обратимой операцией. Существующий `task.create.predecessorIds` покрывает только входящие. Отдельный `dependency.create` после создания оставил бы частично созданную задачу при ошибке и потребовал нескольких Undo. [ADR 011](011-fs-command-cascade.md) уже определяет атомарный FS-каскад и nullable source semantics.

## Решение

Добавить optional command-only `task.create.successorIds: string[]`: уникальные UUID существующих leaf текущего проекта. Absent и `[]` не добавляют исходящих; `predecessorIds` сохраняет прежний смысл. Не добавлять default в parsed старую команду: canonical envelope durable replay должен остаться прежним. Новый optional field не попадает в Task/ProjectTree DTO и SQL; версия контракта остаётся 2. `task.edit` не расширяется, миграции нет. Совместимость означает старый клиент → новый сервер; старый strict сервер новый field не принимает, поэтому клиент и сервер обновляются одним комплектом.

После обычного parent conversion и создания T в candidate snapshot добавить все P→T и T→S с индивидуальными ID. Валидировать обе стороны и полный итоговый DAG после преобразования parent: summary/self/duplicate/cross-project/cycle отклоняются. Incoming и outgoing списки не переназначают явно выбранные ID на synthetic preserved-work child. Существующие incoming S и неизменённые IDs сохраняются.

Все added edges передаются одному существующему causal cascade C24/C25 до CPM, сохранения и increment revision. «Перед» создаёт T→S, не планирует T назад от S. Nullable и done/source/calendar/overflow правила сохраняются. Ошибка любого edge или cascade откатывает создание, parent conversion, рёбра, сроки, порядок, revision и Undo. Это один existing server transaction и один before-snapshot, а не серия commands.

Exact retry использует исходный неизменный envelope с обоими массивами и возвращает сохранённый response без повторного каскада. Изменённый successorIds под прежним operationId даёт существующий `OPERATION_REUSED`. Старые durable payload/response и frozen replay не мигрируются и не переписываются. Undo удаляет новую задачу и обе группы связей, возвращает предыдущие даты и прочие before values; journal collision checks продолжают действовать.

## Последствия и проверка

QuickDraft и его full equality/dirty/reset/captured-submission ownership включают обе стороны, отдельно для основного дерева и подзадач. Общий picker получает режим выбора направления, но panel incoming остаётся существующим task.edit draft, outgoing — guarded immediate command. Это ограничивает изменение контракта только созданием.

Обязательны независимые synthetic fixtures: incoming/outgoing/mixed и old absent; cycle через новую задачу, пересечение групп, malformed/duplicate/foreign IDs, invalid последняя связь после conversion, done/overflow rollback, каскад A→T→B, nullable без обратного планирования, exact replay/изменённый payload, один Undo с точными IDs/датами. Проверки реализации пока не выполнены; факты — в [STATUS](../STATUS.md).
