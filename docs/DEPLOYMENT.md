# Локальная упаковка S0/S1

Один production-контейнер запускает один Fastify-процесс: API и собранную React SPA. SQLite хранится на постоянном томе `/data`. Node 24.21.0 bookworm-slim закреплён по official digest в Dockerfile; пакеты устанавливаются при сборке по lockfile, а не во время запуска.

Это проверенная упаковка промежуточного S0/S1, не завершение S5 или релизной приёмки. Контейнер собран и запущен на Linux ARM64. AMD64, HTTPS reverse proxy, обновление предыдущей схемы, restore и import/export пока не проверены.

## Сборка и вход

```sh
docker compose build
docker compose up -d
docker compose exec leaf npm run admin:setup
```

CLI требует интерактивный TTY, скрывает ввод и подтверждение пароля, не принимает пароль из args/env. До setup доступ к проектам закрыт. Затем откройте http://127.0.0.1:3000. Повторный setup не перезаписывает существующий аккаунт.

Compose связывает порт только с `127.0.0.1`, создаёт named volume, запускает процесс от `node` (uid 1000), с read-only root filesystem, отдельным временным каталогом, без capabilities и с no-new-privileges. Свежий том наследует владельца и права `/data` из образа; startup не выполняет chmod произвольных host paths. Не заменяйте named volume реальными production mounts в агентной среде. Docker socket приложению не нужен.

Healthcheck обращается к `/readyz`; `/healthz` проверяет живой процесс. Эти endpoints не раскрывают проекты. SIGTERM корректно закрывает SQLite. `docker compose stop` сохраняет named volume; повторный `up -d` использует ту же базу.

## Границы образа

`.dockerignore` запрещает всё, кроме точных build inputs и TypeScript/CSS source. `npm run check:package` проверяет эту политику и отсутствие source symlinks. Runtime содержит только production dependencies, dist, migrations и package/lockfile; docs, макеты, tests, Git, env, agent settings и runtime storage не копируются.

Builder использует `npm ci --strict-allow-scripts` с Python/make для reviewed implicit GYP. Production dependencies устанавливаются через `npm ci --omit=dev --ignore-scripts`: better-sqlite3 содержит bundled Node-API prebuild, загрузка которого и реальный SQLite query обязательны в самом build stage. Это не заявление о компиляции driver. Контейнерный smoke дополнительно проверяет native storage, CLI, статическую SPA и рестарт.

## Миграции и согласованный backup

```sh
docker compose exec leaf npm run db:migrate
docker compose exec leaf npm run db:backup -- /data/backups/snapshot-001.sqlite
```

Начальная миграция также применяется при запуске. Backup использует SQLite native backup API, работает с открытой WAL-базой и выдаёт snapshot с правами 0600; новый каталог создаётся с 0700. Destination должен быть абсолютным, вне application tree, новым regular file; существующие файлы и symlinks отклоняются. Не копируйте один живой `.sqlite` без WAL как backup.

Backup содержит задачи, аккаунт и сессии, остаётся приватным и не заменяется будущим проектным JSON export. Команда restore, проверки обновления старой схемы и export/import остаются S5. Автоматического destructive restore или фиктивных down migrations нет. Перед будущим обновлением нужно сохранить backup; процедуру восстановления ещё предстоит реализовать и проверить.

## Внешний доступ

Для внешнего доступа потребуется доверенный HTTPS reverse proxy и точный `LEAF_PUBLIC_ORIGIN`. Мутации проверяют origin; cookies HttpOnly/SameSite=Strict, Secure при HTTPS. Trust proxy сейчас выключен. Reverse proxy и его ограничения должны быть отдельно проверены до внешнего размещения. VPN/домашняя сеть не заменяют вход.

Домен, хост, публикацию и отправку образа выбирает владелец. Автодеплоя, registry push, telemetry, CDN или внешних API в runtime нет. Приложение не требует credentials Codex/Claude.
