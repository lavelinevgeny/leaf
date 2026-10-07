# ADR 009 — приватное происхождение недоступного legacy интервала

Дата: 2026-10-08. Статус: техническое решение Task 4 для исполнения принятого [C17](../DECISIONS.md), ожидает независимого review реализации. Это не новый выбор продуктовой политики.

## Причина

У done с относительным completed lock может сохраниться валидная input pair, хотя абсолютной опоры для lock нет. Пара должна остаться неизменной, но не превращаться в восстановленный legacy интервал. Одних source fields недостаточно для воспроизводимого unknown после restart или undo. Требования конвертации — [ADR 007](007-legacy-scheduling-migration.md).

## Представление

- `LegacyResolution` содержит context, taskId, SHA-256 canonical original task (`legacyDigest`), SHA-256 полного собственного frozen snapshot (`contextDigest`), source и outcome: `source`, `materialized-auto`, `materialized-done`, `unavailable`. Контекст включает собственные project/calendar/origin, все задачи и edges. Mapper проверяет оба digest до DDL; современное состояние не подставляется в history.
- Неактивная SQL 003 создаёт `task_schedule_provenance(taskId, reason)`, reason строго `legacy-interval-unavailable`, taskId — внешний ключ с cascade только от active task. Это server-private state, не поле публичной задачи или plan mode.
- `PrivateSnapshotV2` расширяет публичный snapshot только списком `legacyIntervalUnavailable: string[]`. Strict schema проверяет уникальные UUID, наличие task в снимке и принадлежность project. Undo хранит этот private snapshot. Публичный tree строится явным allowlist и не содержит список.
- Pure `OptionalInput` принимает `unavailableTaskIds?: readonly string[]`. Помеченный лист сохраняет source/status/duration; его real interval, вклад в known coverage и полный summary отсутствуют. Диагностика `LEGACY_INTERVAL_UNAVAILABLE` даёт incomplete, если нет infeasible причины. Известные исходные endpoints и обычные проверки FS остаются; доказанный конфликт приоритетен. Иерархия и known source minima не изменяются. Будущий CPM исключает помеченные листья из real/CPM допуска; математические правила C16 не меняются.
- Frozen responses сохраняют уже рассчитанную unknown-проекцию и диагностику. Replay возвращает её после проверки версии/digest/schema без resolver и пересчёта.
- Private archive получает отдельный kind `resolution`, recordKey = canonical `[context.kind, context.key, taskId]`, originalText = canonical resolution. Это **дополнительная metadata**, а не подмена original source. Причина/outcome и digest переживают clear/delete; исходные project/task и raw history остаются отдельными exact originals. Auth/session не копируются.

## Правила изменения и undo

Task 5 обязан читать и писать маркер вместе с работой внутри общей mutation transaction. Изменение details/status/calendar/edges и restart сохраняют маркер. При `preserveWork` маркер следует за исходной работой в созданного ребёнка; parent не получает её прежний интервал. Удаление task удаляет active marker, но не archive. Undo восстанавливает private snapshot и маркеры атомарно.

Явное присутствие source key (`inputStart`, `inputFinish`, `durationDays`) после успешной scalar/calendar/duration проверки принимает новые source и очищает marker. Даже равные значения требуют повторной `validateSourceInput`: ранее сохранённую невалидную пару нельзя принять побочно. Для исходного done очистка — изменение плана, требующее явного возврата в todo/doing; helper `applyPrivateSourcePatch` проверяет это и для равных значений. Простое открытие done без source key marker не очищает. Поля вне source и отсутствие source key не считаются подтверждением.

## Preview и транзакция

Preview — readonly snapshot БД schema 2: версии, точные project/task/edge строки, operation keys/raw payload/raw response, undo sequence/project/afterRevision/raw snapshot входят в SHA-256 вместе с policy ID. Все записи сортируются детерминированно. Auth/session bytes исключены. Counts — количество task occurrences во всех active/operation/undo contexts; sourceIntervals означает обычную валидную source pair, unavailableHistory — unavailable occurrences вне active; invalid считается один раз на occurrence, FS — число доказанных конфликтующих edges в каждом контексте. Категории могут пересекаться.

`requireOptionalUpgradeApproval` вызывается первым шагом caller-owned IMMEDIATE transaction; вне transaction отказывает. Caller обязан использовать `.immediate()`, helper не начинает и не завершает migration transaction. Отсутствующий/неверный policy возвращает `MIGRATION_APPROVAL_REQUIRED`, устаревший digest — `MIGRATION_PREVIEW_CHANGED`. Перед подготовкой записи перепроверяются на том же locked state. Обычный registry/startup, CLI и Repository ещё не подключены; Task 5 отвечает за этот контракт и не может обходить acknowledgement.

## Проверки и последствия

Синтетические fixtures покрывают valid-source unavailable, null-source unknown, materialized controls, exact context tampering, private schema roundtrip, frozen reply/reopen, archive integrity, undo restore, marker clear guards, известный FS conflict, counts/digests, auth exclusion и rollback всей миграции. Активные undo/preserveWork маршруты принадлежат Task 5; локальное восстановление fixture не заявляется готовым пользовательским маршрутом. SQL digest пересчитан для точного нового DDL. Registry и production execution остаются закрыты до independent review.
