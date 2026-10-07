# Инициализация репозитория для агента

## До первого изменения

Прочитать START_HERE и AGENTS. Проверить Git status без удаления чужих изменений. Корень этого комплекта должен совпадать с Git-корнем. Если Git ещё не создан, агент может подготовить локальный репозиторий после проверки владельцем места; remote URL и публичность не выдумывать. Не создавать nested repository.

Для существующего проекта объединять `.gitignore`, инструкции и workflows осознанно. Не запускать scaffolder с очисткой каталога. Сначала существующее состояние и короткий план; затем код.

## Среда

Зафиксированы Node 24.21.0, npm 11.19.0, точные direct dependencies и package-lock.json. `.nvmrc` содержит exact patch. При обновлении проверить совместимость и security fixes, затем обновить pin и digest контейнера совместно. Стек и native install policy описаны в ADR 002. Для обычного `npm ci` нужны Python 3 и make: npm запускает implicit GYP даже при наличии bundled better-sqlite3 prebuild.

Использовать npm. Не добавлять pnpm/yarn/Bun параллельно. `npm ci --strict-allow-scripts --no-audit --no-fund` по существующему lockfile; установка зависимостей и выполнение lifecycle scripts требуют осознанного review, особенно в чужих PR. Секретов в окружении bootstrap быть не должно.

Сейчас проверяются:

```sh
npm run check:kit
npm run security:workspace
```

`security:workspace` нужен для чистого комплекта до появления локального `.env`/базы; затем для коммитов использовать index/history checks. После установки Gitleaks запустить `npm run test:kit`; весь suite требует настоящий scanner, ничего не пропускает. Служебные тесты создают временные локальные Git-репозитории с синтетическими значениями и удаляют их.

## Хуки и полноценный secret scanner

В комплекте `.githooks/pre-commit`, `commit-msg` и `pre-push`. Установка явная:

```sh
npm run hooks:install
```

Инсталлятор проверяет Git-корень и не перезаписывает существующий `core.hooksPath` или активные default hooks. При конфликте интеграция выполняется отдельно, не через `--force`. ZIP может не сохранить executable bit: скрипт выставит его сам.

Хуки требуют **Gitleaks 8.30.1 или совместимую проверенную версию**. Установить из официального проекта, проверив происхождение и checksum. Один из вариантов при наличии Go с поддержкой toolchain selection:

```sh
go install github.com/zricethezav/gitleaks/v8@v8.30.1
```

Добавить каталог Go bin в личный PATH, не записывая персональные пути в репозиторий. Альтернатива — официальный release binary с checksum. Go не нужен приложению leaf, только этому способу установки dev-инструмента. Не скачивать и не выполнять случайный shell installer.

Pre-commit проверяет staged blobs локальным guard и полные изменённые index blobs через Gitleaks stdin. Commit-msg проверяет pending Git message локальными правилами и Gitleaks. Pre-push проверяет текущий index и всю достижимую историю, затем Gitleaks file history и metadata stdin, включая nested annotated tags. При отсутствии Gitleaks операция блокируется, а не пропускается. На большом существующем репозитории полный history scan может занять время — безопасность не выключать ради скорости.

Проверки staged/history/commit message используют снимок `.gitleaks.toml` из index. Перед самым первым коммитом или preflight прочитать и проверить публичную конфигурацию, затем добавить её в index явно:

```sh
npm run security:workspace
git add -- .gitleaks.toml
```

Отсутствующая, конфликтующая или symlink-конфигурация в index блокирует проверку. Незастейдженные правила не подменяют правила публикации. Workspace scan использует отдельный снимок рабочей конфигурации, чтобы проверить ещё не подготовленные к коммиту файлы. Снимки создаются вне checkout с ограниченными правами и удаляются после успеха, находки или ошибки scanner.

## Единый локальный preflight

```sh
npm run doctor
npm run preflight
```

Doctor проверяет корень, exact Node patch из `.nvmrc`, npm, Gitleaks 8.30.1+, configured hooks с executable bits и public safety profiles. Он не читает auth/config агента в home и не проверяет login. Preflight запускает workspace guard до остальных читающих проверок, затем проверяет kit, реальные scanner/hook tests, незакоммиченные public text files, index guard, полные изменённые staged blobs через Gitleaks, историю и metadata. Index не изменяется; новая незастейдженная правка тоже проверяется. Private workspace path блокирует preflight без чтения содержимого.

Это локальный барьер. `agent:sandbox` отдельно проверяет OS isolation Codex, а удалённые настройки подтверждает владелец. После появления runtime `.env`/БД держать их за пределами agent checkout; обычные коммиты проверять через index/history commands.

## Защита на сервере Git

Владелец включает доступные secret scanning / push protection и проверяет настройки для репозитория. CI — повторная защита, а не барьер перед первой утечкой. Включить ruleset/защиту основной ветки: обязательные проверки, запрет force-push, review важных изменений. Требовать успешный job `kit`; изменения `.github/workflows/`, `.githooks/`, `scripts/`, `.gitleaks.toml`, agent settings и asset manifest должны проходить review владельца. Привязку CODEOWNERS к реальному аккаунту выполняет владелец; шаблон с выдуманным account не создаётся. Однопользовательский репозиторий может применять owner review, но это не заменяет проверок.

Отдельный workflow kit проверяет документацию и Git privacy с Gitleaks. Application workflow выполняет exact npm ci, typecheck, lint, реальные unit/integration tests, build, format/package checks и Chromium E2E. Оба используют read-only permissions и закреплённые SHA actions; uploads, release/deploy отсутствуют. Не применять `pull_request_target` для запуска кода из fork. Не использовать production self-hosted runner для чужих PR.

## Запуск и проверки приложения S0/S1

```sh
npm ci --strict-allow-scripts --no-audit --no-fund
npm run verify
npm run format:check
npm run check:package
npm exec playwright -- install --with-deps chromium
npm run test:e2e
```

E2E запускает реальные собранные серверные процессы, поэтому сначала нужен `npm run build` (он входит в verify). Тесты создают и удаляют собственные внешние синтетические базы и аккаунты; приложение не добавляет default account. Browser results и снимки сохраняются во временном каталоге ОС вне checkout, traces/video выключены. CI ничего не загружает как artifact.

Для локальной разработки задайте абсолютный внешний каталог `LEAF_DATA_DIR`, выполните build, `npm run admin:setup` в интерактивном терминале и `npm run dev`. Вход — на http://127.0.0.1:5173. API по умолчанию на 3000; `LEAF_PORT` меняет серверный порт и Vite proxy. `LEAF_PUBLIC_ORIGIN` в dev по умолчанию равен origin Vite. SIGINT/SIGTERM останавливает оба дочерних процесса. Настройка аккаунта не принимает пароль из args/env и не выводит его.

`npm run db:migrate` применяет встроенную начальную миграцию. `npm run db:backup -- /absolute/external/new-snapshot.sqlite` создаёт согласованный SQLite snapshot через native backup API при работающем сервере, с правами 0600; существующий destination и symlink отклоняются. Backup содержит аккаунт и задачи и остаётся приватным. Restore, JSON import/export и upgrade from previous schema пока не реализованы (S5). Контейнерный запуск описан в DEPLOYMENT.

## Готовность S0

`verify` выполняет реальные typecheck, lint, unit/integration и build; отдельный application CI job добавлен. Не подменять его kit tests. `dev`, `build`, `start`, `lint`, `typecheck`, application tests, migration and backup commands должны быть реализованы и проверены. Обновить README и STATUS. Не прописывать `npm run test --if-present` и не ставить green badge незапускаемому приложению. Поднять контейнер только на loopback; никаких облачных аккаунтов, API-ключей или remote deployment для bootstrap не нужно.

Ручная настройка Git author identity — отдельно в личной конфигурации. Для публичного репозитория владелец может выбрать GitHub noreply; реальные email из локальных настроек не копировать в docs. Guard теперь проверяет metadata существующих коммитов/тегов, но не отменяет их публикацию и не решает за владельца, какие identity допустимы. `EMAIL_REVIEW_REQUIRED` требует решения владельца. История и Git identity не меняются автоматически.
