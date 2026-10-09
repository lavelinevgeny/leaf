# Локальная упаковка и публичное демо

Один production-контейнер запускает один Fastify-процесс: API и собранную React SPA. В обычном Compose-режиме SQLite хранится на постоянном томе `/data`; в демо база временная. Node 24.21.0 bookworm-slim закреплён по official digest в Dockerfile; пакеты устанавливаются при сборке по lockfile, а не во время запуска.

Упаковка проверяется только на новых синтетических локальных ресурсах. Tasks 5–7 реализовали optional source/storage/API/UI и серверный CPM по C16; текущие проверки и ограничения — в [STATUS](STATUS.md). Публичное демо показывает существующий продукт, но не означает завершения S4–S6 или production readiness.

## Локальное демо

После `npm run build` запустите отдельный процесс с синтетическим примером:

```sh
LEAF_DEMO_MODE=1 LEAF_HOST=127.0.0.1 LEAF_PORT=3000 LEAF_PUBLIC_ORIGIN=http://127.0.0.1:3000 npm run start
```

Откройте http://127.0.0.1:3000 и нажмите «Открыть демо». Пароль, setup, shell и отдельная миграция не нужны: сервер создаёт новую базу во временном каталоге вне checkout, синтетический проект и задачи до готовности `/readyz`. Все вошедшие посетители видят общие изменения; сеансы и отмена независимы. После завершения процесса и нового запуска изменения и прежние cookies теряются. Не вводите личные данные. `LEAF_DATA_DIR` в demo mode игнорируется; не указывайте путь к реальным данным даже для проверки.

Обычный Compose ниже остаётся постоянным режимом с приватным томом и интерактивной настройкой аккаунта. Для локального demo smoke можно использовать тот же собранный образ с `LEAF_DEMO_MODE=1`, без private mount, с read-only root и отдельным tmpfs `/tmp`; при остановке удаляйте только созданные для этой проверки контейнеры.

## Будущее размещение на Render Free

Файл [render.yaml](../render.yaml) описывает один бесплатный Docker Web Service, `/readyz`, ручной deploy trigger и одинаковые `PORT=LEAF_PORT=3000`; сервер слушает `LEAF_HOST=0.0.0.0`. Диска, базы Render, платного ресурса и credentials в Blueprint нет. Само наличие файла ничего не размещает. Владелец после отдельного разрешения на публикацию связывает проверенный репозиторий с Render через Dashboard/Blueprint, сверяет Free plan и выключенный automatic deploy, запускает первоначальный deploy и читает назначенный URL в Dashboard. Не угадывайте URL по имени сервиса. После реальной проверки размещения владелец может отдельно указать фактический URL в GitHub repository **About → Website**; сейчас ссылки нет. CLI setup на сервисе не нужен.

На Render процесс использует `RENDER_EXTERNAL_HOSTNAME` только при `RENDER=true`, если `LEAF_PUBLIC_ORIGIN` не задан. Допускается один DNS label под `.onrender.com`, из него вычисляется точный HTTPS origin. При custom domain задайте `LEAF_PUBLIC_ORIGIN=https://<фактический-домен>` в настройках сервиса и открывайте именно его; HTTP или отсутствующий/неверный hostname блокируют старт. Render завершает TLS на своём proxy, а приложение проверяет точный Origin и выдаёт Secure/HttpOnly/SameSite=Strict cookie без доверия forwarded headers. После запуска проверьте HTTPS, `/readyz`, вход кнопкой, изменение и выход; повторный запуск должен сбросить изменения и прежнюю сессию. Это будущая ручная проверка, фактического Render deployment здесь нет.

Render Free может усыпить сервис после 15 минут без входящих запросов; пробуждение может занять около минуты. Локальные файлы, включая SQLite, теряются при spin-down, restart и redeploy; Render также может перезапустить Free сервис. Остановка/перезапуск затрагивает всех посетителей. Постоянный диск на Free недоступен; месячные лимиты часов, bandwidth и build minutes могут остановить доступность или сборки. Демо не обещает непрерывной работы, сохранности данных или бесплатности сверх лимитов. Актуальные условия проверены 2026-10-09 по [Render Free](https://render.com/docs/free), [Blueprint reference](https://render.com/docs/blueprint-spec), [Web Services](https://render.com/docs/web-services) и [Render environment variables](https://render.com/docs/environment-variables).

## Сборка и вход

```sh
docker compose build
docker compose up -d
docker compose exec leaf npm run admin:setup
```

CLI требует интерактивный TTY, скрывает ввод и подтверждение пароля, не принимает пароль из args/env. До setup доступ к проектам закрыт. Затем откройте http://127.0.0.1:3000. Повторный setup не перезаписывает существующий аккаунт.

Для восстановления входа владелец может выполнить `docker compose exec leaf npm run admin:reset-password` и дважды ввести новый пароль. Новый хеш, отзыв всех сеансов и очистка истории отмены фиксируются одной транзакцией; проекты и задачи сохраняются. При сработавшем ограничении попыток входа нужно дождаться окончания минутного окна. Удалённого HTTP endpoint для смены пароля нет; граница доступа описана в [ADR 003](adr/003-local-password-recovery.md).

Compose связывает порт только с `127.0.0.1`, создаёт named volume, запускает процесс от `node` (uid 1000), с read-only root filesystem, отдельным временным каталогом, без capabilities и с no-new-privileges. Свежий том наследует владельца и права `/data` из образа; startup не выполняет chmod произвольных host paths. Не заменяйте named volume реальными production mounts в агентной среде. Docker socket приложению не нужен.

Healthcheck обращается к `/readyz`; `/healthz` проверяет живой процесс. Эти endpoints не раскрывают проекты. SIGTERM корректно закрывает SQLite. `docker compose stop` сохраняет named volume; повторный `up -d` использует ту же базу.

## Границы образа

`.dockerignore` запрещает всё, кроме точных build inputs, лицензии и TypeScript/CSS source. `npm run check:package` проверяет эту политику, отсутствие source symlinks и копирование лицензии. Runtime содержит только production dependencies, dist, migrations, package/lockfile и MIT `LICENSE`; docs, макеты, tests, Git, env, agent settings и runtime storage не копируются.

Builder использует `npm ci --strict-allow-scripts` с Python/make для reviewed implicit GYP. Production dependencies устанавливаются через `npm ci --omit=dev --ignore-scripts`: better-sqlite3 содержит bundled Node-API prebuild, загрузка которого и реальный SQLite query обязательны в самом build stage. Это не заявление о компиляции driver. Контейнерный smoke дополнительно проверяет native storage, CLI, статическую SPA и рестарт.

## Миграции и согласованный backup

```sh
docker compose exec leaf npm run db:migrate
docker compose exec leaf npm run db:backup -- /data/backups/snapshot-001.sqlite
```

Свежий экземпляр применяет 001→002→003. Existing schema2 не изменяется обычным startup без preview acknowledgement; schema1 отклоняется до промежуточной миграции. Перед обновлением владелец останавливает сервер и сохраняет native backup. Для stopped service используйте одноразовый контейнер с тем же томом:

```sh
docker compose run --rm leaf npm run db:migrate -- --preview
docker compose run --rm leaf npm run db:migrate -- --confirm-preview=<previewDigest>
```

Preview readonly; вывод ограничен policy/counts/digest. Подтверждение использует digest именно этого preview, который перепроверяется первым шагом IMMEDIATE-транзакции до записей. Изменившиеся данные блокируют apply. Миграция003 сохраняет operations/undo/account и приватный exact archive legacy fields. Уже применённая003 повторного подтверждения не требует. Production upgrade требует отдельного разрешения владельца; здесь выполняются только synthetic smoke.

Backup использует SQLite native backup API, работает с открытой WAL-базой и выдаёт snapshot с правами0600; новый каталог создаётся с0700. Destination должен быть абсолютным, вне application tree, новым regular file; существующие файлы и symlinks отклоняются. Не копируйте один живой `.sqlite` без WAL как backup.

Backup содержит задачи, аккаунт и сессии, остаётся приватным и не заменяется будущим проектным JSON export. Команда restore, полноценная процедура upgrade/restore и export/import остаются S5. Автоматического destructive restore или фиктивных down migrations нет. Перед будущим обновлением нужно сохранить backup; процедуру восстановления ещё предстоит реализовать и проверить.

## Внешний доступ

Для обычного внешнего доступа потребуется доверенный HTTPS reverse proxy и точный `LEAF_PUBLIC_ORIGIN`. Мутации проверяют origin; cookies HttpOnly/SameSite=Strict, Secure при HTTPS. Trust proxy выключен. VPN/домашняя сеть не заменяют вход. Demo runtime рассчитан только на публичные синтетические данные, а не на хранение обычных проектов.

Домен, хост, публикацию и отправку образа выбирает владелец. Автодеплоя, registry push, telemetry, CDN или внешних API в runtime нет. Приложение не требует credentials Codex/Claude.
