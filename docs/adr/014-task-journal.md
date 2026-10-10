# ADR 014 — журнал задач отдельно от плана

Дата: 2026-10-10. Статус: рабочее решение D21 для порученной функции; сервер, клиент и браузерная приёмка реализованы и прошли независимые reviews этапов. [Спецификация](../superpowers/specs/2026-10-10-task-journal-design.md) задаёт контракты и приёмку. Итоговые проверки ветки и исправления финального review отражены в [STATUS](../STATUS.md).

## Контекст

Датированный plain-text журнал показывает одну запись в проекте и конкретной задаче. CRUD не должен менять сроки, запускать scheduler или разрушать Undo плана. Текущий `Repository.save()` удаляет все tasks перед вставкой, поэтому journal FK с cascade без изменения save потеряет записи при любой плановой правке. Existing snapshots и durable frozen scheduling replies необходимо сохранить.

## Решение

Journal entities, revision и durable operation replay независимы от planning revision/operations/tree V2. Project-scoped CRUD выполняется SQLite IMMEDIATE transaction без solver; optimistic concurrency использует expectedJournalRevision. Ленты используют scoped keyset cursor, привязанный к journal и project revision. Последняя нужна для актуального поиска по названию задачи и изменения membership.

Адресная reconciliation tasks сохраняет IDs и journal FK для surviving задач. Task delete переносит записи удаляемой ветки в server-private sidecar своего существующего bounded Undo snapshot, затем удаляет ветку; Undo восстанавливает эти записи транзакционно и сохраняет текущие записи surviving задач. Каждый новый snapshot маркируется lifecycle version 1 и получает обязательный manifest count+digest, включая пустой набор; historical version 0 не требует manifest. Missing rows/manifest или mismatch отклоняют restore атомарно. Sidecar/manifest очищаются с snapshot. Журнал не включается в beforeSnapshot JSON и historical tree replies. Undo, которое удалило бы задачу с более поздними записями, даёт явный конфликт без потери текста; после явного удаления записей доступна повторная отмена.

Editor/delete baseline journal revision закрепляется при открытии; фоновые GET не принимают новую базу автоматически. Conflict resolution требует явного действия. JournalPage и task metadata должны иметь равную project revision: guarded tree read либо согласованный read-only набор labels обновляет titles/path/picker без сброса dirty planning/journal drafts; гонка показывает stale state, не смешанную ленту. Это отдельное чтение, не solver в journal CRUD.

Кнопка в шапке явно называется «Отменить изменение плана» и сохраняет прежний стек; journal CRUD управляется отдельными edit/delete действиями. Migration004 добавляет только journal tables/indexes и сохраняет C17 preview gate для legacy upgrade. Новых пакетов, сервисов или state frameworks нет.

Рабочее уточнение D21 после server review: cursor cap 4096 покрывает полный query из 300 UTF-16 units при worst-case JSON escaping (2048 было недостаточно). Plain text body/query должны быть well-formed Unicode: malformed surrogate отвергается 400, valid Unicode включая NUL сохраняется точно. В004 оба body CHECK используют `length(CAST(body AS BLOB)) BETWEEN 1 AND 30000`, считая UTF-8 bytes без обрыва на NUL; строгая shared schema отдельно проверяет 10000 UTF-16 units и непустой trim. Эти границы не являются новым C-решением и не меняют historical003/snapshots/replies.

## Последствия и альтернативы

Создание записи не делает plan command устаревшей и не убирает canUndo; две вкладки journal получают собственный revision conflict. Current journal read после frozen ack обязателен, если известная revision новее. Bounded sidecar не гарантирует восстановление после pruning/чужой плановой записи. Deleted text может оставаться в private replay/backups, как existing planning history.

Общий journal+plan Undo потребовал бы нового snapshot/replay/solver-free response механизма и изменения публичных planning contracts. Description/localStorage не обеспечивают отдельные записи, изоляцию и устойчивость к retry. Оба подхода отклонены для текущего ограниченного объёма. Работа с production storage, S5 export/import и remote publication остаётся отдельным поручением.
