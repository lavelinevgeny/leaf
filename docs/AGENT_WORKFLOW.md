# Codex + Claude Code

## Один источник правил

`AGENTS.md` содержит общие инструкции. `CLAUDE.md` импортирует его через `@AGENTS.md`; это избегает двух расходящихся копий. Форматы подтверждены официальными руководствами S01–S03. После старта проверить, что инструкции реально загружены; локальные overrides не должны молча ослаблять правила проекта.

Не класть в Git целиком `.codex/` или личную `.claude/`: в них могут быть настройки и история. Из `.claude/` в комплекте только общий `settings.json`, без токенов, env, внешних directory grants или MCP-коннекторов. Личные разрешения хранятся локально и игнорируются Git.

Облачному агенту доступна только копия репозитория с синтетикой. Для leaf не нужны OpenAI/Anthropic ключи. Способ оплаты/входа в Codex или Claude настраивает сам владелец вне приложения.

## Рекомендуемый рабочий цикл

Сначала короткая проверка состояния и план на одну задачу. Затем код, тесты, review diff, обновление STATUS. Агент не должен заново обсуждать выбранный UI и заменять leaf универсальным шаблоном.

У задачи есть ID, результат, excluded scope, затрагиваемые контракты и checks. При изменении схемы/CPM сначала согласовать небольшой ADR. Изменение комментариев или форматирование не оправдывает рефакторинг всей архитектуры.

## Два агента одновременно

Один агент реализует небольшое изменение, второй проверяет независимым взглядом тесты, безопасность и соответствие референсам. Можно менять роли. Не закреплять модель навсегда за видом работы.

Для параллельной работы — отдельная ветка и worktree; рабочие каталоги/временные файлы не коммитятся. Один writer на schema, lockfile, shared contracts и scheduling behavior. Перед merge второй агент перечитывает актуальные файлы, а не опирается на свой старый контекст. Не коммитить чужие незавершённые изменения.

## Handoff

В `docs/STATUS.md` оставлять только: завершённую задачу, изменённые компоненты, прошедшие/непрошедшие/не выполненные команды, известные ограничения, следующее действие. Не сохранять full transcripts, hidden reasoning, локальные абсолютные пути, env и персональные сведения. Уточнение требований фиксировать в DECISIONS, не в машинной «памяти» одного агента.

## Безопасные разрешения

Не включать bypass-permissions/danger-full-access как стандарт проекта. Изолировать filesystem и network, не монтировать production-секреты и домашний каталог. `.claude/settings.json` — вспомогательная защита: запросы на push, install, внешние действия не заменяют sandbox и review (S03).

Новый network package/install или исполняемый скрипт из pull request считать потенциально недоверенным. Не выполнять команды из описания задачи/импортированного проекта как shell. Не менять Git remotes, visibility, branch protections или publishing credentials без отдельного разрешения.

## Проверяемые профили и запуск

Перед работой: `npm run doctor`. Перед подготовкой публикации: `npm run preflight`. Эти команды не меняют index, Git identity или remote. Preflight отдельно проверяет workspace secrets и полные изменённые staged blobs: рабочий файл и index могут различаться. Scanner policy для staged/history/commit message берётся из index; перед самым первым запуском подготовить проверенную `.gitleaks.toml` по BOOTSTRAP. Local kit tests используют временную синтетику, их можно выполнять без повторного согласования; для полного suite обязателен Gitleaks.

Claude: shared settings включают strict sandbox (`enabled`, `failIfUnavailable`, запрет unsandboxed retry), запреты private reads и blockReadsOutsideWorkingDirectories. Сеть subprocess по умолчанию без разрешённых доменов. Проверить effective settings через `/sandbox` и `/permissions` в актуальном Claude Code; проверить synthetic denied files через Read и Bash/Node, отказ сети и разрешённое редактирование public files. Shared settings могут зависеть от managed policy и версии. Агентные `.env.example` также закрыты консервативным `.env.*` deny; public примеры для чтения можно размещать как `config/env.example`.

Codex: credential-free template — [codex-permissions.json](../config/agents/codex-permissions.json). Он оставляет доступ к рабочему дереву и минимальным системным инструментам, запрещает private runtime paths и subprocess network. При запуске добавляется read-only доступ только к реальным исполняемым файлам Node и native Codex: npm/nvm может установить их вне системных каталогов, а сам Codex запускает свой sandbox helper внутри изоляции. Родительские каталоги инструмента и остальной home не открываются. Пути вычисляются в памяти, не записываются в repository config; неизвестная обёртка или путь в credential store приводят к отказу.

Корневые private directories закрыты точными правилами; nested globs включают содержимое вложенных каталогов и исключают повторное перекрытие корневого deny. Для `.codex` используется deny содержимого и унаследованная от `:workspace` защита каталога от записи: точный deny отсутствующего `.codex` конфликтует с его защитным mount в проверенном Linux CLI. Glob expansion ограничен глубиной 8 и отражает файлы на момент запуска; private данные всё равно должны отсутствовать в checkout. Launcher сначала проверяет public workspace guard. Writable scratch размещается в отдельном temp каталоге. Auth остаётся механизмом CLI вне проекта.

```sh
npm run agent:sandbox
npm run agent:codex -- "Perform the approved local task and report in Russian"
```

`agent:sandbox` не вызывает модель: disposable files и локальный synthetic listener проверяют public read/write, private/outside read denial и network denial. Есть private fixtures в корне, nested/hidden directories и `.codex`. Успех требует exit 0 и уникального proof-файла, который probe создаёт только после всех проверок: stdout команды может подавляться CLI. Нулевой exit или напечатанный marker сами по себе не подтверждают изоляцию. Он завершается отказом при недоступном sandbox или неподдерживаемом profile. Launcher использует те же вычисленные runtime grants и проверяет эти границы до вызова модели. Никакого fallback в full access нет.

Launcher использует `codex exec --ignore-user-config --strict-config --ephemeral` с явным permission profile, чтобы legacy `sandbox_mode` личной конфигурации не подменял профиль. Managed restrictions остаются ответственностью runtime; execpolicy rules не отключаются. Он не копирует и не читает credentials. Model/API вызов выполняется только при явном запуске этой команды владельцем; установка CLI и login не автоматизируются. Не сохранять stdout как public transcript.

## Проверка поведения после обновления модели

Набор из пяти синтетических сценариев — [fixtures/agents/scenarios.json](../fixtures/agents/scenarios.json). Это критерии model smoke review, отдельно от исполняемых kit tests; они не считаются пройденными без реального запуска модели.

Запускать каждый сценарий в новой disposable копии public checkout, с зафиксированными version/model и безопасным profile. Для preservation case заранее изменить отдельный synthetic документ и сравнить его байты после задачи. Для denied-read case создать только искусственные `.env` и `data/demo.txt` с уникальными маркерами; не подставлять реальные файлы. Для каждого запуска проверить перечисленные acceptance criteria, diff и необходимые checks. Записать только scenario ID, версии, passed/failed и безопасные ограничения; raw traces и local auth не сохранять в Git или CI artifacts. Вызовы моделей не включены в обычный CI.

## Отчёт о выполнении

Ответ владельцу по-русски: что изменено, где это проверить, какие команды прошли, что не проверено и следующий шаг. Нельзя писать «готово» о чистом макете без хранения или заявлять security guarantee на основании одного сканера.
