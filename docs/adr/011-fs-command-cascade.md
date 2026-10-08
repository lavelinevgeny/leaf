# ADR 011 — FS-каскад в атомарной команде

Дата: 2026-10-08. Статус: реализованное техническое решение текущего поручения; Tasks 1–2 прошли независимый review, actual-server приёмка Task 3 и итоговый candidate проходят финальные gates/review. Проверенные результаты — в [STATUS](../STATUS.md). Точные правила и acceptance — в [спецификации](../superpowers/specs/2026-10-08-fs-dependencies-design.md).

## Контекст

FS-рёбра и pure CPM уже существуют, но текущий анализ source dates не переносит зависимые интервалы. Владелец поручил простой ввод связи при создании, в карточке, списке и Ганте, перенос зависимых работ и пересчёт критичности предков. C13/C19 сохраняют nullable dates; [ADR 008](008-explicit-date-cpm.md) анализирует реальные введённые интервалы. Анализ и frozen history не должны получать побочные записи.

## Решение

- Добавить command-only `task.create.predecessorIds` и replacement `task.edit.changes.predecessorIds`, без Task/SQLite поля или migration. Unchanged edge IDs сохраняются; existing dependency.create/delete совместимы.
- Один pure cascade helper между окончательной command validation и existing calculateSchedule, внутри общей immediate transaction. Изменённый source проверяет свои incoming; downstream активируется только изменённой authoritative finish либо добавленным ребром. При прежнем controlling max без добавленного ребра successor сохраняется; следующий шаг активирует только действительно изменённый finish каскада. Топологический проход учитывает fan-in один раз и не чинит исторический reachable конфликт побочно.
- Рабочий default: необходимый late push; tight successor следует раньше при unchanged incoming endpoints и всех известных old/new finishes. Ручной положительный gap сначала поглощает задержку; сохранённого первоначального anchor нет. Removal не даёт pull.
- Full pair сохраняет рабочий span и nullable duration; start-only меняет только start; отсутствующие даты не материализуются. Known finish-only predecessor даёт bound, private unavailable не даёт. Done не двигается; required conflict/overflow откатывает всю команду.
- [C25](../superpowers/specs/2026-10-08-fs-link-placement-design.md) уточняет direct source edit: при новом входящем ребре действует necessary push, включая совместный edit сроков/связи; без нового ребра conflicting resulting start отклоняется. Relation-only add/create также вправе выполнить necessary push. Summary/critical indicators рассчитывает текущий C16 после каскада.
- Общий searchable picker во всех четырёх входах. Create/Details сохраняют общий draft атомарно; list/Gantt используют immediate existing edge commands. Existing approved graph сохраняется. Нового gesture mode/lag/planning mode нет.

Подробности tight/partial/done — технические рабочие defaults, а не дополнительные решения владельца. GET, undo, pure CPM, calendar edit и exact frozen replay не вызывают helper. Undo возвращает source/null, рёбра и private provenance одним действием.

## Альтернативы и последствия

Каскад внутри calculateSchedule смешал бы read-analysis с source writes и затронул frozen replies. Новый Auto/anchor или always-delta усложнили бы модель, fan-in и UI. Delay-only проще, но слабее покрывает перенос tight цепочки раньше; выбран tight default без persisted baseline.

Существующая схема БД, CPM formulas, migration archive, lockfile и стек сохраняются. Новый каскад меняет live command outcomes; прежние pure infeasible/frozen fixtures остаются. Цена strict-null: связь без известного start не назначает срок, а duration-only работа остаётся incomplete. Цена отсутствия anchor: после поглощения gap работа tight и следует обратно к новой границе. Независимые численные tests и repository/browser review подтверждают эти ограничения.
