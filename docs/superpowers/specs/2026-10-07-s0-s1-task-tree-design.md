# S0–S1: запускаемый leaf и сохраняемое дерево

Основание: START_HERE, IMPLEMENTATION_PLAN S0–S1, ARCHITECTURE, UI,
SCHEDULING и DECISIONS. Рабочие defaults остаются defaults. Это описание
реализации первого сквозного сценария, а не готовности V1.

## Границы

Один TypeScript-пакет, React/Vite, Fastify, better-sqlite3. Сохраняем
kit checks и защитные hooks. Strict TypeScript, ESLint, Prettier, Vitest,
React Testing Library и Playwright проверяют настоящее приложение.
Версии проверяются по официальным источникам и registry, закрепляются
точно вместе с lockfile. Ни ORM, ни дополнительный state framework не нужны.

S1 включает создание и выбор проекта, переименование проекта, задачи
с произвольной глубиной, сворачивание, создание соседей/детей, порядок
и перенос веток, три статуса, описание, необязательные входные даты,
удаление ветки и серверную отмену. Перезапуск сохраняет данные.
Расчёт расписания, длительности, Гант, связи и доска — этапы S2–S4;
их элементы не показываются как работающие функции S1.

## Контракты и хранение

`Project`: id, title, revision, createdAt, updatedAt. Идентификаторы UUID.
`Task`: id, projectId, parentId (nullable), title, description, sortOrder,
status (`todo | doing | done`), inputStart/inputFinish (nullable calendar
strings), createdAt, updatedAt. Незаполненные даты остаются null.

`ProjectTree`: project, tasks (плоские записи), canUndo. Сервер возвращает
полный согласованный снимок одной ревизии. Клиент строит visible tree
итеративно; раскрытие не меняет исходные данные. UI-строки по-русски,
идентификаторы по-английски. Даты S1 — сохранённый ввод, не вычисленные сроки.

SQLite хранит миграции, проекты, задачи, локальную учётную запись,
сессии и команды. Включены FK, busy timeout и WAL. Изменения выполняются
одним writer в транзакциях, без SQL, построенного из пользовательских строк.

`GET /api/projects`, `POST /api/projects` ({title}),
`PATCH /api/projects/:id` ({title, expectedRevision, operationId}),
`GET /api/projects/:id/tree`, `POST /api/projects/:id/commands`.
Команда имеет `expectedRevision`, `operationId` и `command`. Поля команд:

- `task.create`: title, parentId, optional afterId, optional preserveWork;
- `task.update`: taskId, changes (title/description/status/inputStart/inputFinish);
- `task.move`: taskId, parentId, position, optional preserveWork;
- `task.delete`: taskId (включая потомков);
- `undo`: отмена последней команды текущей сессии для этого проекта.

Результат команды — ProjectTree. Повтор operationId с тем же payload
возвращает сохранённый результат без второго применения; другой payload
с тем же ID отклоняется. Устаревшая ревизия — 409 без изменения БД.
Undo использует before-snapshot и проверку актуальной ревизии; не затирает
более поздние изменения другой сессии. Подтверждённый успех повышает revision.
Перенумерация соседей, перенос и удаление транзакционны. Ошибка цикла,
чужого родителя, неправильной даты/названия не изменяет проект.

Если первый ребёнок добавляется к работе с входными датами,
нужно подтверждение `preserveWork`; собственная работа с датами и статусом
переносится в отдельного work-child, родитель теряет собственные даты.
Summary определяется детьми; его даты не редактируются. При удалении
последнего ребёнка он остаётся незапланированной задачей. Связей в S1 нет.

## Локальный вход и runtime

`/healthz` и `/readyz` не выдают сведения о проектах. Без аккаунта доступ
к данным закрыт, удалённого setup нет. `admin:setup` требует интерактивный
TTY, вводит и подтверждает пароль без echo, не принимает пароль из args/env.
Сервер использует Node crypto scrypt с OWASP-параметрами N=131072, r=8,
p=1 и уникальной солью; password/session values не логируются.
Opaque HttpOnly SameSite cookie, Secure при HTTPS; срок и logout/revocation.
Мутации требуют точного configured origin и JSON; вход ограничен по частоте.
Ошибки содержат безопасный code/message, без stack, SQL или локальных путей.

Dev и production defaults привязаны к loopback. Runtime-каталог задаётся
LEAF_DATA_DIR и должен находиться вне agent checkout. Тесты используют
только созданные ими временные synthetic DB и автоматически очищают их.
Один production-процесс обслуживает API и SPA, graceful shutdown закрывает БД.
Docker/Compose создаются с allowlist context и non-root process; image не публикуется.

## UI и приёмка S1

Используются только три PNG из design/README, без исключённого коллажа.
Светлый sidebar с проектами, воздушное дерево, компактная правая панель
около 380 px. Системный шрифт и CSS tokens; никаких CDN. Нет dummy bars.
Клавиатура: выбор/раскрытие дерева стрелками, Enter открывает задачу,
Tab/Shift+Tab меняют уровень только в активном редакторе быстрого ввода,
Esc закрывает панель с возвратом фокуса. Есть кнопки переноса/порядка как
клавиатурная альтернатива drag-and-drop. Подзадачи переиспользуют дерево.
Изменения панели сохраняются с подтверждением сервера; dirty/saving/error
различимы. Неподтверждённые поля не теряются при ошибке или смене выбора.

Проверки: domain циклы/даты/40 уровней; реальная SQLite после reopen;
API auth/origin/schema/revision/idempotency/undo/rollback; React
empty/loading/error/keyboard; E2E создание, вложенность, редактирование,
перенос, отмена, reload и реальный перезапуск сервера. Synthetic visual
smoke при 1440×900 и 1280×800. `verify`: typecheck + lint + app tests + build.
Kit/privacy проверки запускаются отдельно. Docker smoke выполняется
только если доступен daemon; отсутствие честно фиксируется.
