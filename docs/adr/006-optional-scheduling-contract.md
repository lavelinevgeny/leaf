# ADR 006 — nullable scheduling contract V2

Дата: 2026-10-07. Статус: техническое решение W05 для поэтапной реализации [плана адаптации](../superpowers/plans/2026-10-07-optional-scheduling.md). В Task 1 целевые модули не подключены к действующему приложению.

Уточнение 2026-10-08: [ADR 010 / C19](010-conditional-display-today.md) расширяет task.create тремя необязательными source полями; omission по-прежнему даёт null. Политики полного интервала, replay и версия 2 сохраняются.

## Контекст и границы решений

[Спецификация](../superpowers/specs/2026-10-07-optional-scheduling-design.md) отделяет C11–C17 от рабочих defaults и технических предложений W01–W06. Этот ADR не превращает W в отдельные решения владельца. W01 допускает только валидные пары дат и сохранено принятой C16 политикой; W06 задаёт exact archive и дополнено принятой C17 конвертацией. W02 (согласованная тройка), W03 (полный summary), W04 (отдельный display) и W05 (версия API и source patch) остаются техническими предложениями реализации в границах подтверждённых требований.

O06/G-CPM и G-MIGRATION **CLOSED как выбор политики** по [нормативному приложению C16/C17](../superpowers/specs/2026-10-07-optional-scheduling-policy-proposal.md). Открыты implementation/review dependencies: Task 4 resolution и preview acknowledgement, Task 5 проверенное переключение registry/API/UI, Task 6 typed CPM annex с двумя независимыми APPROVED и Task 7 реализация CPM. Принятие политики и подготовка контракта не подтверждают эти проверки, production upgrade или готовность V1.

## Решение

- В отдельном `optional-contracts.ts` подготовить strict V2 формы Project, Task, Dependency, Snapshot, ProjectTree, ScheduleResponse, CommandEnvelope и Rename. Active contracts и lockfile сохраняют прежнюю форму до Task 5. При переносе V2 в active contracts убрать импорт primitive schemas из прежнего файла; определения этих primitives остаются прежними.
- Source содержит независимо nullable `inputStart`, `inputFinish`, `durationDays`. Omission в patch сохраняет значение; явный `null` очищает только соответствующее поле. Новый task.create содержит название и структуру; сервер создаёт все три source поля как `null`. Input duration ограничена 1–1 000 000; stored Task duration и производная `calendarSpanDays` этим пределом ввода не ограничены.
- `task.edit` объединяет source patch, текст и статус одной командой. `task.update` меняет только текст/статус. Новые `task.plan`, `deadline`, `planMode`, `notBefore` и `project.schedule.startDate` отклоняются strict schemas. Project сохраняет календарь/timezone, но не содержит startDate. Task не содержит completed dates/indices или migration archive.
- Чистый `applySourcePatch` валидирует source только при изменении его значения. Text/status save и одинаковый source patch не отклоняют сохранённый legacy/calendar-invalid ввод. Новый полный интервал требует рабочих границ, прямого порядка дат и совпадения заданной duration с включительным calendar span. Единственная дата не нормализуется. `realInterval` возвращает только валидную пару либо `null`, не изменяя sources и не бросая при чтении невалидного сохранённого ввода. Диагностика сохранённых конфликтов относится к Task 2.
- Реальные task/summary интервалы и условный `display` — отдельные поля ScheduleResult. До подключения CPM `analysisStatus: 'pending-policy'` означает отсутствие реализации расчёта; floats отсутствуют, critical ID arrays обязаны быть пустыми. Это не выполненный C05. Task 7 расширит schema утверждённым union и сохранит parse исторических pending replies.

## Версия транспорта и canonical body

Project API требует отдельный transport header `X-Leaf-Contract-Version: 2` после auth/origin checks и до project writes, operation/undo records, target DTO или cached response. При отсутствии/неподдерживаемой версии сервер возвращает HTTP 426 через прежний strict error DTO с кодом `CONTRACT_VERSION_CONFLICT` и безопасной просьбой обновить страницу. Auth/session endpoints сохраняют совместимый контракт. Реализация этого boundary относится к Task 5.

Новые command и rename envelopes содержат `contractVersion: 2` **в body**, поэтому версия входит в новую canonical форму вместе с expectedRevision/operationId. Header отдельно обязателен и не заменяет body version. Публичные tree/schedule ответы также содержат `contractVersion: 2`; внутренний Snapshot состоит из project/tasks/dependencies.

Legacy replay передаёт version header и `X-Leaf-Legacy-Replay: 1` с неизменённым исходным body. Legacy body не получает contractVersion; transport headers не меняют archived canonical payload. Replay выполняет только поиск уже применённой операции с совпадающими operationId/project/session/payload. Неизвестная legacy операция не выполняется; изменённый payload того же ID отклоняется. Совместимость archive, undo и exact replay реализуется по [ADR 007](007-legacy-scheduling-migration.md).

Cached outcome сохраняет исходную revision и адаптированную целевую форму, а не актуальный snapshot проекта. Он остаётся **frozen** после restart и внедрения [нового CPM](008-explicit-date-cpm.md): исторический pending response не пересчитывается новой математикой и не создаёт повторную mutation/undo. Client revision guard не заменяет новый snapshot старым replay outcome.

## Проверка и последствия

Независимые synthetic tests Task 1 проверяют восемь nullable сочетаний, N01, omission/null, mismatch, weekend/reversed pairs, input cap и большой производный span, чтение сохранённого invalid source и strict V2 формы. Target модули пока не импортируются действующим API/UI; миграция, transport boundary, display/summary и CPM проверяются последующими tasks. Реальные данные и внешние действия для подготовки контракта не требуются; production execution остаётся за отдельным поручением по [PRIVACY](../PRIVACY.md).
