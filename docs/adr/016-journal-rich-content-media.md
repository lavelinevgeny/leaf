# ADR 016 — форматированные записи и локальные вложения журнала

Дата: 2026-11-14. Статус: предложено как D29 для выбранного владельцем C34; до реализации требуется проверка [спецификации](../superpowers/specs/2026-11-14-journal-media-design.md).

## Контекст

Журнал schema4 содержит plain-text записи с независимой revision и durable replay. Владелец выбрал компактный готовый редактор, картинки между абзацами через буфер/drop/file picker, ссылки с названием, скачиваемые файлы, жирный текст и списки. Ошибки upload не должны терять draft. Видеоплеер и карточки сайтов выделены в следующий этап.

Текущие journal operations, legacy snapshots/replies и exact body bytes нельзя переписать при миграции. Удаление задачи уже сохраняет журнал в bounded plan Undo. Существующий backup копирует одну SQLite БД. Расширение не должно запускать scheduler или менять planning revision/DTO.

## Решение

1. OSS Tiptap/ProseMirror только в клиентском editor adapter; выбираемый ограниченный набор nodes/marks. Сервер использует независимую strict Zod-схему versioned JSON, лента — безопасный React renderer. Произвольный HTML не принимается/не исполняется. Отдельный editor instance на запись ленты не создаётся.
2. Live journal contract2 хранит plain-text или rich content и серверную поисковую projection. Старые rows остаются plain с точным body; преобразование начинается только при фактической правке содержимого. Новый контракт не добавляет поля в historical v1 replay. Устаревший клиент получает426, кроме exact retry уже сохранённой v1 операции.
3. Ограниченные BLOB, metadata, upload identity и active/Undo relations находятся в одной SQLite. Новая005 аддитивна для entries/sidecars; rebuild journal_operations только расширяет CHECK версии, сохраняя старые bytes. Upload не изменяет journal revision; Save публикует content и references одной IMMEDIATE transaction.
4. Multipart реализуется `@fastify/multipart` в отдельном media scope с auth/origin/admission до чтения, явными part/file/aggregate limits. Глобальный JSON-only guard и64 KiB остальных routes сохраняются.
5. Статические PNG/JPEG/WebP проходят bounded server decode `sharp`, auto-orientation и lossless WebP encoding без исходных metadata. Остальные файлы хранятся как opaque bytes и скачиваются только attachment/octet-stream. Нет server fetch внешних картинок/страниц, iframe или video transcoding.
6. UploadId обеспечивает exact повтор в project/task/session с source digest. Media привязывается к одной home entry. Tombstone после GC возвращает410 вместо повторного эффекта. Historical acknowledgement не является правом download и не удерживает bytes само по себе.
7. Lifecycle2 сохраняет document/media references и manifest с digest/count. Один BLOB удерживается active или bounded Undo reference; перед restore проверяется и фактический hash bytes. Historical lifecycle0/1 остаются на прежних digest validators. Несоответствие отклоняет всю отмену.
8. RAM controller остаётся единственным владельцем черновиков, File/Blob, upload generation и immutable pending request. Contenteditable требует явного editor handle вместо textarea-specific focus helpers; локальный Undo не становится Undo плана. Browser persistent storage для приватного draft не появляется.

Полные proposed limits, API/error contracts, download ACL, TTL/квоты, demo media403 и JM01–JM22 определены спецификацией. Это рабочие инженерные значения, не новые C-решения.

## Альтернативы

- Plain text с файлами под ним дешевле, но не обеспечивает выбранное чередование текста и картинок.
- Свободные блоки/колонки и полный Notion-подобный UX расширяют задачу сверх журнала.
- Редактор с нуля переносит на leaf курсор, DOM selection, clipboard, history и IME; готовый ограниченный редактор уменьшает эту работу.
- HTML storage потребовал бы отдельной sanitation/rendering политики и хуже ограничивает допустимый документ. Leaf принимает структурированный JSON, независимо проверяемый сервером.
- Файлы на диске уменьшили бы размер БД, но потребовали бы нового согласованного backup/restore протокола и компенсаций между SQLite и filesystem. Для ограниченных вложений выбран один transactional store.
- Base64 в body/replay раздувает JSON и20 snapshots; binary отделён от документа и historical acknowledgements.
- Cloud upload/editor services противоречат self-hosted/offline scope и не требуются.

## Последствия и проверка

Появляются зависимости редактора, streaming parser и native decoder; exact versions/licenses/Node24/React19/Fastify5 и production-container compatibility проверяются до установки и фиксируются lockfile. Платные registry, runtime облако, AI API и telemetry не используются. `sharp` увеличивает packaging/runtime объём; Docker build/runtime нельзя считать проверенными по одному Vite build.

Размер SQLite/WAL/backup растёт; D29 ограничивает file/entry/staged/install budgets. Операционная очистка не гарантирует физическое удаление старых страниц и backups. Journal CRUD Undo не добавляется: прежние edit/delete остаются самостоятельными.

Продуктовый выбор C34 уже сделан; этот ADR и спецификация пока не означают готовую функцию, одобренные technical defaults или изменение production storage. Следующий шаг — проверка спецификации владельцем, затем implementation plan и реализация с JM01–JM22 и штатными gates. Никаких remote действий этим ADR не разрешено.
