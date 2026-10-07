# Статус разработки

## Текущее состояние

2026-10-07: подтверждены [C11–C15](DECISIONS.md): исключён общий сценарий автоматического назначения сроков от начала проекта; начало, окончание и длительность задачи необязательны, отдельный дедлайн не нужен. Для подзадач без начала предусмотрена приглушённая полоса от минимальной известной даты с указанной длительностью или одним днём для отображения. Неопределимые сводные сроки не показываются. Требования обновлены, реализация S2–S3 пока использует прежние defaults Auto/partial summary/deadline и не соответствует этому уточнению.

S0–S3 реализованы. Дерево и SVG-Гант используют один набор видимых строк и одну вертикальную прокрутку. Панель редактирует режим/длительность/ограничения, проект задаёт начало/календарь/часовой пояс. Выбранная схема показывает непосредственных соседей и отдельные реальные FS-рёбра. Сервер остаётся единственным источником расчёта; task.edit сохраняет текст, статус и план одной транзакцией и одной отменой.

Задачи без дат не получают полос; одиночные даты — пометки. Критичность отделена от статуса; coverage, partial, incomplete, fixed/done conflicts и дедлайн видны. Три утверждённых референса просмотрены; исключённый коллаж не используется. Только синтетические тестовые данные, пользовательский runtime не открывался.

Это ещё не готовая V1: S4 повседневный UX/доска, S5 restore/import/export и S6 приёмка остаются впереди. Зависимости, lockfile, схема БД, Git identity review и scanner policy не менялись в S3. Внешняя публикация и deployment не выполнялись.

| Этап | Статус |
|---|---|
| S0: репозиторий и исполняемый фундамент | Реализован и проверен |
| S1: дерево, панель, SQLite CRUD | Реализован и проверен; browser/restart scenarios проходят |
| S2: scheduling module и транзакции | Реализован, интегрирован и проверен: verify 186/186, browser E2E 12/12 и итоговый preflight прошли |
| S3: Гант, редактор плана и схема зависимостей | Реализован и проверен: verify 206/206, browser E2E 18/18; ограничения ниже |
| S4: повседневный UX и доска | Не начат |
| S5: self-hosting и сохранность данных | Есть Docker/Compose, consistent backup и проверка synthetic migration 001 → 002; restore/import/export и полноценный upgrade не реализованы |
| S6: релизная приёмка | Не начат |

## Следующая задача

Сначала адаптировать планирование к C11–C15: необязательные даты/длительность, отсутствие общего сценария Auto от начала проекта и отдельного дедлайна, приглушённые полосы подзадач без начала и скрытие неопределимых сводных сроков. Уточнить O06 (критический путь по явным датам), подготовить совместимое изменение API/хранения и независимые тесты; не терять существующие данные. Затем выполнить S4: поиск/фильтры с родительским контекстом, повседневный UX и иерархическая доска. Дизайн доски остаётся рабочим предложением и требует отдельной визуальной проверки владельцем. Далее S5 restore/import/export и S6 релизная приёмка. Перед внешней публикацией отдельно нужны поручение владельца, проверка remote CI/серверной защиты и решение о лицензии.

## Исключение отдельного дедлайна — 2026-10-07

Зафиксировано подтверждённое решение C15: отдельный дедлайн не нужен; необязательная дата окончания сохраняется. Согласованы DECISIONS, SCHEDULING, UI, ACCEPTANCE (A16), ARCHITECTURE, START_HERE, AGENTS и этот журнал. Прежние deadline-поля в описании реализованной модели и историческом scheduler-контракте явно обозначены как требующие адаптации.

Код, API, схема БД и сохранённые данные не изменялись; поле пока остаётся в приложении. Application tests и E2E не запускались, поскольку изменение только документационное. Следующий шаг — исключить deadline при совместимой адаптации планирования к C11–C15.

Проверено: `npm run check:kit` — прошло (35 Markdown files, 75 local links, три утверждённых references, 10 CPM и четыре calendar examples); `git diff --check` — прошло. Эти проверки документации не подтверждают удаление поля из приложения.

## Уточнение модели сроков — 2026-10-07

Изменённые области: DECISIONS, SCHEDULING, UI, START_HERE, AGENTS и этот журнал. Зафиксированы подтверждённые правила C11–C14; прежний scheduler-контракт явно отделён от целевых требований. Уточнение владельца возвращает необязательную длительность и допускает приглушённые полосы подзадач без начала. D13 отдельно обозначает рабочие границы отображения: реальные пары дат определяют полосу, без точки привязки приглушённая полоса не рисуется, визуальные значения не сохраняются и не входят в сводный расчёт/CPM. Критический путь и визуальные зависимости не отменены; адаптация расчёта отмечена O06.

Код, схема БД, fixtures и пользовательский runtime не изменялись. Application tests и E2E не запускались: поведение приложения этим документальным уточнением не меняется. Следующая задача — согласовать расчёт по явным датам и реализовать адаптацию.

Проверено: `npm run check:kit` — прошло (35 Markdown files, 74 local links, три утверждённых references, 10 CPM и четыре calendar examples); `git diff --check` — прошло. Эти проверки документации не подтверждают соответствие приложения новым требованиям.

## S3 — 2026-10-07

Изменённые области: client Gantt/TaskTimeline, общая геометрия и календарные intent helpers, PlanFields/ProjectPlan/ScheduleStatus, Dependencies, TaskPanel/App/tree labels/styles; shared task.edit contract и Repository command composition; independent unit/client/API/SQLite fixtures и браузерные сценарии. [Спецификация](superpowers/specs/2026-10-07-s3-planning-ui-design.md), [план](superpowers/plans/2026-10-07-s3-planning-ui.md) и [ADR 005](adr/005-planning-ui.md) описывают реализацию существующих требований и defaults.

Гант поддерживает дни/недели/месяцы, today по часовому поясу проекта, отдельную горизонтальную прокрутку, клавиатурный и pointer-разделитель, обычные/сводные полосы, пометки и реальные FS-стрелки между видимыми работами. Видимое окно ограничено 90/180/366 днями; большие допустимые длительности не создают миллионы SVG-элементов. Collapse меняет только общие строки отображения. Прямые зависимости не подменяются связями родителей.

Pointer drag/resize сохраняет ровно одну команду на отпускание, Escape отменяет preview. Auto move задаёт notBefore, resize — длительность; допустимость FS и CPM пересчитывает сервер. Fixed границы не нормализуются молча; done и summary заблокированы для жестов. Клавиатура и поля дают альтернативу. Детали+план сохраняются одной task.edit; перед планированием done требуется явное изменение статуса. Недопустимый Fixed откатывает также текст и историю операций. Потерянный ответ сохраняет черновик и тот же envelope для повтора.

Граф показывает до четырёх соседей на секцию с «Показать ещё», критическую связь с текстом и отдельную стрелку на каждое ребро. Допустимые кандидаты фильтруются общим domain validator; цикл объясняется названиями. Удаляется связь; переход заменяет выбранную задачу, доступен возврат. «Показать на Ганте» раскрывает предков и нужный период. Компактные даты дополняются полными ISO-датами в accessible labels и tooltip.

Проверено на закреплённых Node 24.21.0 / npm 11.19.0 без изменения глобальной конфигурации:

- `npm run verify` — прошёл: typecheck, lint, 206/206 application tests в 17 suites, skipped 0, production client/server build.
- `npm run test:e2e` — прошёл: 18/18 Chromium scenarios на 1440×900 и 1280×800, retries/skipped 0. Реальный UI проверяет T=8 → T=10 → одну отмену, смену критической ветви, summary, граф, cycle explanation, drag/resize/cancel, keyboard/divider, Fixed/Auto, deadline, unknown и done locks. Перезапуск сохраняет план. На длинном синтетическом списке после вертикальной прокрутки координаты строки и Ганта совпадают; бездатные строки остаются пустыми.
- Синтетические снимки главного окна, деталей и графа на обоих viewport — все шесть открыты и просмотрены. Компактная панель, лёгкое дерево/Гант и отдельные стрелки соответствуют характеру трёх референсов. PNG не добавлялись в репозиторий.
- `npm run format:check`, `npm run check:package`, `npm run check:kit` и `git diff --check` — прошли. Kit проверил 35 Markdown files / 69 local links, три references и независимые numerical fixtures.
- Новые тесты сначала воспроизводили отсутствие task.edit/UI; после реализации прошли. Regression exact retry подтверждает сохранение планового черновика и исходного operationId после потерянного ответа. Graph pagination сохраняет текущую карточку и оставшихся соседей после удаления последнего элемента страницы.
- `npm run preflight` — прошёл: doctor, kit, 52/52 real-Gitleaks/hook tests без пропусков, public workspace guard и Gitleaks, index guard, staged configuration и history/metadata guard+Gitleaks. До staging S3 workspace содержал 155 entries; index 136 entries; история 232 file versions / 14 metadata objects. Подготовленные blobs проверяются отдельно перед коммитом.

Не выполнены в S3: повторный Docker build/smoke, AMD64/HTTPS/remote CI, performance acceptance целевого размера, restore/import/export и S6. Существующая контейнерная проверка S2 не выдаётся за новый S3 smoke. Синтетические snapshots остаются вне checkout и не добавляются в public asset manifest. V1 не объявляется готовой.


## S2 — 2026-10-07

Изменённые области: чистые calendar/scheduling/planning domain modules, shared DTO и команды, SQLite migration 002, Repository snapshots/transactions/undo, API расписания, точная упаковка миграций и тестовые fixtures. [План](superpowers/plans/2026-10-07-s2-scheduling.md) и [ADR 004](adr/004-scheduling-transactions.md) фиксируют реализацию существующих рабочих defaults без превращения их в решения владельца.

Поддержаны Unscheduled/Auto/Fixed, оба календаря, исходные даты, notBefore, deadline, ограничения фиксированных и выполненных работ, coverage и partial summary. Неизвестные связанные работы блокируют downstream; циклы, повторные/межпроектные рёбра и summary endpoints отклоняются до сохранения. Конверсия листа в summary переносит работу и оба конца зависимостей в work-child. Удаление убирает инцидентные связи, одна отмена восстанавливает весь план. Ответы проверяются Zod до commit; некорректный внутренний DTO даёт безопасный 500 и полный rollback. Миграция сохраняет исходные задачи/аккаунт/даты, очищая несовместимый старый формат undo/operations.

Существующая правая панель совместима с scheduled tasks: сохранение названия с неизменными датами не меняет план. Параметры планирования и зависимости пока доступны через API; интерфейс их редактирования относится к S3. Проверен расчёт T=8 → T=10 со сменой критического пути, возврат T=8 одной отменой и сохранность после настоящего перезапуска.

Закрыты два review findings: отсутствующий origin при deadline у unscheduled task и валидация исходящего ответа до commit. Scoped re-review обеих правок прошли. Полный verify также закрывает предыдущую волну admin/auth: readline/promises сохраняет редактирование скрытого пароля при TERM=dumb; три проверки TERM и существующие синтетические reset/login scenarios проходят. Dev smoke использует собственные два порта; обычный Vite default 5173 сохранён.

Проверено на закреплённых Node 24.21.0 / npm 11.19.0 без изменения глобального окружения:

- `npm run verify` — прошёл: typecheck, lint, 186/186 application tests в 13 suites, skipped 0, production client/server build.
- `npm run format:check`, `npm run check:package`, `git diff --check` — прошли.
- `npm run test:e2e` — прошёл после переноса в основной checkout: 12/12 Chromium scenarios на 1440×900 и 1280×800, retries/skipped 0. Проверены планирование, отмена, сохранность после перезапуска, подтверждение/отмена преобразования работы и перенос обоих концов зависимостей.
- Docker build и synthetic smoke — прошли на ARM64: migration 002, native SQLite, FS даты, undo, WAL backup, non-root/read-only, graceful stop/restart persistence. Все 37 production inputs основного checkout совпадают с проверенной сборкой; после переноса Docker checks не повторялись.
- Полный публичный source snapshot — privacy guard проверил 136 entries; реальный Gitleaks не нашёл утечек. Guard и scanner policy не менялись.
- Финальное независимое review выявило один P2: клиентское подтверждение сохранения работы не учитывало undated done/Auto/deadline/связи. Общий чистый predicate синхронизировал клиент и сервер. 16 регрессий проверяют создание/перенос, подтверждение/отмену и пустые/сводные цели; реальный браузерный сценарий проверяет перенос работы и обоих концов связей. Scoped re-review закрыл P2; новых замечаний нет.
- После переноса основной checkout прошёл `npm run verify` с 186/186 tests, typecheck, lint и build; `format:check`, `check:package` и `git diff --check` прошли. До переноса S0/S1 verify также проходил с 102/102 tests.
- Root `npm run preflight` после переноса — прошёл: doctor, kit (32 Markdown / 62 links), 52/52 real-Gitleaks/hook tests, workspace (137 entries), index (119 entries), staged (0 changed blobs), history (189 file versions / 13 metadata objects) и Gitleaks. Index не менялся.

Только disposable synthetic SQLite, аккаунты, задачи и container volume. Production/private данные не читались, index не менялся, commits/push/deployment не выполнялись. Не выполнены: S3 UI, S6 acceptance, remote CI, AMD64 smoke, HTTPS reverse proxy, restore/import/export и полный upgrade/restore процесс.

## Восстановление локального входа — 2026-10-07

В исходном CLI на отдельной синтетической базе воспроизведено попадание служебных байтов стрелок и bracketed paste в пароль: setup проходил, ожидаемый пароль получал `INVALID_LOGIN`. Обычный ввод, Unicode и Backspace работали. `readPassword` переведён на Node readline с отключённой историей и заглушённым выводом; добавлены проверки редактирования, разорванных последовательностей клавиш, повторных запросов, отмены, EOF и ограничения длины.

Добавлены `npm run admin:reset-password` и `make admin-reset-password` (с предварительной сборкой). Локальный TTY и двукратный скрытый ввод обязательны. Новый хеш, отзыв всех сеансов и очистка истории отмены фиксируются атомарно; проекты, задачи и ревизии сохраняются. Повторная проверка хеша внутри транзакции login не позволяет входу, начатому до reset, выдать сеанс по старому паролю. HTTP endpoint восстановления отсутствует. Решение описано в ADR 003; обновлены README и DEPLOYMENT. Схема БД, зависимости, lockfile и scanner policy не менялись.

Проверено:

- `npm run typecheck`, `npm run lint` — прошли.
- `npm test -- tests/domain.test.ts tests/admin.test.ts tests/client tests/repository.test.ts tests/api.test.ts tests/runtime.test.ts tests/backup.test.ts` — 98/98 tests в 7 suites, skipped 0. Проверены сохранность задач, отзыв сеансов, старый/новый пароль, rollback, гонка login/reset и отказ CLI без TTY или с аргументом пароля.
- `make test-e2e` — production build и 8/8 browser scenarios прошли.
- Реальный disposable PTY с собранным CLI — setup и вход прошли для обычного ввода, Unicode, Backspace, стрелок и bracketed paste. Настоящий `make admin-reset-password` прошёл: несовпадающее подтверждение сохраняет старый пароль, успешное подтверждение меняет пароль, символы пароля не выводятся.
- `make format-check`, `make check-kit`, `make check-package`, `make security-workspace`, `git diff --check` — прошли.

Не запускались: `tests/dev.test.ts` и полный `verify` (порт 5173 занят существующим dev-сервером), Docker smoke и preflight. Версии среды остаются указанными в записи Make-команд. Пользовательские пароли и базы не открывались и не менялись; причина конкретного отказа входа не подтверждена. Следующий продуктовый этап — S2.

## Подсказка первого входа — 2026-10-07

Обновлён текст setup-required в `src/client/strings.ts`: причина отсутствия формы входа, локальная команда `make admin-setup` из каталога проекта, отдельная команда Docker Compose и указание задать пароль и обновить страницу. Существующий клиентский тест теперь ожидает Make-команду. Логика входа и CLI не менялись; пользовательский runtime не открывался.

Проверено: `make verify` (typecheck, lint, 84/84 tests и build), `make format-check`, `make check-kit`, `git diff --check` — прошли. Для этой текстовой правки browser E2E и preflight не повторялись; ограничение версии Node из записи Make-команд сохраняется. Следующий продуктовый этап — S2.

## Make-команды — 2026-10-07

Добавлен корневой Makefile со справкой по умолчанию и командами установки, запуска, сборки, тестов, настройки аккаунта, миграций, backup и kit/privacy проверок. Рецепты вызывают существующие npm-скрипты. Make задаёт внешний каталог разработки по умолчанию и сохраняет приоритет явного `LEAF_DATA_DIR`; `db-backup` требует `BACKUP` и передаёт путь одним аргументом; `test-e2e` сначала выполняет build. Обновлены README и BOOTSTRAP. Код приложения, зависимости, схема и security policy не менялись.

Проверено:

- `make help` и dry-run основных команд — прошли. Отдельный disposable smoke без настоящего npm/runtime проверил безопасную команду по умолчанию, default/env/CLI выбор каталога, backup с пробелами и shell-разделителем в имени, отказ без пути и последовательность build → E2E при `-j4`, включая остановку после ошибки сборки.
- `make verify` — прошли typecheck, lint, 84/84 tests в 7 suites и production build.
- `make test-e2e` — сборка и 8/8 Chromium scenarios прошли, retries/skipped 0; только синтетические данные.
- `make check-kit`, `make format-check`, `make check-package`, `make security-workspace`, `git diff --check` — прошли.

Ограничение среды: в текущем терминале Node 24.19.0 / npm 11.17.0 / GNU Make 4.3. `npm run doctor` не прошёл exact Node check: проект требует Node 24.21.0; остальные проверки doctor прошли. Результаты этой волны получены на текущих версиях и не заменяют проверку закреплённой среды. Полный preflight не повторялся. Установка пакетов/браузера/хуков и команды аккаунта/БД через Make проверены без реального выполнения; существующий runtime не открывался. Следующий продуктовый этап — S2.

## S0–S1 — 2026-10-07

Изменённые области: строгая TypeScript/tooling среда и exact lockfile, shared/domain/API/storage/auth/runtime/CLI, клиент и HTTP tests, browser harness, Docker/Compose, application CI, README/BOOTSTRAP/DEPLOYMENT и план реализации. S1 реализован в рамках утверждённого spec. API защищает JSON/origin, ревизии, idempotency, rollback и undo; local setup скрывает пароль. Runtime storage и все synthetic DB находятся вне checkout.

Добавлены реальные browser сценарии для создания проекта/дерева, ввода/очистки дат, статуса/описания, collapse/keyboard/move, удаления ветки/undo, reload и actual process restart. Проверены отказы foreign/missing origin и потерянный ответ после реального committed save: черновик/ошибка видимы, точный retry не применяет команду повторно. При 1024 и 990 px child/sibling action раскрывает доступный быстрый ввод; ниже breakpoint исправлено перекрытие редактора чистой панелью. Dirty-panel protection сохранена.

Локальный dev smoke проверяет custom server port, Vite proxy, browser origin и graceful shutdown обоих дочерних процессов. Native backup тестирует committed WAL при открытом writer, integrity, права 0600/0700 и отказ overwrite/symlink/checkout destination. Контейнерный smoke использует только новый synthetic named volume: non-root, read-only filesystem, loopback, healthcheck, static-root isolation, real SQLite write, CLI setup/backup, SIGTERM exit 0 и restart persistence. Контейнер и его том удалены после smoke.

| Проверка | Результат |
|---|---|
| `npm ci --strict-allow-scripts --no-audit --no-fund` | Прошло по exact lockfile, 273 packages. |
| `npm run verify` | Прошло: typecheck, lint, 76/76 tests в 7 suites и production client/server build. |
| `npm run format:check` / `npm run check:package` | Прошло. |
| `npm run test:e2e` | Прошло: 6/6 Chromium scenarios на 1440×900 и 1280×800, без skipped/retries; narrow actions также при 1024 и 990 px. |
| Синтетические screenshots | Оба открыты и просмотрены; header bounds внутри viewport, дерево/панель читаемы. Approved asset manifest не менялся. |
| `npm run check:kit` / `npm run test:kit` | Прошло: 29 Markdown files, 51 local links, три references; 52/52 real-scanner/hook tests, skipped 0. |
| `npm audit` и `npm audit --omit=dev` | Прошло: 0 vulnerabilities при moderate threshold. |
| Docker build / Compose config / runtime smoke | Прошло на Linux ARM64, including real native SQLite/CLI/health/restart. |
| `git diff --check`, staged diff, `security:staged` / `security:history` | Прошло: 27 changed index blobs; история и metadata также прошли guard/Gitleaks. |
| `npm run preflight` после интеграции | Прошло в обычном checkout на `0e97e22`, Node 24.21.0 / npm 11.19.0: doctor, kit, workspace, index, staged, history/metadata и Gitleaks; 52/52 kit tests, skipped 0; 119 index entries, 178 historical file versions, 10 metadata objects. |
| Финальный whole-branch review | Выполнен; найденный дефект быстрого ввода и два замечания к harness исправлены отдельной волной и закрыты scoped re-review без новых Critical/Important или out-of-scope findings. |

Историческое ограничение Task 3 worker: linked-worktree guard отклонял корневой `.git` pointer по PERSONAL_HOME_PATH; policy не менялась, preflight в worktree не запускался. Preflight исходной интеграции выполнен основным агентом в обычном checkout на `0e97e22` и прошёл полностью; после review fixes новый полный preflight также прошёл на `020f3d4`.

Не выполнены: remote CI execution, AMD64 container smoke, HTTPS reverse proxy, restore/import/export, previous-schema upgrade, scheduling/Gantt/dependencies/CPM, S6 acceptance. Browser snapshots только синтетические и вне публичных assets; traces/video и CI uploads отсутствуют. Документация не содержит raw reports, runtime данных или личных путей.

## S0–S1 — исправления финального review, 2026-10-07

Исправлен quick-add после удаления, undo и переноса задач: общий `apply()` проверяет ссылки только принятого снимка текущего проекта после revision guard. Исчезнувший родитель возвращает контекст к корню проекта, исчезнувший или перенесённый якорь удаляется. Текст и допустимые parent/anchor сохраняются; per-project drafts, dirty guards, conflict recovery и точный retry не меняют контрактов. Новые независимые HTTP fixtures проверяют удаление единственного корня, undo создания, исчезновение родителя при delete/undo, перенос/удаление якоря, сохранение допустимого контекста и отказ старого conflict snapshot с последующим свежим reload.

Readiness fetch реального E2E-процесса ограничен AbortSignal timeout. Cleanup охватывает весь lifecycle после создания собственного временного каталога, включая setup БД/аккаунта и резервирование порта. БД и listeners закрываются, завершение процесса ожидается даже после SIGKILL; удаление собственного synthetic runtime выполняется в finally при ошибках остановки. Dev smoke использует ту же раннюю границу cleanup. Схема, серверная семантика, lockfile, security policy и зависимости не изменены.

| Проверка этой волны | Результат |
|---|---|
| RED на исходном коде | 6 новых клиентских регрессий упали, 26/32 прошли; настоящий Chromium delete→create regression также упал. |
| Focused GREEN | 34/34: 33 React cases и один real dev-process smoke. |
| Финальный `npm run verify` | Прошло: typecheck, lint, 84/84 tests в 7 suites, production client/server build; skipped 0. |
| `npm run format:check`, `git diff --check` | Прошло. |
| `npm run test:e2e` | Прошло: 8/8, 1440×900 и 1280×800, retries/skipped 0; delete→create с подтверждением и сохранением после browser reload. |
| Внешние synthetic probes | Прошло: ранний account setup failure и реальный nonzero child/stop failure оставляют собственный runtime очищенным; TCP listener без HTTP headers вызывает timeout, затем readiness реального процесса проходит. |
| Scoped re-review исправлений | Прошло: I1/M1/M2 закрыты; новых Critical/Important и out-of-scope findings нет. |
| Новый root `npm run preflight` | Прошло в обычном checkout на `020f3d465bfcd57cc7db01361fec00c48c914eb4`, Node 24.21.0 / npm 11.19.0: doctor, kit (29 Markdown / 51 links), 52/52 real-scanner kit tests, skipped 0, workspace/index (119 entries), history (187 file versions / 12 metadata objects), guard/Gitleaks. Full preflight в linked worktree не запускался и policy не ослаблялась. |

Предыдущие audit и Docker/native backup результаты выше не повторялись для этой ограниченной волны. Kit suite повторён основным агентом в новом root preflight после интеграции исправлений. Remote CI, другие архитектуры контейнера, HTTPS proxy, restore/import/export/upgrade и S2/S3 по-прежнему не проверены заново. Следующая продуктовая задача — S2; контрольный scoped review и root preflight завершены.

## REPO-INIT — 2026-10-06

Результат: локальный репозиторий и защитные хуки подготовлены по START_HERE, BOOTSTRAP и PRIVACY. Изменённые области: файлы комплекта в корне, executable bits обоих хуков, этот отчёт; Git-конфигурация только локальная. Remote не задан; публикация, push и deployment не выполнялись.

Среда проверок: Node **v24.19.0**, npm **11.17.0**, Git **2.43.0**. Установлен Gitleaks **8.30.1** из официального release; SHA-256 архива и checksum manifest сверены с digest release assets. Исполняемый файл находится вне репозитория.

| Проверка | Результат |
|---|---|
| Распаковка | Все файлы (51) сверены с исходным архивом; дополнительной вложенной папки нет. |
| `npm run check:kit` | Прошло: 24 Markdown-документа, 39 ссылок, 3 референса, 10 CPM и 4 календарных примера. |
| `npm run test:kit` | Все 14 тестов прошли; пропущенных нет. |
| `npm run security:workspace` | 51 файл проверен; находок по реализованным правилам нет. |
| `npm run hooks:install` | Установлены pre-commit и pre-push; executable bits восстановлены после ZIP. |
| Git ignore | 14 синтетических приватных путей игнорируются; 4 необходимых публичных пути разрешены. |
| Референсы PNG | Все три просмотрены; текстовые/EXIF chunks и данные после IEND отсутствуют. |
| `git diff --cached --check` | Прошло. |
| `npm run security:staged` | Privacy guard и Gitleaks прошли; pre-commit также выполнил обе проверки. |
| `npm run security:history` | Tracked/history guard и Gitleaks прошли после начального коммита. |

Не выполнены проверки приложения, сборка, браузерные E2E и Docker: соответствующего кода ещё нет. Удалённый CI и серверная защита Git не проверялись. Сканеры не заменяют ручной privacy-review перед публикацией. Инициализация репозитория не означает завершение S0 или готовность leaf V1.

## REPO-AUDIT — 2026-10-06

Результат: проверены инструкции Codex/Claude Code, служебные проверки, Git hooks, CI и границы защиты публикации. Общая политика и импорт `@AGENTS.md` соответствуют актуальным форматам; проект имеет работающую часть harness для проверки комплекта, но ещё не имеет исполняемого приложения и проверок поведения агентов. Изменён только этот журнал; исправления защитных механизмов не выполнялись.

Проверено в текущем клоне:

- `npm run check:kit` — прошло: 24 Markdown-документа, 39 ссылок, 3 референса, 10 CPM и 4 календарных примера.
- `npm run test:kit` — 14/14 прошли, без пропусков.
- `npm run security:workspace` — 51 файл, находок по реализованным правилам нет; перед запуском проверено отсутствие приватных путей без чтения их содержимого.
- `npm run security:staged` — прошло на пустом индексе изменений; это не проверка нового содержимого.
- `npm run security:history` — прошло: 51 текущая запись, 52 исторических варианта, Gitleaks 8.30.1 проверил 2 коммита.
- Подтверждены `core.hooksPath=.githooks` и executable bits обоих хуков; настройки не изменялись.

В отдельных временных репозиториях с синтетическими данными воспроизведены ограничения:

1. Токен в сообщениях коммита и аннотированного тега не обнаруживается history guard/Gitleaks. Положительный контроль: тот же синтетический токен в staged/committed файле блокируется Gitleaks; значение не выводится.
2. Корректный PDF, состоящий из ASCII-байтов, проходит guard без записи в public-assets manifest.
3. Сохранение старого одобренного хеша для изменённого asset, требуемое PRIVACY, приводит к отказу `check:kit`, который сравнивает каждый исторический хеш с текущим файлом.
4. Workspace guard читает содержимое запрещённого файла перед сообщением об отказе. Проверено только на синтетическом `.env.audit`; реальные приватные файлы не читались.

По конфигурации: `.claude/settings.json` не включает sandbox; Read deny не покрывает все варианты `.env.*`, uploads/logs и не заменяет изоляцию subprocess. START_HERE безусловно направляет агента к S0 и широкому чтению документации, хотя для аудита или узкой правки нужен только контекст задачи.

Не проверено: удалённый CI, серверные push protection/rulesets, загрузка инструкций в отдельной сессии Claude Code, application tests/build/E2E/Docker. Временные синтетические репозитории удалены; публикации и изменения remote не выполнялись.

Рекомендуемая следующая задача: исправить проверку Git metadata, запрет чтения приватных workspace-путей, классификацию assets и совместимость текущих/исторических хешей; закрепить эти случаи регрессионными тестами. Затем добавить проверяемый безопасный профиль запуска агентов и единый preflight; переход к S0 остаётся продуктовой задачей из плана.

## HARNESS-HARDENING — 2026-10-06

Результат: реализованы рекомендованные локальные изменения обвязки и закрыты четыре воспроизведённых пробела публикации. Приложение leaf не создавалось; S0 остаётся отдельной задачей. Изменённые области: privacy guard, Gitleaks wrapper, asset manifest v2, Git hooks, doctor/preflight, CI, инструкции и профили агентов, синтетические тесты и сценарии, ADR 001.

- History guard и Gitleaks проверяют commit/tag metadata, включая вложенные annotated tags; вывод ограничен правилами, object IDs и безопасными итогами.
- PDF, изображения, документы и архивы требуют approval независимо от текстовой кодировки. Текущие и исторические approvals разделены; исходные три PNG не менялись.
- Приватные workspace-пути отклоняются до чтения файлов и обхода каталогов; manifest/assets не читаются через symlink.
- Добавлен и установлен `commit-msg`; installer сохраняет конфликтующие hooks. Integration tests проверяют реальные хуки, положительные/отрицательные контроли Gitleaks, отсутствие scanner и подавление значений находок.
- `doctor` проверяет среду и конфигурацию, `preflight` объединяет проверки public workspace, index, истории и metadata без изменения index. CI использует тот же набор после установки Gitleaks.
- START_HERE следует текущей задаче. Claude settings включают sandbox с отказом при недоступности и расширенными private read rules. Codex получил credential-free permission profile, disposable OS probe и launcher, который отказывает при неуспешной проверке песочницы. Пять model smoke scenarios заданы как критерии, а не как пройденные model evals.

| Проверка | Результат |
|---|---|
| `npm run test:kit` | Прошло: 35/35, без пропусков; используется настоящий Gitleaks. |
| `npm run check:kit` | Прошло: 26 Markdown-документов, 46 ссылок, 3 референса, 10 CPM и 4 календарных примера; 5 agent scenarios проверены только как данные. |
| `npm run doctor` | Прошло: 10 проверок конфигурации и инструментов. Это не проверка активного sandbox. |
| Workspace guard и Gitleaks | Прошло на публичном рабочем дереве, включая новые незакоммиченные файлы; находок по покрываемым правилам нет. |
| `npm run preflight` | Публикация заблокирована: `EMAIL_REVIEW_REQUIRED` в metadata двух существующих коммитов. Gitleaks файловой истории и metadata прошёл. |
| `npm run agent:sandbox` | Не прошло: runtime/profile probe завершился отказом. Фактическая изоляция Codex не подтверждена; launcher не разрешает запуск модели. |
| Синтаксис служебных `.mjs`, `git diff --check` | Прошло. |

Значения Git identity не выводились и не добавлялись в policy; история не переписывалась. Для публикации владелец должен решить вопрос публичной identity и разрешить требуемое изменение истории либо узкой политики. Автоматических исключений нет. Это finding персональных данных, а не подтверждение утечки действующего секрета.

Не выполнены: запуск Claude Code, model behavior scenarios, удалённый CI и серверные push protection/rulesets, проверки приложения/build/E2E/Docker. Remote отсутствует; commit, push, публикация и deployment не выполнялись. Sandbox runtime требует отдельного устранения отказа и повторного успешного synthetic probe, без ослабления границ. Затем можно выполнить оставшуюся часть S0 по продуктовому плану.

## SANDBOX-FIX — 2026-10-07

Результат: устранён отказ `agent:sandbox`; изоляция подтверждена реальной пробой на Codex CLI **0.153.0**, Node **24.19.0**, Ubuntu **24.04**. Изменённые области: resolver установленного runtime, генератор permission args, sandbox probe, launcher, Codex profile, doctor, harness tests, AGENT_WORKFLOW/SOURCES и ADR 001.

Причины: native helper Codex находился вне разрешённых системных путей; directory-only globs не закрывали файлы внутри; текущий CLI подавлял stdout sandbox-команды. Исправления: вычисляемые read-only grants только для двух реальных бинарников Node/Codex, отдельные root/nested directory rules и proof-файл с уникальным nonce после всех проверок. Runtime paths остаются в памяти. Credential-store symlinks отвергаются до открытия; неизвестные wrappers не разрешаются. `.codex` сохраняет унаследованную защиту от записи и запрет чтения содержимого без конфликта с mount отсутствующего каталога.

| Проверка | Результат |
|---|---|
| `npm run agent:sandbox` | Прошло: public read/write; отказ private reads в root/nested/hidden directories, `.codex` и вне workspace; отказ synthetic loopback connection. |
| `npm run test:kit` через preflight | Прошло: 41/41, без пропусков. Шесть новых регрессий сначала воспроизведены отказом тестов, затем устранены. Unconfined Node child не проходит probe; exit 0/stdout marker без proof также не проходит. |
| `npm run doctor` | Прошло: 10 проверок конфигурации и инструментов. |
| `npm run check:kit` | Прошло: 26 Markdown-документов, 46 ссылок, 3 референса, 10 CPM и 4 календарных примера. |
| Workspace guard и Gitleaks | Прошло: проверено публичное рабочее дерево, включая незакоммиченные изменения; покрываемых findings нет. |
| `npm run preflight` | Публикация заблокирована прежним `EMAIL_REVIEW_REQUIRED` в metadata двух существующих коммитов. Index guard и Gitleaks истории/metadata прошли. |
| Синтаксис `.mjs`, `git diff --check` | Прошло: все 17 служебных скриптов синтаксически корректны. |

Не выполнены: launcher end-to-end с моделью, model behavior scenarios, Claude runtime, удалённый CI/защита сервера и application checks. Проба подтверждает перечисленные границы в проверенной среде, не универсальный аудит изоляции или PII. Пакеты и системные security settings не менялись. Model/API calls, Git identity changes, rewrite history, commit, push и публикация не выполнялись; временные синтетические fixtures удалены.

Следующий шаг перед внешней публикацией: решение владельца по публичной Git identity. После согласованного исправления metadata/policy повторить preflight и сохранить локальную обвязку. Реализация S0 остаётся отдельной продуктовой задачей.

## PUBLIC-IDENTITY-REVIEW — 2026-10-07

Результат: владелец явно разрешил публикацию существующего Git identity email в соответствующих author/committer fields. Это согласованное исключение устранило прежний блокер preflight. Изменённые области: `config/public-git-metadata.json`, metadata review parser/resolver, history guard, kit validation, harness tests, AGENTS/PRIVACY и ADR 001.

Разрешение привязано к двум immutable source commit IDs и полям email; адрес извлекается только в памяти и не дублируется в repository config или этом журнале. Тот же email разрешён в соответствующих полях текущих и будущих коммитов. Источники должны быть достижимыми; manifests с неизвестными scopes, wildcards или duplicate sources отклоняются. Review берётся из index; unstaged правка не расширяет разрешение. Email в именах, сообщениях, файлах и tags остаётся под review. Все secret rules и Gitleaks продолжают проверять исходные bytes.

| Проверка | Результат |
|---|---|
| Новые регрессионные tests | Четыре теста сначала воспроизвели отказ, затем прошли; проверяют scope, index authority, будущие коммиты, другое identity, сообщения/имена/файлы/tags, real Gitleaks secret control и invalid/unreachable sources. |
| `npm run preflight` | Прошло полностью: doctor, public workspace, kit, 45/45 tests без пропусков, Gitleaks workspace, index, history/metadata guard и Gitleaks history/metadata. |
| `npm run security:staged` | Прошло: guard и Gitleaks проверили один новый review manifest в index. Остальные незакоммиченные изменения покрыты workspace checks. |
| `npm run check:kit` | Прошло: 26 Markdown-документов, 47 ссылок, 3 референса, 10 CPM и 4 календарных примера. |
| Синтаксис `.mjs`, `git diff --check` | Прошло: 18 служебных скриптов. |

В index добавлен только файл согласованного review; остальные изменения сохранены в working tree. Git identity settings и история не менялись. Commit, push, deployment и внешняя публикация не выполнялись; разрешение на public email не означает поручение отправить репозиторий. Remote protections/CI, Claude runtime, model scenarios и приложение остаются вне выполненных проверок. Синтетические test repositories удалены.

Следующий шаг: сохранить проверенную обвязку локальным коммитом; перед внешней публикацией отдельно проверить серверную защиту и получить поручение на отправку. S0 приложения остаётся отдельной задачей.

## HARNESS-AUDIT — 2026-10-07

Результат: повторно проверены текущие изменения repository harness перед запрошенным локальным коммитом. Обвязка содержит реальные guard/scanner/hook tests, doctor/preflight, Codex launcher и отдельную OS probe. AGENTS.md (63 строки), CLAUDE.md (13 строк, импорт общей политики) и чтение спецификаций по задаче соответствуют проверенным официальным рекомендациям OpenAI/Anthropic. Новые источники добавлены в SOURCES. Изменены только этот журнал и список источников; найденные ограничения защитных скриптов в рамках аудита не исправлялись.

Проверено:

- `npm run preflight` — прошло: doctor, 69 public workspace entries, 26 Markdown-документов, 47 local links, 45/45 tests без пропусков, Gitleaks workspace, index guard, history/metadata guard и Gitleaks history/metadata.
- `npm run agent:sandbox` — прошло: отдельная synthetic OS probe проверила public read/write, отказ private/outside reads и сети. Это не доказательство изоляции текущей произвольной сессии или end-to-end запуска модели.
- В disposable synthetic копии staged Slack token был заменён чистым текстом только в working tree. `preflight` завершился с exit 0, отдельный Gitleaks `--staged` и установленный pre-commit — с exit 1. Значение не выводилось; временная копия удалена. Пробел вызван отсутствием Gitleaks `--staged` в preflight; index guard не покрывает все scanner patterns. Защита pre-commit для этого случая работает.
- После обновления документации прошли `check:kit`, `security:workspace`, синтаксис всех 18 `.mjs`, `git diff --check` и `git diff --cached --check`. Перед коммитом `security:staged` проверил 35 изменённых index blobs; `security:history` проверил 69 index entries, достижимые файлы и два metadata objects, включая Gitleaks. Настроенных remotes нет; их URL не читались.

Рекомендации по приоритету, без изменения подтверждённых продуктовых требований:

1. Дополнить preflight Gitleaks-проверкой индекса и независимой регрессией для расхождения staged/working bytes. До исправления перед коммитом отдельно запускать `security:staged`.
2. Перед внешней публикацией подтвердить доступные server push protection/secret scanning и обязательный CI; отдельно защищать review изменений hooks, scanners, manifests, workflows и agent settings. Локальные hooks обходимы, CI выполняется после отправки.
3. Проверить effective Claude permissions/sandbox на синтетике; запускать пять model scenarios отдельно для выбранных версий Codex/Claude и сохранять только безопасные passed/failed summaries. Конфигурационные tests и наличие сценариев не подтверждают поведение моделей.
4. Проверять совместимость launchers/profiles после обновления CLI и закреплять проверенные версии среды. Поддерживать компактную общую политику; узкие инструкции выносить по мере появления кода, без обязательного чтения всех specs для каждой задачи.
5. В S0 добавить настоящие typecheck/lint/unit/integration/build и lockfile; затем relevant E2E. Перед распространением выбрать лицензию. Эти задачи не выполнены аудитом.

Не выполнены: model/API calls, Claude runtime smoke, end-to-end Codex launcher, удалённый CI и server settings, application tests/build/E2E/Docker. Не менялись Git identity, история, remotes или security settings; push/deployment/publication не выполнялись. Личные данные не использовались. Отсутствие находок означает только прохождение покрываемых правил: имена, телефоны и изображения требуют отдельного ручного privacy-review.

## HARNESS-FIX — 2026-10-07

Результат: исправлены локальные проверки публикации по итогам аудита. Изменённые области: `scripts/preflight.mjs`, `scripts/run-gitleaks.mjs`, `scripts/harness.test.mjs`, START_HERE, BOOTSTRAP, PRIVACY, AGENT_WORKFLOW, ADR 001 и этот журнал. Продуктовые требования и реализация приложения не изменялись.

- Preflight теперь отдельно запускает Gitleaks для полных изменённых staged blobs. Синтетический scanner-only token в index блокируется даже после очистки working tree; чистая копия проходит, незакоммиченные workspace secrets остаются blocking. Проверено сохранение index и ранняя остановка после отказа workspace guard.
- Staged/history/commit-message scans используют снимок `.gitleaks.toml` из index; workspace scan — снимок working policy. Отсутствующие или nonregular index entries блокируются. Незастейдженная конфигурация не подменяет publication policy. Даже пустой staged diff проверяет scanner configuration.
- Temporary policy snapshots создаются с ограниченными правами вне tracked inputs и удаляются после успеха, находки, отказа message guard или scanner error. Ignore-file directory задаётся явно; raw stdout/stderr не выводится. Dedicated scanner finding code различает wrapper exit 1 (находка) и exit 2 (ошибка), оба блокируют операцию.
- Bootstrap теперь описывает явное добавление проверенной scanner policy в index перед самым первым preflight/commit. Новых зависимостей, установки пакетов и изменений личной конфигурации нет.

Проверено:

- Четыре новые регрессии сначала воспроизвели ошибки, затем прошли; дополнительная регрессия пустого index diff также сначала упала и прошла после исправления. Все fixtures синтетические, временные копии удалены, значения positive controls не выводились.
- `npm run preflight` — прошло полностью: doctor, public workspace guard, kit (26 Markdown files / 47 local links), 51/51 tests без пропусков, Gitleaks workspace и staged, index guard, history/metadata guard и Gitleaks history/metadata.
- `npm run agent:sandbox` — прошло: public read/write, private/outside read denial, network denial в отдельной synthetic OS probe.
- `git diff --check` — прошло. Синтаксис служебных скриптов проверен; application checks отсутствуют вместе с приложением.
- Перед коммитом `security:staged` проверил 9 изменённых index blobs; `security:history` и `git diff --cached --check` прошли. После обновления handoff повторно прошли `check:kit`, `security:workspace` и синтаксис всех 18 `.mjs`.

Не выполнены: model/API calls, effective Claude runtime smoke, end-to-end Codex model launch, remote CI/server settings, app build/tests/E2E/Docker. Эти результаты не подменяются kit tests. Git identity, история и remotes не менялись; push/deployment/publication не выполнялись. Scanner policy в index остаётся reviewable и требует owner review при изменении; snapshots не защищают от намеренного переписывания trusted hooks или правил. Ручной privacy-review изображений и прочих персональных данных сохраняется.

## Шаблон записи handoff

```text
Task ID:
Результат:
Изменённые области:
Проверено (команда → результат):
Не проверено / причина:
Риски или блокеры:
Следующий шаг:
```

Только публично безопасные сведения. Без копирования переписки, env, реальных проектов или локальных персональных путей.
