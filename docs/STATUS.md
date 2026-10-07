# Статус разработки

## Текущее состояние

Реализован и интегрирован промежуточный S0/S1: один TypeScript-пакет, React/Vite, Fastify, SQLite, локальный вход, проекты, произвольная глубина дерева, компактная правая панель, статусы, описание, optional input dates, перенос/удаление веток и серверная отмена. Данные сохраняются после настоящего перезапуска процесса. Даты пока являются сохранённым вводом; расчёта расписания нет. Три утверждённых референса сохранены; исключённый коллаж не используется.

Это ещё не готовая V1: Гант, зависимости и пересчитываемые критические пути остаются обязательными этапами S2/S3. Production-контейнер упаковывает текущий фундамент. Kit/privacy проверки отделены от application tests. Git identity review и scanner policy сохранены. Внешняя публикация и deployment не выполнялись.

| Этап | Статус |
|---|---|
| S0: репозиторий и исполняемый фундамент | Реализован; финальный combined preflight после интеграции ожидается |
| S1: дерево, панель, SQLite CRUD | Реализован и проверяется реальными browser/restart scenarios |
| S2: scheduling module и транзакции | Следующий этап, не начат |
| S3: Гант и схема зависимостей | Не начат |
| S4: повседневный UX и доска | Не начат |
| S5: self-hosting и сохранность данных | Есть Docker/Compose и consistent backup; restore/import/export/upgrade не реализованы |
| S6: релизная приёмка | Не начат |

## Следующая задача

Выполнить S2 по SCHEDULING, fixtures и ACCEPTANCE: чистый тестируемый планировщик и атомарный пересчёт на сервере. Не подменять его расчётами в React. Финальный whole-branch review и combined preflight выполняются после интеграции из обычного checkout. Перед внешней публикацией отдельно нужны поручение владельца, проверка remote CI/серверной защиты и решение о лицензии.

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
| Combined preflight / финальный whole-branch review | Ожидаются после интеграции в обычном checkout. |

Linked worktree guard отклоняет корневой `.git` pointer по PERSONAL_HOME_PATH; policy не изменялась. Здесь preflight не запускался: он должен быть выполнен в обычном checkout после итоговой интеграции. Предыдущий обычный-checkout preflight для API прошёл, но не подменяет итоговую проверку.

Не выполнены: remote CI execution, AMD64 container smoke, HTTPS reverse proxy, restore/import/export, previous-schema upgrade, scheduling/Gantt/dependencies/CPM, S6 acceptance. Browser snapshots только синтетические и вне публичных assets; traces/video и CI uploads отсутствуют. Документация не содержит raw reports, runtime данных или личных путей.

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
