# Self-hosted развёртывание — требования агенту

**Это целевое руководство. До реализации S0–S5 приложение и Dockerfile отсутствуют.** Агент заменяет проектные примеры проверенными командами, а не выдаёт их за работающую установку.

## Production-форма

Один контейнер: Node-процесс, API и собранная SPA. SQLite на постоянном томе `/data`. Устанавливать пакеты/браузеры во время production-запуска нельзя. Build — multi-stage, non-root runtime, минимально необходимые runtime dependencies. В image не включать docs/reference screenshots, `.git`, env, backups, агентские настройки и tooling credentials.

Рекомендуется поддерживаемый Debian slim Node image с проверенным patch и digest; точную версию выбирает S0. Нативный sqlite-driver проверяется на целевой архитектуре. Не обещать arm64 до реальной сборки/проверки. Нельзя копировать весь checkout командой COPY без работающего allowlist `.dockerignore`.

## Целевой пример Compose после реализации

```yaml
services:
  leaf:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      NODE_ENV: production
      LEAF_HOST: 0.0.0.0
      LEAF_PORT: "3000"
      LEAF_DATA_DIR: /data
      LEAF_PUBLIC_ORIGIN: http://127.0.0.1:3000
    volumes:
      - leaf-data:/data
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
volumes:
  leaf-data:
```

Пароля в примере нет. До установки локального аккаунта сервер должен быть закрыт для работы с данными. Admin CLI нужно вызвать локально/через доверенный интерактивный shell; агент реализует команду и проверяет отсутствие пароля в аргументах и логах. Никаких admin/admin или seeded owner passwords.

Порт по умолчанию привязан к loopback хоста. Для внешнего доступа — доверенный reverse proxy с HTTPS и корректным LEAF_PUBLIC_ORIGIN, безопасными cookies и ограниченным trust proxy. VPN/домашняя сеть не заменяют аутентификацию. Не открывать сервер в Интернет автоматически.

## Постоянство и backups

Запись возможна только в `/data` и необходимый временный каталог; root filesystem по возможности read-only после проверки native dependencies и shutdown. Обеспечить владельца/права volume без startup chmod на произвольные host paths. Не монтировать Docker socket.

SQLite backup — согласованным API или после корректной остановки, не копированием одного живого `.db` при WAL (S07). Команда backup выдаёт файл вне репозитория с ограниченными правами, не печатает данные. Команда restore проверяет schema version, целостность и конфликт с запущенным процессом; предварительно делает backup существующего состояния. Перед применением destructive restore требуется явное согласие.

Проектный JSON export не заменяет полный operational backup с аккаунтом/настройками. В документации различать два формата и их чувствительность.

## Миграции и проверка релиза

Перед обновлением — backup. Миграции не теряют данные и имеют smoke test from previous schema. Если rollback схемы не поддержан, честно описать restore из backup вместо фиктивного down migration.

Проверить чистую установку, безопасный setup, login/logout, task persistence, container restart, consistency after SIGTERM, backup/restore, import/export, отсутствие приватных файлов в image build context/layers и внешнего трафика страницы. `/healthz` — liveness, `/readyz` — готовность хранилища без раскрытия сведений о проектах.

По умолчанию нет автодеплоя, автоотправки образов в registry или удалённых команд. Ссылку/домен/хост и публикацию выбирает владелец. Обновления и dependency/security review описать после реальной установки, не привязывать к аккаунтам из окружения агента.
