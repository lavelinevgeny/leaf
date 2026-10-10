# Архитектура: простой модульный монолит

C19: [ADR 010](adr/010-conditional-display-today.md) описывает общий чистый display helper и клиентский today fallback. task.create принимает необязательные source поля и валидирует их в одной серверной транзакции; response DTO, SQL, версия 2 и frozen replies сохранены.

## Выбор по умолчанию

Один репозиторий и package.json. React + TypeScript + Vite для SPA; Fastify + TypeScript для HTTP; SQLite через better-sqlite3, небольшие версионированные SQL-миграции. Клиент и API одного origin. Один production-процесс обслуживает `/api` и собранную статику. Два dev-процесса допустимы только ради удобства.

Это инженерная рекомендация. Node 24 — поддерживаемая LTS-линия на дату комплекта; S0 проверяет актуальный patch, совместимость Vite/библиотек, фиксирует версии и lockfile. Источники S04–S07 в SOURCES. Не использовать `latest` в production-образе и не выдавать незапроверенные версии за установленный стек.

CSS Modules + tokens, системный шрифт, точечные доступные primitives. Для server-state допустим TanStack Query при реальной необходимости; для local UI достаточно React state/context. Никакого Redux по привычке. Небольшой SVG-Гант и SVG-схема зависимостей поверх общего набора строк, а не платный scheduling SDK. Drag-and-drop можно реализовать небольшой доступной библиотекой после проверки лицензии/поддержки.

## Целевая структура после S0

```text
src/
  client/                 # app shell, tree, gantt, task-panel, board, styles
  server/                 # HTTP routes, auth, repositories, migrations
  domain/                 # entities, invariants, scheduling, commands
  shared/                 # transport schemas and DTOs; no server secrets
fixtures/                 # only synthetic input
scripts/                  # small repository/dev tools
migrations/               # SQL schema changes, never database dumps
```

Не создавать эти папки с десятками пустых классов «на будущее». Границы важнее количества файлов. Domain не импортирует React, Fastify, sqlite, fs или process.

Для адаптации C16/C17 приняты [ADR 007](adr/007-legacy-scheduling-migration.md) и [ADR 008](adr/008-explicit-date-cpm.md). Task 7 подключает единственный current pure CPM введённых интервалов и отдельные partial results; React отображает серверный outcome без математического пересчёта. Current Repository calculation/tree/schedule/mutation response проходят LIVE-only validators до commit, cached retry использует strict frozen/LIVE union после digest/scope проверки без solver. Invalid internal result даёт safe 500 и transaction rollback. Финальный implementation review/root gate ещё не завершён. Frozen legacy calculator, archive и context-specific resolution остаются server-only compatibility code для однократной миграции/history, не вторым active scheduler. Existing legacy upgrade требует explicit preview/digest acknowledgement перед writes; обычный startup не конвертирует БД молча.

Целевая адаптация исходных сроков и persisted history описана в [спецификации C11–C15](superpowers/specs/2026-10-07-optional-scheduling-design.md); Task 5 подключает schema3, приватный exact archive, durable replay и undo, а также target DTO с необязательными source fields.

## Данные

Таблица ниже сохраняет историческую модель S2–S3 для понимания миграции. Активный Task 5 использует независимые `inputStart`, `inputFinish`, `durationDays` и настройки calendar/timezone; planMode, notBefore, deadline, project.startDate и completed indices исключены из target DTO/active tables. Original legacy values остаются server-only archive. Наличие поля в исторической таблице не означает требование сохранять его в продукте.

| Сущность | Основные поля |
|---|---|
| Project | id, title, archivedAt, startDate?, calendarType, timezone, revision, createdAt, updatedAt |
| Task | id, projectId, parentId?, title, description, sortOrder, status, planMode, durationDays?, inputStart?, inputFinish?, notBefore?, deadline?, previousPlanMode?, createdAt, updatedAt |
| Dependency | id, projectId, predecessorId, successorId; FS implicit in V1 |
| Account/session | один пользователь, passwordHash, opaque server-side session records; только private DB |
| Mutation/undo | inverse command или bounded before-snapshot плюс expectedRevision; не публичная история пользовательских действий |

Computed start/finish/float — производные, не альтернативный пользовательский источник истины. Если кешируются, связать с revision и algorithmVersion. Summary определяется наличием детей, а не ещё одним независимым флагом.

UUID/непрозрачные ID, не названия/пути. Один parent; ограничения projectId, FK и уникальные связи. Параметризованный SQL. Дублирующие названия разрешены. Циклы parent/dependency проверяются в domain. Порядок соседей — простые целые числа с перенумерацией транзакцией; сложные fractional indexes не нужны заранее.

SQLite: FK on, транзакции, осмысленный busy timeout; WAL после проверки условий размещения. База на локальном постоянном томе, не на сетевой папке ради совместной записи. Миграции с версией; перед production-изменением backup. Живую WAL-базу не копировать как одиночный файл, использовать согласованный backup API.

## Журнал задач: активное хранение schema4

[ADR 014](adr/014-task-journal.md) и [спецификация журнала](superpowers/specs/2026-10-10-task-journal-design.md) задают отдельные `journal_entries`, `journal_state` и durable `journal_operations`. Шесть authenticated journal routes возвращают strict DTO с `journalContractVersion: 1`; HTTP contract header остаётся 2. IMMEDIATE CRUD изменяет только записи, отдельную journal revision и replay в одной транзакции, без scheduler, planning revision или planning Undo. Exact retry проверяет canonical payload/session/project, response digest и strict acknowledgement до обращения к текущим rows; старый ответ не переписывается после edit/delete.

Ленты читают обе revisions и keyset page в одной read transaction, сортируют workDate/createdAt/id по убыванию. Cursor bounded 4096 учитывает JSON escaping query; он привязан к проекту, прямой задаче или проектной ленте, нормализованному literal Unicode query, включительным date filters и limit; изменение journal либо planning revision делает cursor устаревшим. Названия для поиска берутся из текущих tasks. API сохраняет оригинальный well-formed Unicode plain text включая NUL; malformed surrogate даёт400, NUL-safe SQL byte-bound 1…30000 дополняет shared validation; лимит тела — 10000 UTF-16 units, timestamps назначает сервер.

Адресный `Repository.save` вставляет новые tasks, обновляет surviving IDs и удаляет только отсутствующие, синхронизируя provenance с validated private snapshot. Он сохраняет FK-записи журнала при обычных плановых правках. Удаляемые записи помещаются в приватный `undo_journal_entries` с обязательным count+SHA256 `undo_journal_manifest` своего bounded snapshot. Новый snapshot имеет lifecycle1, даже с пустым набором; historical lifecycle0 допускает отсутствие sidecar/manifest. Undo проверяет полноту, digest, scope, restored task IDs и active collisions до изменений; более поздние записи задачи, которая исчезла бы при Undo, дают `UNDO_JOURNAL_CONFLICT`409. Restore возвращает точные bytes/IDs/timestamps и сохраняет текущий журнал surviving задач. Task deletion/restore увеличивает journal revision один раз только при непустом наборе записей. Pruning двадцати snapshots очищает sidecar/manifest по FK.

Migration004 аддитивна: historical beforeSnapshot, operation payload/response/digests и migration archive не меняются. Fresh DB проходит 1→2→3→4, schema3 получает только004, schema4 переоткрывается без DDL. Schema2 по-прежнему требует C17 preview acknowledgement перед pragma/DDL. SQLite backup сохраняет active journal/state/replay и private sidecar; будущий S5 export/import пока не реализован. Журнал, его replay и backups остаются private пользовательскими данными; API no-store и safe errors не раскрывают body/query/date/session. Клиентский журнал реализуется отдельным этапом.

## API и изменения

Небольшой REST/JSON. Схемы запросов/ответов валидируются на границе (например, Zod), ограничения длины и размера тела обязательны. Внутренние и транспортные ошибки не раскрывают stack traces и пути.

Предлагаемые endpoints: `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/api/projects`, `/api/projects/:id/tree`, `/api/projects/:id/schedule`, `/api/projects/:id/commands`, `/api/projects/:id/export`, `/api/projects/import`, `/healthz`, `/readyz`. Здоровье не раскрывает список проектов или настройки.

Команда изменения несёт `expectedRevision` и уникальный operationId. Сервер валидирует, меняет модель, пересчитывает и возвращает новую revision + affected tasks/diagnostics в одной транзакции. На устаревшую revision — 409 и предложение обновления, не silent last-write-wins. Даже у одного человека бывают две вкладки.

Идемпотентный повтор operationId не создаёт вторую задачу после сетевого таймаута. Undo — команда обратного действия с проверкой revision; конфликт не должен молча перезаписать более поздние изменения из другой вкладки. В V1 undo после перезапуска не гарантируется. Нельзя ограничиться визуальным откатом React state при изменённой базе.

Для ввода текста — контролируемое debounce + явное состояние saving/saved/error. Для drag — preview в браузере, authoritative commit на сервере после отпускания. Schedule API использует тот же pure module, что preview, либо preview вовсе не делает независимых расчётов.

## Аутентификация и безопасность

Одно локальное имя входа; нет публичной регистрации. Создание пароля интерактивной CLI-командой с вводом без echo и без передачи в аргументах. Нельзя выписывать готовый пароль в README, seed или .env.example. Хеширование стандартной поддерживаемой библиотекой, не собственным алгоритмом; конкретные параметры проверить по OWASP в момент реализации.

Opaque случайная session cookie HttpOnly, SameSite, Secure в HTTPS-режиме, срок жизни и отзыв. Проверка origin/CSRF для мутаций; строгий allowed origin. Rate limit входа и единообразная ошибка неверных данных. Приложение без созданного аккаунта не выдаёт удалённо «захвати первого администратора» и не открывает данные. Production — fail closed.

Нет секретов в клиентских переменных Vite, HTML, source maps или bundled JSON. Runtime auth/DB/storage лежат за пределами static root. Логировать метаданные ошибок и request IDs, не названия задач, описания, тело запроса, cookies или Authorization.

## Экспорт / импорт

Версионированный формат project JSON: структура, порядок, исходные правила дат, связи, календарь. Без account/session/password hash и локальных путей. Экспорт — пользовательские данные, не тестовая фикстура. Импорт ограничен размером, схемой, числом узлов, глубиной обработки; отклоняет циклы и чужие ID. Всё проходит транзакционно. Не десериализовать произвольные классы/HTML; описания plain text или безопасный ограниченный Markdown.

Не разрабатывать универсальную plugin/API-платформу. Внутренние endpoints достаточны для первого релиза.
