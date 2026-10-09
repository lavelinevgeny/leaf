# leaf — публичное временное демо на Render

Дата: 2026-10-09. Основание: C28 и рабочий D20 в [DECISIONS](../../DECISIONS.md). Архитектура: [ADR 013](../../adr/013-isolated-public-demo.md). Исполнение: [план](../plans/2026-10-09-render-demo.md).

Владелец запросил бесплатное демо с будущим постоянным URL, допустил потерю демонстрационных изменений и поручил подготовить спецификацию, план и реализацию отдельными агентами с независимой проверкой каждого блока до коммита. Подготовка локальной реализации разрешена; реальное размещение требует отдельного разрешения.

## Global Constraints

- Имя продукта — `leaf`; интерфейс русский, идентификаторы и commit subjects английские.
- Один TypeScript package, React/Vite, Fastify, SQLite, один production-контейнер; Node 24.21.0 и npm 11.19.0, существующий lockfile и pinned Docker base сохраняются.
- Никаких новых runtime-зависимостей, ORM, облачной БД, очередей, telemetry, CDN, AI API или секретов агента.
- Только синтетические данные; не читать реальные базы, `.env`, backups, exports, credentials, browser sessions или истории агентов.
- `LEAF_DEMO_MODE=1` — единственный переключатель демо; обычный режим остаётся fail closed и сохраняет прежнюю password authentication.
- Демо всегда создаёт новую временную БД вне checkout; существующий `LEAF_DATA_DIR` не читается, не очищается и не используется даже при явно заданном пути.
- `trustProxy: false`, точный configured origin, JSON mutation requests, HttpOnly/SameSite=Strict cookie и Secure при HTTPS сохраняются.
- Все authoritative writes, FS cascade, пересчёт и undo проходят существующие серверные транзакции; C11–C27 и optional source semantics сохраняются.
- Три PNG из `design/README.md` остаются единственными утверждёнными UI-референсами; excluded subtask layout не используется.
- Один worktree на агента; один writer на shared contracts; каждый блок и вся ветка проходят независимое review; коммит только после положительного review соответствующего diff.
- Нет push, publication, deployment, remote changes или изменения security policy; эти действия требуют отдельного разрешения владельца.
- Демо не означает завершения S4–S6, production readiness или первого релиза.

## 1. Границы решения

Один бесплатный Render Docker Web Service обслуживает SPA/API. Каждый запуск процесса создаёт чистый синтетический пример. Все вошедшие посетители видят и редактируют общие проекты; сессии и undo независимы. Постоянное имя сервиса даёт будущий URL, но не гарантирует uptime или сохранность данных.

Рабочий выбор: явная кнопка «Открыть демо» без пароля. Альтернативы отклонены: публичный пароль не создаёт границы доступа и нагружает scrypt; per-visitor databases усложняют lifecycle/ресурсы и не нужны для просмотра общего примера; статический сайт не демонстрирует настоящий transactional backend.

Render Free может засыпать после 15 минут без запросов, долго просыпаться и терять локальные файлы при restart/redeploy/spin-down. Постоянные диски в Free недоступны; существуют квоты часов, bandwidth и builds. Не обещать бессрочно бесплатную непрерывную работу и не добавлять keepalive. [Render Free, проверено 2026-10-09](https://render.com/docs/free).

## 2. Изоляция и жизненный цикл

Новый `prepareServerRuntime(environment)` в `src/server/demo-runtime.ts` возвращает существующую конфигурацию и `{ demoMode: boolean, cleanup(): void }`. Обычная ветка делегирует `loadConfig(environment)`; cleanup в ней ничего не удаляет. Флаг отсутствует или `0` — обычный режим; `1` — демо; другие значения отклоняются, чтобы опечатка не меняла смысл запуска молча.

В демо сначала валидируются флаг, host/port/origin. Затем `mkdtempSync` создаёт уникальный собственный каталог `leaf-demo-` под системным temp вне applicationRoot с0700; SQLite и companions следуют существующей проверке regular files. Для существующего `loadConfig` передаётся только новый путь. Не проверять существование исходного `LEAF_DATA_DIR`, не обходить его symlinks и не логировать его. Создание каталога не должно происходить внутри checkout даже при небезопасном TMPDIR.

`main.ts` передаёт `demoMode` в `buildApp`. В startup до listen/ready выполняются миграции новой БД, создание внутреннего аккаунта и seed. Генерируемый случайный пароль никогда не выдаётся клиенту и не записывается в текст/логи; существующий scrypt вызывается лишь при startup. `Auth` получает явный demo flag и поддерживает выдачу обычной случайной 32-byte opaque session без password check только в этом режиме. Нормальная проверка `hasAccount()` остаётся.

Seed проекта/задач/связей и проверка результата выполняются одной внешней SQLite transaction через существующий Repository; никакого отдельного scheduler. Внутренний seed session ID не доступен HTTP; seed operations/undo удаляются внутри той же транзакции, чтобы новый посетитель не получил отмену инициализации. При любой ошибке app не слушает порт; закрывается SQLite, затем удаляется только созданный этим запуском каталог. `cleanup()` идемпотентен, normal data directory никогда не является его целью. SIGINT/SIGTERM закрывает app/SQLite, затем cleanup. При SIGKILL cleanup не гарантируется; следующий запуск создаёт другой каталог, не ищет и не удаляет старые.

CLI admin/migrate/backup не переводятся на demo runtime: обычный `loadConfig` сохраняется для них. На размещённом демо эти команды не требуются и не предлагаются. `/healthz` и `/readyz` не раскрывают данные; readiness доступна только после успешного seed.

## 3. Сессия и HTTP

Минимальная совместимая схема:

```ts
export const sessionSchema = z.strictObject({
  authenticated: z.boolean(),
  setupRequired: z.boolean(),
  demoMode: z.boolean().optional(),
});
// Отсутствие demoMode трактуется клиентом как false.
```

| Запрос | Демо | Обычный режим |
|---|---|---|
| GET `/api/auth/session` | `{ authenticated, setupRequired: false, demoMode: true }` | Прежние два поля, demoMode отсутствует |
| POST `/api/auth/demo`, body `{}` | Новая session cookie; `{ authenticated: true, setupRequired: false, demoMode: true }` | Endpoint не зарегистрирован, 404 |
| POST `/api/auth/logout`, body `{}` | Отзывает только текущую сессию/undo; возвращает demoMode:true и authenticated:false | Прежнее поведение |
| POST `/api/auth/login` | Не проверяет пароли и не запускает scrypt: безопасный 403 `DEMO_PASSWORD_DISABLED` | Прежний password login/rate limit |
| Project APIs | Обычная обязательная сессия и contract version 2 | Прежнее поведение |

`POST /api/auth/demo` требует exact Origin и Content-Type application/json, strict empty object body; missing/foreign Origin →403, non-JSON →415, лишние поля →400. Cookie атрибуты, срок SESSION_SECONDS и SHA256 token storage совпадают с обычным login. Повтор входа с действующей cookie возвращает её сессию без добавления строки; не выполнять автоматический вход при GET или reload. Logout одного посетителя не отзывает остальных. После restart старые cookies не проходят проверку и UI предлагает повторный явный вход.

Совместное редактирование использует текущие expectedRevision/409 и session-scoped undo, без realtime и last-write-wins. Cookie и project responses не попадают в stdout/артефакты. Ни session flag, ни список проектов не открывают API без cookie.

## 4. Ограничения публичного процесса — рабочие defaults

Лимиты существуют только в памяти демо, без новых framework/timers и без доверия `X-Forwarded-For`. Окна очищаются лениво по `now()`; ключи посетительских IP не накапливаются.

- Выдача новых сессий: 60 попыток за фиксированное окно60000 ms на весь процесс; максимум100 неистёкших sessions. Истёкшие sessions и их undo очищаются; при заполнении новые выдачи отклоняются, действующие остаются.
- Project mutations, включая create/rename/commands/undo: максимум120 попыток за окно60000 ms, максимум200 допущенных попыток и суммарно256 KiB UTF-8 JSON parsed bodies (`Buffer.byteLength(JSON.stringify(parsedBody), 'utf8')`; прежний per-request bodyLimit не меняется) за весь процесс. Seed не расходует эти бюджеты.
- Проверка выполняется после origin/JSON/basic-body/session/contract checks, до вызова Repository; один запрос проверяет все бюджеты и затем атомарно увеличивает счётчики. Допущенный запрос расходует бюджет, даже если Repository вернул409/validation error или cached retry. Отклонённый запрос не создаёт persistent rows/logs. Normal mode эти ограничения не получает.
- Исчерпание любого лимита →429 `DEMO_LIMIT`. Для минутного/session limit текст: «Демо временно занято. Повторите позже.»; для lifetime count/bytes: «Лимит изменений демо исчерпан. Просмотр доступен; изменения снова станут доступны после перезапуска сервиса.» Никакого обещания, что reload сбросит серверный бюджет.
- Чтение, health, session inspection и logout остаются доступны при исчерпании mutation budget. Это ограничение случайного/простого злоупотребления, не заявление о защите от DDoS.

## 5. Синтетический пример

Один проект «Демо-проект», timezone `UTC`, calendarType `weekdays`. Startup clock передаётся явно через существующий `now`; today вычисляется в UTC. База `T` — сегодня, если рабочий день, иначе следующий рабочий день. `W(n)` — n рабочих дней после T, используя existing domain calendar helpers, а не миллисекунды в React.

| Ветка/работа | Родитель | Исходные даты/длительность | FS |
|---|---|---|---|
| Запуск примера | root | summary | — |
| Подготовка | Запуск примера | summary | — |
| План работ | Подготовка | T–W(1), 2 | — |
| Реализация | Запуск примера | W(2)–W(4), 3 | План работ → Реализация |
| Проверка | Запуск примера | W(5)–W(5), 1 | Реализация → Проверка |
| Идеи | root | summary | — |
| Исследовать вариант | Идеи | start:null, finish:null, duration:2 | — |
| Обсудить результат | Идеи | start:null, finish:null, duration:null | Исследовать вариант → Обсудить результат |
| Уточнить начало | Идеи | start:T, finish:null, duration:null | — |
| Уточнить окончание | Идеи | start:null, finish:W(4), duration:null | — |

Все ID — новые UUID; только вымышленные названия/описания без людей, адресов, внешних ссылок. Используются todo/doing; done необязателен. В дереве видны уровни1–3. Реальная chain даёт серверную critical path для полной ветки; проект с неполными сроками показывает именно partial analysis датированной части по C16, не ложный global ready. Недатированные работы демонстрируют C19/D18; их условная геометрия не записывается в source. Тесты проверяют семантику независимо от конкретных UUID.

## 6. Клиент

`api.enterDemo()` делает POST `/auth/demo` с `{}` и `sessionSchema`. Состояние demoMode берётся с сервера. До входа вместо password/setup form показывается «Открыть демо» и постоянный текст:

> Публичное демо: данные общие для всех посетителей и сбрасываются при каждом запуске сервера. Не вводите личные данные.

После входа тот же текст остаётся видимым компактным блоком над рабочей областью. Он не перекрывает controls, не исчезает по таймеру и не заменяет дерево/Гант. Вся копия хранится в `strings.ts`. Пользователь явно выбирает вход кнопкой или Enter/Space; во время запроса она disabled, есть loading text, ошибка в role=alert, повтор возможен. Начальная ошибка GET session показывает существующий retry, без предложения произвольного входа. Пустой проект после редактирования использует существующие empty states; reload не восстанавливает seed. Logout сохраняет режим демо и возвращает кнопку. Проверить оба viewport1440×900 и1280×800, focus и normal auth regression.

## 7. Render/контейнер

`render.yaml`: один `type: web`, `runtime: docker`, `plan: free`, `dockerfilePath: ./Dockerfile`, `dockerContext: .`, `healthCheckPath: /readyz`, `autoDeployTrigger: off`; без repo URL, credentials, disk, paid resources и release/preDeploy commands. Env: `LEAF_DEMO_MODE=1`, `LEAF_HOST=0.0.0.0`, `LEAF_PORT=3000`, `PORT=3000`. PORT и LEAF_PORT намеренно совпадают с Docker healthcheck/EXPOSE. [Blueprint reference](https://render.com/docs/blueprint-spec), [port/TLS rules](https://render.com/docs/web-services).

В demo runtime explicit `LEAF_PUBLIC_ORIGIN` имеет приоритет и проходит exact-origin validation. При отсутствии использовать `https://` + валидированный single DNS label под `.onrender.com` из `RENDER_EXTERNAL_HOSTNAME`, только при `RENDER=true`. Никаких схем, ports, paths, userinfo, wildcard, trailing dot или дополнительного subdomain label в hostname; malformed value отклоняется. При Render deployment разрешён только HTTPS; отсутствие/ошибка hostname без explicit origin блокирует запуск, не подставляет loopback. Вне Render при отсутствии explicit origin сохраняется `http://127.0.0.1:<port>`; для локального synthetic запуска explicit loopback HTTP допустим. Request Host/Forwarded headers никогда не определяют origin. [Render environment variables](https://render.com/docs/environment-variables).

Dockerfile удаляет baked-in `LEAF_PUBLIC_ORIGIN` loopback, чтобы он не перекрывал Render hostname fallback; normal default `loadConfig` остаётся прежним loopback. Compose явно задаёт прежний origin. Порт/host/data defaults, USER node, digest, .dockerignore allowlist, package-check и отсутствие приватных runtime файлов в слоях сохраняются. Render TLS заканчивается на proxy, app использует configured HTTPS origin для Secure cookie без trust-all proxy.

Подготовить инструкции локального demo smoke, ручного создания сервиса владельцем после отдельного разрешения, чтения назначенного URL, ожидания cold start и проверки HTTPS/edit/restart. Не считать локальный proxy smoke реальным Render deployment. Новую live ссылку сообщать только после настоящей отдельно разрешённой публикации.

## 8. Приёмка и review

A1: normal без setup закрыт, demo route404; существующие auth tests проходят. A2: demo не обращается к synthetic sentinel LEAF_DATA_DIR, включая symlink; fresh restart сбрасывает edits и sessions. A3: startup seed atomic; ошибки и graceful shutdown удаляют только собственный temp после close. A4: strict origin/JSON/cookies, недоверенные forwarded headers, guest session logout/expiry и лимиты подтверждены.

A5: пример показывает три уровня, валидную FS chain/critical branch, partial semantics, nullable dates и conditional bars; seed outputs проходят LIVE validators. A6: actual-server browser вход без пароля, предупреждение, изменение/undo, два посетителя/409, logout/re-entry, restart и invalidated cookie; component tests loading/error/keyboard/normal mode. A7: Docker normal+demo smoke, synthetic local TLS proxy Secure cookie/origin/edit/logout, healthcheck/port, restart cleanup; build context policy сохраняется. A8: docs checks, affected checks и финальные verify/format:check/test:e2e/check:package/preflight, независимые block/final reviews; честно перечислить недоступные проверки.

Выполнение идёт по трём блокам плана. Положительное review относится к точному diff; исправления после review снова проверяются. S4–S6, restore, board и реальная публикация остаются вне этого изменения.
