# ADR 007 — однократная конвертация legacy расписания

Дата: 2026-10-07. Статус: принято владельцем для будущей реализации, [C17](../DECISIONS.md). G-MIGRATION закрыт как выбор политики; application implementation и production upgrade не выполнены.

## Контекст

S2–S3 хранит Auto/done расчётные интервалы, относительные locks, cached responses и undo. Простое удаление legacy полей может скрыть прежний план или вернуть старый контракт через retry. [Нормативное приложение, разделы 5–6](../superpowers/specs/2026-10-07-optional-scheduling-policy-proposal.md) содержит принятые правила и независимые случаи M01–M10.

## Решение

- Одной транзакцией сохранять exact originals в private migration archive и создавать целевую проекцию. Auth/session не копировать; archive не имеет cascade от active task, не доступен DTO/export/logs.
- Доступный корректный абсолютный legacy Auto интервал однократно становится явной парой inputStart/inputFinish. Для done приоритет у сохранённого completed интервала. Duration/status сохраняются; done не получает разрешения на скрытый перенос.
- Relative completed indices переводятся только с абсолютной опорой и календарём того же legacy context. При отсутствии восстановимого абсолютного интервала сохранять source/status и unknown с диагностикой; значения и относительные locks остаются в archive.
- Current, operation response и undo преобразуются по собственным historical state и digest. Современное состояние не подменяет старый snapshot. Cached target replies остаются frozen после restart и после внедрения нового CPM.
- Deadline не становится finish; notBefore не становится start. FS-конфликты сохраняются; невалидные поля не нормализуются, duration не исправляется автоматически.

## Подтверждение конкретного upgrade

Технический policy ID — `legacy-scheduling-v1`. До изменения существующей БД с pending migration 003 формируется preview: aggregate category counts и `previewDigest` по всем архивируемым scheduling originals, включая raw operation payload/response и undo JSON. Никаких auth/session values, task titles или source bodies в выводе.

Процедура upgrade принимает explicit `{ policyId: 'legacy-scheduling-v1', previewDigest }`. Это одноразовое подтверждение конкретного preview, не env/global bypass. Перед любым DDL/write внутри existing immediate migration transaction preview пересчитывается; неверный policy ID, отсутствие подтверждения или другой digest дают `MIGRATION_APPROVAL_REQUIRED`/`MIGRATION_PREVIEW_CHANGED` и полный rollback. Ревизии, источники, edges и history входят в digest; подтверждение устаревшего снимка не применяется к изменённой БД.

Обычный серверный startup не передаёт подтверждение и отказывает до writes, если existing БД нуждается в 003. Новый пустой экземпляр может создавать актуальную схему без legacy conversion; БД уже на 003 не требует повторного подтверждения. Неподдерживаемая legacy source schema отклоняется до промежуточных миграций, способных потерять history. Конкретные CLI flags и типы реализуются в Tasks 4–5 существующего [плана](../superpowers/plans/2026-10-07-optional-scheduling.md).

## Альтернативы и последствия

Source-only перенос сохраняет null Auto dates, но скрывает восстановимый прежний план. Конвертация всех relative значений от новой/случайной опоры придумывает даты. Принят однократный перенос только доступных интервалов с archive и явным preview; новые задачи остаются с необязательными датами. Относительные интервалы без опоры теряют активное абсолютное представление, что честно отражается в preview и unknown.

## Проверка

Предстоящие synthetic tests: M01–M10, точные counts/digests и auth preservation, разные current/history states одного taskId, missing/mismatched resolution, cached retry/restart, undo удалённой задачи, stale/missing acknowledgement, startup без подтверждения, repeated migration и rollback при отказе version insert. `npm run check:kit` проверяет ссылки, а не эти application behaviors.

Production execution требует отдельного поручения и backup по [PRIVACY](../PRIVACY.md). Archive сохраняет originals; downgrade без проверенной процедуры не обещается. Реальные данные агенту не требуются.
