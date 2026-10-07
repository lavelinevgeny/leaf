# leaf

Лёгкий self-hosted планировщик с видимой иерархией задач. Целевой первый релиз включает Гант, зависимости и пересчитываемый критический путь.

**Сейчас реализованы S0/S1:** локальный вход, проекты, произвольная глубина дерева, компактная правая панель, статусы, описание, необязательные входные даты, перенос и удаление веток, серверная отмена и SQLite persistence. **Это промежуточный фундамент, не готовая V1:** расписание, Гант, зависимости и критический путь ещё не реализованы.

**Разработчику или AI-агенту: начать с [START_HERE.md](START_HERE.md).**

![Выбранный ориентир главного окна leaf](design/references/01-main-screen.png)

## Локальный запуск

Нужны Node 24.21.0, npm 11.19.0, Python 3 и make для reviewed native install. Runtime storage хранится вне checkout. Используйте отдельные синтетические данные для разработки.

```sh
npm ci --strict-allow-scripts --no-audit --no-fund
npm run build
export LEAF_DATA_DIR=/var/tmp/leaf-development
npm run admin:setup
npm run dev
```

Откройте http://127.0.0.1:5173. Настройка аккаунта требует интерактивный терминал, скрытый ввод и подтверждение пароля; default account и удалённого setup нет. API работает на loopback:3000; `LEAF_PORT` меняет серверный порт и Vite proxy. `npm start` обслуживает собранную SPA и API на http://127.0.0.1:3000; для этого origin задаётся `LEAF_PUBLIC_ORIGIN=http://127.0.0.1:3000`. SIGINT/SIGTERM закрывают сервер и хранилище.

Production-контейнер и локальные Docker команды описаны в [DEPLOYMENT](docs/DEPLOYMENT.md). Реальная контейнерная проверка выполнена на Linux ARM64; другие архитектуры ещё не проверены.

## Проверки

```sh
npm run verify
npm run format:check
npm run check:package
npm exec playwright -- install --with-deps chromium
npm run test:e2e
```

`verify` запускает typecheck, lint, настоящие unit/integration tests и build. E2E использует собранный сервер, собственные временные синтетические SQLite-базы и реальные перезапуски процессов. Снимки остаются вне checkout, traces/video выключены. Kit/privacy проверки выполняются отдельно:

```sh
npm run check:kit
npm run test:kit
npm run doctor
npm run preflight
```

Preflight требует Git, Gitleaks и установленные hooks; подготовка — в [BOOTSTRAP](docs/BOOTSTRAP.md). Он проверяет безопасность репозитория и комплект, а не поведение приложения.

## Хранение

```sh
npm run db:migrate
npm run db:backup -- /var/tmp/leaf-backups/new-snapshot.sqlite
```

Обе команды используют `LEAF_DATA_DIR`. Backup создаёт согласованный snapshot SQLite через native API, включая актуальный WAL, и отказывает при существующем destination. Файл содержит аккаунт и задачи; он приватный. Restore и проектный JSON import/export ещё не реализованы (S5).

## Навигация

| Документ | Содержание |
|---|---|
| [START_HERE.md](START_HERE.md) | Точка входа и текущие этапы |
| [Проект](docs/PROJECT.md) / [Решения](docs/DECISIONS.md) | Функциональность, ограничения, допущения |
| [Дизайн](design/README.md) | Только три выбранных макета |
| [Планировщик](docs/SCHEDULING.md) | Семантика дат, зависимости, CPM, конфликты |
| [Архитектура](docs/ARCHITECTURE.md) | Стек, данные и границы модулей |
| [План](docs/IMPLEMENTATION_PLAN.md) / [Приёмка](docs/ACCEPTANCE.md) | Этапы и проверяемые критерии |
| [Безопасность публикации](docs/PRIVACY.md) | Секреты, личные данные, история Git |
| [Статус](docs/STATUS.md) / [Проверка комплекта](docs/VALIDATION.md) | Что сделано и проверено |

## Публикация и лицензия

Production-данные и конфигурация не входят в публичный репозиторий или образ. См. [SECURITY.md](SECURITY.md) и [LICENSE-NOTE.md](LICENSE-NOTE.md). Лицензия ещё не выбрана владельцем. Push, публикация образа и deployment требуют отдельного поручения; CI их не выполняет.
