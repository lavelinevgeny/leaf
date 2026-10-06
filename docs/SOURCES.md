# Технические источники

Проверено при подготовке комплекта: 2026-10-06. Это ссылки на первичные публичные документы, а не часть пользовательских требований. Агент проверяет актуальные версии перед установкой; неизвестные patch-версии не выдумывает.

| ID | Источник | Для чего |
|---|---|---|
| S01 | [OpenAI: AGENTS.md](https://developers.openai.com/codex/guides/agents-md) | Общие инструкции Codex; область действия project files. |
| S02 | [Claude Code: memory / CLAUDE.md](https://code.claude.com/docs/en/memory) | Импорт `@AGENTS.md`, единый источник правил. |
| S03 | [Claude Code: settings](https://code.claude.com/docs/en/settings), [permissions](https://code.claude.com/docs/en/permissions) | Shared/local конфигурация и ограничения permission rules. |
| S04 | [Node.js releases](https://nodejs.org/en/about/previous-releases) | Проверка поддерживаемой LTS-линии. |
| S05 | [Vite guide](https://vite.dev/guide/) | Совместимость среды и сборка SPA. |
| S06 | [Fastify docs](https://fastify.dev/docs/latest/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | HTTP-сервер и SQLite-драйвер. |
| S07 | [SQLite Online Backup API](https://www.sqlite.org/backup.html) | Согласованное копирование живой базы. |
| S08 | [Princeton Algorithms: CPM implementation](https://github.com/kevin-wayne/algs4/blob/master/src/main/java/edu/princeton/cs/algs4/CPM.java) | Базовая precedence-constrained модель CPM на DAG. Дополнительная семантика leaf описана отдельно. |
| S09 | [Git: gitignore](https://git-scm.com/docs/gitignore) | Ignore не удаляет уже отслеживаемые файлы. |
| S10 | [GitHub: push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection) | Серверная защита известных секретов. |
| S11 | [GitHub: secure use of Actions](https://docs.github.com/en/actions/reference/security/secure-use) | SHA-pinning, минимум прав и недоверенный код. |
| S12 | [Gitleaks](https://github.com/gitleaks/gitleaks), [release v8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), [go.mod](https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/go.mod) | Stdin/history scans, redaction и точный module path dev-инструмента. |
| S13 | [OWASP: Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | Параметры хеширования проверить при реализации входа. |
| S14 | [actions/checkout v6.1.0 commit](https://github.com/actions/checkout/commit/d23441a48e516b6c34aea4fa41551a30e30af803), [setup-node v6.5.0 commit](https://github.com/actions/setup-node/commit/249970729cb0ef3589644e2896645e5dc5ba9c38) | Закреплённые внешние Actions в комплекте. |

Выбор React/Vite/Fastify/SQLite и правила leaf — инженерные рекомендации этого комплекта. Они не означают, что приложение уже построено, прошло тестирование или получило независимый аудит. Изображения взяты только из выбранных в разговоре сгенерированных концепций; оригинальный screenshot сайта Quire в архив не включён.
