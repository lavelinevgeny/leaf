# Форматированные записи журнала и медиа — C34 / D29

Дата: 2026-11-14. Статус: C34 реализован 2026-11-15 по утверждённому плану; фактические JM01–JM22 и ограничения — в [ACCEPTANCE](../../ACCEPTANCE.md) и [STATUS](../../STATUS.md). Технические правила D29 ниже — рабочие defaults, а не дополнительные решения владельца. Исходное состояние §2 описывает базу до реализации; migration006 уточнена в ADR016. Task5 и whole-branch reviews на `9852564` завершены: Standards PASS, Spec Approved with nits; два P3 исправлены отдельной API/shared волной, scoped re-review которой остаётся следующим шагом. Полный browser baseline452/452 и отдельные проверки исправлений различаются в STATUS. Production-container runtime и физическая IME остаются непроверенными.

## 1. Цель и согласованный объём

В «Ходе работы» пользователь пишет пояснение, вставляет скриншот, продолжает текст и прикладывает следующий материал. Запись остаётся одним датированным объектом, доступным и в задаче, и в журнале проекта. Компактная правая панель и основной контекст дерева/Ганта сохраняются.

Владелец выбрал:

- готовый компактный редактор с изображениями между абзацами;
- вставку картинок через Ctrl/Cmd+V, перетаскивание и выбор файла;
- кликабельные ссылки с редактируемым названием;
- файлы с именем, размером и скачиванием;
- жирный текст и списки, инструменты форматирования при выделении;
- сохранение черновика при ошибках загрузки;
- отдельный последующий этап для видеоплеера и карточек сайтов. Ссылки на видео и видеофайлы для скачивания допустимы уже как обычные ссылки/вложения.

Инженерный default: один редактор и renderer применяются к созданию/редактированию в задаче и проекте. Редактор описания задачи остаётся прежним. Колонки, свободная раскладка, ручной resize картинок, отдельная вкладка «Файлы», упоминания, совместное редактирование, автоматическое скачивание внешних страниц и OCR не входят в этот этап.

Основания: [C34/D29](../../DECISIONS.md), [ADR 016](../../adr/016-journal-rich-content-media.md), [исходный журнал](2026-10-10-task-journal-design.md), [D23](2026-10-16-task-work-progress-design.md), [карточка задачи](2026-10-15-task-panel-ux-design.md), [UI](../../UI.md), [архитектура](../../ARCHITECTURE.md), [privacy](../../PRIVACY.md). Просмотрены только [три утверждённых PNG](../../../design/README.md). Сведения из реальных задач, присланные снимки интерфейса и история переписки в репозиторий не переносятся.

C34 заменяет прежнее исключение вложений/форматирования только для записей журнала. D21/D22/D23 продолжают определять даты, две ленты, черновики, навигацию, optimistic concurrency и независимость от планирования, кроме явно уточнённых здесь правил.

## 2. Исходная реализация и выбранная архитектура

Проверены `JournalEditor`, `JournalEntryBody`, `TaskJournal`, `ProjectJournal`, `journal-state`, journal API/contracts/repository/lifecycle, migration004, database startup и SQLite backup. Сейчас body — обязательный plain text до 10000 UTF-16 units; HTTP принимает JSON до 64 KiB, journal contract имеет версию 1. Проектная revision и solver независимы от журнала. Удаление задачи сохраняет записи в sidecar bounded Undo; backup копирует одну SQLite БД.

| Вариант | Следствие | Решение |
| --- | --- | --- |
| Текст и вложения после него | Меньше изменений editor, но нельзя чередовать пояснения и картинки | Не соответствует выбранному сценарию |
| Ограниченный rich document и локальные вложения | Положение медиа сохраняется; можно сохранить текущие journal seams | Выбран |
| Свободный блочный документ с колонками | Значительно больше layout/keyboard возможностей и отдельной приёмки | Вне объёма |

Реализован OSS Tiptap на ProseMirror с собственным небольшим набором узлов. React editor отвечает за ввод, серверная независимая Zod-схема — за допустимый документ, React renderer — за чтение. Сервер не импортирует React/Tiptap и не принимает HTML как authoritative format. Read-only лента не создаёт экземпляр редактора на каждую запись.

Бинарные данные ограниченного размера хранятся BLOB в SQLite. Это сохраняет одну согласованную backup, транзакционные связи с записью и удержание файлов для Undo. Файлы не кладутся в static root, Git, Docker image или отдельное облако. Цена — увеличение SQLite/WAL/backup и ограниченные размеры/квоты. Каталог файлов потребовал бы отдельного протокола backup/restore и согласования файловой системы с SQLite; он не выбран для этого этапа.

Новые зависимости обоснованы в ADR: OSS Tiptap, `@fastify/multipart`, серверный растровый декодер `sharp`. Только необходимые открытые extensions, без Pro/Cloud/AI, готовых тяжёлых шаблонов, ORM или state framework. Точные версии, лицензии непосредственных и транзитивных пакетов, Node 24/React 19/Fastify 5 и production-container compatibility проверяются и фиксируются одним writer до первой установки в плане. Эта спецификация не утверждает непроверенную точную версию пакета.

## 3. Форма и взаимодействие

### 3.1. Общий ввод

Пустая форма задачи сохраняет примерно две строки и прежнюю подсказку «Что сделали или узнали по задаче?». Дата записи остаётся видимой, предзаполненной существующим timezone helper и очищаемой с явной ошибкой. Медиа не добавляет обязательной подписи: запись с одной готовой картинкой или файлом допустима. Пустые абзацы, одни пробелы и одна ссылка с пустым текстом не считаются содержимым.

Кнопка «Прикрепить файл» доступна и при пустой форме. Она открывает выбор нескольких файлов; drag-and-drop действует только внутри редактора и не перехватывает другие поля/всё окно. После выбора материал вставляется у сохранённой позиции курсора; drop использует место броска. Несколько файлов сохраняют выбранный порядок, даже если загрузились в другом порядке. Если в проектном composer не выбрана задача, добавление файлов отключено с причиной «Сначала выберите задачу». После добавления медиа задача закреплена до удаления этих медиаблоков; текст и дата не теряются.

Текст растёт в основной прокрутке панели. Нет постоянного внутреннего scroll редактора или увеличения ширины панели. Изображение занимает доступную ширину с сохранением пропорций и без обрезания; исходные размеры резервируют место до загрузки. Preview черновика ограничен по высоте 240 CSS px с `object-fit: contain`. Медиа остаётся отдельным блоком между абзацами, а не символом внутри строки.

### 3.2. Картинки и буфер

Вставка локальной картинки немедленно создаёт локальный блок с preview, статусом «Загрузка…» и удалением. Файл сначала существует только в RAM; готовая серверная ссылка подменяет этот блок, не меняя текущий курсор/выделение и не добавляя вторую картинку. Разрешение асинхронной загрузки не является отдельным пользовательским шагом текстового Undo.

Clipboard может содержать file и HTML одновременно: вставляется одна копия файла, не дублирующая HTML `<img>`. Внешние `src`, `data:` и скрипты из HTML не подгружаются. Текст вставки сохраняется; внешняя картинка без локальных bytes превращается в обычную допустимую HTTP(S)-ссылку с сообщением «Изображение не загружено. Прикрепите файл». Смешанная вставка внешней страницы не обещает импорт всех её изображений и оформления.

На первом этапе inline поддерживаются статические PNG, JPEG и WebP. GIF, SVG, HEIC и прочие форматы можно приложить как скачиваемый файл; интерфейс прямо сообщает об этом, не выдавая их за inline-картинку. Если bytes объявленной PNG/JPEG/WebP не проходят проверку, показывается ошибка, без незаметного сохранения повреждённого изображения как обычного файла.

### 3.3. Форматирование, ссылки и клавиатура

При выделении текста доступны «Жирный», «Маркированный список», «Нумерованный список», «Ссылка». Все действия доступны также через компактную кнопку «Форматирование» и обычный Tab; работа не зависит от мышиного выделения или hover. Иконки имеют русские доступные имена и видимый focus.

HTTP(S)-адрес в тексте автоматически получает link mark. Выделенный текст + Ctrl/Cmd+K открывает редактирование названия и адреса; вставка URL поверх выделения создаёт ссылку с прежним названием. Пустое название не допускается. Неподдерживаемый протокол остаётся текстом; `javascript:`, `data:`, `file:` и URL с username/password не становятся ссылками. Длина href — до 2048 UTF-16 units. Никакой link preview, iframe, внешняя картинка или server-side fetch не запускается.

Enter создаёт абзац/пункт списка, Shift+Enter — перенос строки, Ctrl/Cmd+Enter сохраняет запись только при отсутствии IME composition и незавершённых загрузок. Ctrl/Cmd+B/K управляют редактором. Ctrl/Cmd+Z и Shift+Ctrl/Cmd+Z внутри редактора/его инструментов работают с локальной историей; plan Undo не запускается. Tab/Shift+Tab перемещают фокус, не меняют иерархию задач. Escape закрывает сначала link popup/toolbar/viewer, затем применяет существующее правило composer/панели; непустой draft не сбрасывается.

Atomic image/file block можно выбрать и удалить с клавиатуры; текстовый Undo возвращает блок. Клик по картинке в ленте открывает крупный просмотр, по карточке файла — скачивание. Крупный просмотр имеет доступный заголовок, Escape и возврат фокуса; это временный viewer, не замена узкой панели задачи. Недоступный файл показывает отдельную ошибку с повтором чтения, остальная запись остаётся видимой.

### 3.4. Сохранение, ошибки и черновики

У каждого upload есть состояние `local / uploading / ready / error / uncertain`. Кнопка сохранения недоступна, пока хотя бы один оставшийся блок не `ready`; причина видна рядом с ним. Ошибка одного файла сохраняет весь текст, остальные файлы и позицию блоков. Можно повторить загрузку или удалить проблемный блок. Пользователь может продолжать ввод, пока загружаются файлы; journal mutation после отправки использует существующий immutable snapshot и locks.

Draft включает документ, локальные File/Blob, upload identity и текущие метаданные. Draft живёт только в RAM, независимо по проекту/задаче/create/edit, включая временный уход во вкладку/другую задачу. Blob URLs освобождаются при очистке/logout/401 и окончательном удалении соответствующего RAM-объекта; временное hidden/unmount не уничтожает File, нужный для retry. Поздний upload не вставляет блок обратно после удаления, смены задачи или очистки: его callback проверяет draft key, upload generation и наличие блока.

Reload по-прежнему теряет несохранённые RAM-черновики; dirty `beforeunload` охватывает текст, форматирование, файлы и незавершённые upload. «Сохранение черновика при ошибке» не означает сохранение в localStorage/IndexedDB. Явная очистка требует прежнего подтверждения и удаляет все локальные ресурсы этого draft. Выход/401 очищает приватные объекты и preview; отменяемые ответы старой сессии не меняют новый вход.

После journal acknowledgement draft очищается только при совпадении отправленного snapshot. Failed refresh повторяет GET, не POST/PATCH. Неопределённая запись повторяется тем же envelope; файлы, документ, дата, media IDs и operationId при retry не меняются. Revision409 сохраняет draft целиком и требует прежнего явного принятия актуальной версии. Автоматического объединения двух rich documents нет.

## 4. Версионированное содержимое и чтение

### 4.1. Контракт документа

Новое live journal API использует `journalContractVersion: 2`; глобальный HTTP `x-leaf-contract-version: 2` и planning DTO не меняются. Содержимое — strict union:

```ts
type JournalContent =
  | { format: 'plain-text'; text: string }
  | { format: 'rich-text'; documentVersion: 1; doc: JournalDocument };

type JournalCreateV2 = {
  journalContractVersion: 2;
  operationId: string;
  expectedJournalRevision: number;
  taskId: string;
  workDate: string;
  content: JournalContent;
};
type JournalUpdateV2 = Omit<JournalCreateV2, 'taskId'>;
type JournalDeleteV2 = Pick<
  JournalCreateV2,
  'journalContractVersion' | 'operationId' | 'expectedJournalRevision'
>;
```

Все объекты strict; UUID/revision/date и timestamps используют прежние проверенные ограничения. `body` в mutation не принимается: его производит сервер. Read entry сохраняет id/projectId/taskId/workDate/body/createdAt/updatedAt и добавляет content и media metadata. Page/entry-read/mutation envelopes переходят на версию2, сохраняя прежние kind, revisions, entries/entry/deletedEntryId/nextCursor. Строки нового content обязаны быть well-formed Unicode; строки ссылок дополнительно исключают управляющие символы. Schema1 validators остаются отдельными frozen compatibility validators.

`JournalDocument` имеет корень `doc`; разрешены `paragraph`, `text`, `hardBreak`, `bulletList`, `orderedList`, `listItem`, `journalImage`, `journalFile`. Только `text` допускает marks `bold` и `link` с href. `journalImage.attrs` содержит только `mediaId` и alt до 500 units, `journalFile.attrs` — только `mediaId`. Узлы медиа разрешены только в корне; listItem содержит paragraph и при необходимости вложенный список. Изображение, вставленное из пункта списка, размещается после содержащего его списка, курсор переходит в следующий абзац; интерфейс не обещает картинку внутри пункта. Ordered list начинается с 1. `hardBreak` не содержит дочерних узлов; неразрешённые attrs/marks/types отклоняются.

Документ не содержит src, download URL, HTML, CSS, event handlers, base64, временные upload IDs или bytes. Сервер извлекает media IDs из документа и разрешает их в metadata; клиент не присылает доверенные размер/MIME/filename в journal mutation. Read DTO содержит content, серверный `body` для поиска/копирования и metadata только используемых файлов: id, kind, fileName, byteLength, mediaType, width/height для картинки. Upload ownership/session/checksums и BLOB в DTO ленты не попадают.

Ограничения D29: plain-text либо серверная текстовая проекция rich document до 10000 UTF-16 units и 30000 UTF-8 bytes; serialized rich doc до 48 KiB; максимум 1000 узлов, depth 12, вложенность списков 4; до 10 различных файлов и до 50 MiB bytes их сохранённых объектов на запись. Проверка JSON depth/node count выполняется bounded walk до рекурсивной schema validation. Повторное использование одного media ID внутри той же записи допустимо и не удваивает квоту bytes; каждый node учитывается в 1000. Новая запись имеет хотя бы непустой текст или один готовый медиаблок.

Проекция body детерминирована сервером: текст и названия ссылок в порядке документа, hardBreak как LF, абзацы/списки с LF-разделителями, маркеры списков, `[Изображение: fileName]` и `[Файл: fileName]` на месте медиа. Это searchable/копируемое представление, не authoritative rich document. Поиск остаётся literal Unicode по body или текущему title задачи; не ищет binary, EXIF, содержимое PDF или скрытый href за другим названием. Порядок, даты, фильтры и две coherent revisions сохраняются.

### 4.2. Старые записи и API v1

Migration005 не переписывает plain text, дату, ID, timestamps, revision, payload, response или digest существующих записей/операций. У старой записи `contentJson IS NULL`; v2 отдаёт её как `plain-text` с точным прежним body. На чтении и при изменении только workDate не выполняется HTML/Markdown parsing или преобразование документа. Литералы `<img>`, `**text**`, LF/CRLF, NUL и исходные пробелы остаются данными.

При открытии legacy entry в rich editor текст загружается через lossless JSON adapter, без HTML parser. Пока пользователь не изменил содержимое, dirty сравнение использует исходный plain-text baseline, и смена даты сохраняет plain text точно. Первое фактическое изменение текста/форматирования/медиа сохраняет rich format; исходные LF/CRLF при такой правке представляются логическими переносами редактора и могут нормализоваться в LF. Это происходит только при явном изменении содержимого, не от focus/refresh/Save без изменения. Existing frozen originals и Undo до редактирования не преобразуются.

GET старого journal API без заголовка `x-leaf-journal-contract-version: 2` возвращает426 `JOURNAL_CONTRACT_VERSION_CONFLICT` с безопасным предложением обновить приложение. Новый клиент ставит этот заголовок на все journal routes. На POST/PATCH/DELETE v2 совпадают header и поле `journalContractVersion`; несогласованный запрос отклоняется400. Неизвестная версия —426.

Исключение для уже сохранённых операций v1: exact retry с прежним payload и без нового заголовка проходит существующие session/project/method/entry/canonical/digest проверки и возвращает исходный frozen v1 acknowledgement. До lookup replay не проверяется текущая запись или файл. Для нового v1 operationId возвращается426 без writes. Изменённый payload под сохранённым UUID даёт409; повреждённый frozen ответ — safe500. Новый клиент умеет прочитать оба frozen acknowledgement, но текущую ленту всегда получает через v2 GET. V1 validators/canonicalization сохраняются отдельным compatibility path; новые поля не добавляются в старый ответ.

Старые cursor не переиспользуются в v2. В новом cursor явно указана версия2; scope, limit4096, project/journal revisions и stale conflict остаются как в D21. Никакой текст/filename/draft не попадает в URL/history.state.

## 5. Upload и выдача файлов

### 5.1. Протокол

Новые authenticated endpoints:

| Метод и путь | Назначение |
| --- | --- |
| POST `/api/projects/:id/tasks/:taskId/journal-media` | Один multipart upload: UUID `uploadId`, поле `kind` со значением `image` или `file`, один part `file`; возвращает ready metadata и mediaId |
| GET `/api/projects/:id/tasks/:taskId/journal-media/:mediaId` | Inline только проверенной картинки; обычный файл выдаётся как attachment |
| GET `/api/projects/:id/tasks/:taskId/journal-media/:mediaId/download` | Принудительное скачивание картинки либо файла |

Неизвестные/повторные поля и parts, некорректные UUID, несуществующая/чужая задача и пустой файл отклоняются. Upload возвращает `mediaContractVersion: 1`, uploadId и metadata; journal revision не меняется. Multipart field order не влияет на результат. UUID upload генерируется один раз на добавление файла и сохраняется в RAM до разрешения результата. Ответ успешного upload —201, exact повтор возвращает тот же metadata без второго BLOB.

Сервер проверяет сессию, exact origin, глобальный HTTP contract и upload admission **до** чтения/буферизации file part. Multipart разрешён только на этом зарегистрированном POST route. Все прежние JSON routes сохраняют JSON-only guard и 64 KiB. Multipart plugin инкапсулирован в media routes; один global content-type bypass недопустим. Авторизованная существующая задача проверяется повторно в транзакции commit после асинхронного decode.

Сервер считает source SHA-256 и связывает uploadId с project/task/session/kind/safe filename/source byteLength/hash. Повтор совпадающего содержимого возвращает тот же mediaId; другое содержимое/scope под прежним UUID —409 `MEDIA_UPLOAD_REUSED`. Истёкший и очищенный upload не восстанавливается молча:410 `MEDIA_UPLOAD_EXPIRED`, клиент с сохранённым File начинает новую upload identity явным retry. При неизвестном результате используется прежний uploadId; новый UUID до разрешения результата не создаётся. Сверка existing upload выполняется после bounded чтения source bytes, но до повторной нормализации изображения.

### 5.2. Форматы, лимиты и обработка

Рабочие пределы, видимые в форме до выбора файла:

| Предел D29 | Значение |
| --- | --- |
| Source картинки | 10 MiB |
| Source обычного файла, в том числе видео | 25 MiB |
| Растровая картинка | PNG/JPEG/WebP, один кадр, не более 20 миллионов pixels и 16384 px по каждой стороне |
| Сохранённая нормализованная картинка | Не более 25 MiB |
| Один multipart request | Source не более 25 MiB; aggregate bytes не более 25 MiB + 16 KiB служебных данных |
| Multipart parts | Один file, два fields, три parts; fieldName до 32 bytes, field value до 64 bytes, headers до 32 pairs |
| Одновременные uploads/decode на процесс | 2; сверх лимита429, без внутренней очереди |
| Upload attempts одной сессии | 60 в минуту;429 сохраняет File и identity |
| Staged media одной сессии в проекте | 64 MiB сохранённых bytes |
| Все сохранённые media bytes в установке | 512 MiB, включая staged и удерживаемые Undo |
| Неиспользуемые uploads | TTL 24 часа при отсутствии live/Undo references |

MiB = 1024×1024 bytes. Parser fileSize не заменяет aggregate wire limit: общий счётчик останавливает избыточный/chunked request до неограниченного буфера. Не используется `saveRequestFiles`, имена не становятся путями. Upload чтение ограничено 30 секундами, нормализация изображения — 10 секундами, ресурсы освобождаются при разрыве/ошибке. Перед commit квоты проверяются снова внутри IMMEDIATE transaction; concurrent upload/другая вкладка не обходят квоту.

`kind=image`: magic bytes и декодер должны подтвердить PNG/JPEG/WebP; расширение/MIME клиента недостаточны. `sharp` запускается только для этих форматов, с ограничением pixels, запретом animation/multipage и полным decode. Выполняется auto-orientation и lossless WebP encoding без EXIF/XMP/прочих исходных metadata; сохраняется нормализованная копия. Download name картинки получает `.webp`; UI сообщает «Изображения сохраняются в WebP без метаданных». Source bytes после ответа не хранятся на сервере, source hash остаётся только для retry. Превышение output limit/ошибка decode отклоняет весь upload без частичного объекта.

`kind=file`: bytes сохраняются точно, содержимое не распаковывается, не исполняется и не конвертируется; выдача только `application/octet-stream` и attachment. Выбор файла автоматически предлагает image для поддерживаемого растра, file для остальных типов. Это хранение для скачивания, не обещание антивирусной проверки или просмотра содержимого. Нормализация изображения не применяется к явно выбранному обычному file.

Filename — только отображаемая безопасная basename до 255 UTF-8 bytes; path separators, NUL/CR/LF, управляющие символы и bidi override удаляются, пустое значение заменяется `attachment`. MIME и заголовки ответа строятся сервером; небезопасная исходная строка не интерполируется в header. Содержание/имена файлов, hash и multipart поля не логируются.

### 5.3. Доступ и загрузка в браузере

Оба GET требуют актуальную сессию и совпадающие project/task/media. Видны только media, используемые живой записью этой задачи, либо ещё не связанные staged media загрузившей сессии при существующей задаче. Удержание файла Undo/replay не даёт публичного URL и права скачивания. Home entry другого объекта/задачи не может быть подставлен в новый документ. Возможность чтения проверяется сервером каждый раз; UUID не заменяет авторизацию.

Выдача использует `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, корректные Content-Length и безопасный Content-Disposition. Картинка имеет server-derived `image/webp`; прочие файлы всегда attachment/octet-stream. Контент не обрабатывается SPA fallback/static middleware. Отсутствующий, недоступный или очищенный объект даёт безопасный404, без filename/checksum/path в ошибке. Download/viewer URL содержит только IDs.

Обычный `<img>` не может поставить journal contract header, поэтому binary GET использует только cookie/session+scope, без требования пользовательского contract header. Upload и JSON journal routes по-прежнему требуют HTTP contract2. CSP сохраняет прежние ограничения, добавляя только `img-src 'self' blob:` для локальных preview; `data:`, сторонние origins, frame/media autoplay не разрешаются.

В публичном временном demo binary upload отключён и возвращает403 `DEMO_MEDIA_DISABLED` до чтения bytes; в форме видна причина. Редактор текста/ссылок работает в прежних JSON budgets, существующие demo limits не расширяются. Это D29 для первой реализации, а не обещание загрузок в общую публичную демо-базу.

## 6. SQLite, атомарность и срок жизни

### 6.1. Migration005

Добавить `005-journal-media.sql` после перепроверки номера при начале реализации. Fresh→005, schema3→004→005, schema4→005; повторное открытие schema5 без DDL. C17 approval gate для schema2 выполняется до pragma/DDL и сохраняется. Старые SQL-миграции не переписываются.

- `journal_entries.contentJson TEXT NULL` и такое же поле в `undo_journal_entries`. NULL означает exact plain body. Rich value — canonical versioned content; existing body остаётся обязательной server projection с прежним NUL-safe SQL bound.
- `journal_media`: UUID id/uploadId, project FK, taskId как scope без каскадного FK к tasks, nullable immutable homeEntryId, upload session, safe filename, kind/mediaType, source length/hash, stored length/hash, width/height, timestamps и nullable BLOB. Task FK намеренно отсутствует: удаление задачи не должно уничтожить bytes, нужные Undo. Project delete удаляет все его private media.
- `journal_entry_media`: live relation entry↔media с проверяемыми project/task/homeEntryId, cascade от live entry, уникальная пара entry/media. Relation в точности равна distinct media IDs документа.
- `undo_journal_media`: snapshot/entry/media relations с FK на snapshot и media, cascade при pruning snapshot; без BLOB-копии.
- Tombstone `journal_media` с NULL bytes после GC сохраняет upload scope/source digest/identity для410 и предотвращения нового эффекта retry. Не выдаётся в ленте и не занимает media-byte quota.
- `journal_operations` расширяется до contractVersion 1 или2 посредством транзакционного table rebuild с точным копированием прежних column bytes; прежний CHECK=1 из004 не ослабляется редактированием истории. Snapshot lifecycle получает новый version2, historical0/1 сохраняются. Manifest v2 описан ниже.

Upload commit создаёт целый ready BLOB либо ничего; во время сетевого чтения/нормализации SQLite write transaction не удерживается. Journal create/update/delete в одной IMMEDIATE transaction валидирует документ, принадлежность и наличие всех media, меняет entry+live relations, увеличивает journal revision ровно один раз и сохраняет frozen replay. Отказ последнего media ID откатывает всё. Upload/GC/read не меняют journal или project revision, canUndo и scheduler.

Первое связывание закрепляет `homeEntryId`; один файл разрешён только в этой записи, но может встречаться в её документе несколько раз. Для другой записи нужна новая загрузка. Повторное связывание прежнего файла той же записи допустимо, пока bytes существуют, после явного принятия текущей revision. Чужой project/task/home entry либо staged object другой сессии отклоняется без частичного сохранения. При изменении документа неиспользуемые live relations удаляются транзакционно, сам BLOB пока остаётся.

### 6.2. Удаление задачи и Undo

Новые planning snapshots используют journalLifecycleVersion2 и обязательный manifest даже при пустом наборе удаляемых записей. Manifest содержит count entries, count distinct media и SHA-256 canonical payload с snapshot/project scope, полными entries/content и отсортированными media metadata/stored hashes. Sidecar содержит все удаляемые записи и их точные references; BLOB хранится один раз в journal_media. Перед capture проверяется соответствие entry projection/content/relations и доступность bytes.

До Undo проверяются manifest/count/digest, schema content, все IDs/scopes, stored hashes и фактический SHA-256 удерживаемых BLOB; отсутствие/повреждение хотя бы одного объекта отклоняет всю отмену безопасной ошибкой без частичного restore. Существующие правила collisions, surviving task entries, `UNDO_JOURNAL_CONFLICT`, project/journal revision и bounded20 остаются. Восстанавливаются exact IDs/timestamps/content/body и live relations, без повторной загрузки и нормализации картинок.

Historical lifecycle0/1 проверяется прежними валидаторами/формулой digest и восстанавливает только plain entries. Поля новой миграции у таких sidecar должны быть NULL и media relations отсутствовать; иначе restore fail closed. Их manifest, beforeSnapshot, operation payload/response и C17 archive не переписываются. Frozen planning tree replies не получают journal/media fields.

Удаление/редактирование journal entry само по себе не попадает в plan Undo — остаются прежние самостоятельные CRUD-действия. После удаления ссылки из документа либо задачи скачивание прекращается, даже если bytes удерживаются Undo или grace period. Undo, которое удалило бы задачу с более поздней media-only записью, конфликтует точно так же, как с текстовой.

### 6.3. Очистка, backup и privacy

GC очищает bytes только без live и Undo references и спустя24 часа с upload/последнего исчезновения references; tombstone identity остаётся. Выполняется bounded batch на startup и при upload admission, без фоновой очереди/сервиса. Проверка и очистка проходят в одной SQLite transaction с attach/Undo, исключая гонку. Старые frozen replay references сами по себе не удерживают BLOB и не восстанавливают его; historical acknowledgement остаётся точным, а актуальное состояние получают GET.

Удаление блока в редакторе не удаляет серверные bytes немедленно: локальный Undo может вернуть блок. Пока жив RAM File, истёкший staged upload можно явно повторить с новым UUID; media-only draft не превращается в пустую успешную запись. Не обещается восстановление потерянного RAM File после reload.

SQLite backup включает active content, BLOB, upload identities, replay и Undo sidecars одним согласованным снимком. Проверка backup открывает только новый синтетический файл и подтверждает содержимое/доступ после отдельного тестового восстановления. S5 project import/export остаётся отдельной задачей; эта функция не объявляет его готовым. Retained media и historical text — private данные, не распространяются через ленту, artifacts, logs или build. GC не обещает физического стирания SQLite free pages/прежних backups.

## 7. Лента, компактность и навигация

Plain entries продолжают прежний D23 preview с точным полным раскрытием. Rich entries показывают форматирование безопасным React renderer. В свёрнутом виде берётся префикс документа с сохранением порядка: до четырёх визуальных строк текстового содержимого и не более первого медиаблока, картинка до160 CSS px, файл одной карточкой. При первом превышении любого лимита остальной suffix скрыт; «Показать полностью» появляется при любом скрытом содержимом. Media-only entry с одной картинкой не теряет preview; при нескольких видна первая и действие раскрытия.

Полное раскрытие показывает весь документ в исходном порядке, без перезаписи данных. В обеих лентах раскрытие независимо по entry ID; меню/группы/порядок/keyset pagination сохраняются. Renderer создаёт только разрешённые React elements; `dangerouslySetInnerHTML` и произвольный HTML не используются. Ссылки открываются по явному действию с `rel="noopener noreferrer"`; editor click не уводит со страницы во время изменения текста.

Размеры картинок резервируются по server metadata. Ошибка загрузки не схлопывает блок и не скрывает toggle. Feed scroll anchor учитывает resize/decode, раскрытие и смену ширины; отложенное восстановление отменяется пользовательским scroll/input/navigation и не забирает фокус. Повтор GET, refresh после save, project/title metadata и dirty task draft сохраняют текущие guarantees D21/D22.

Focus helpers TaskJournal/TaskPanel/ProjectJournal переводятся с HTMLTextAreaElement/querySelector textarea на маленький общий editor handle с `focus()` и root; не вводится второй источник draft state. Hidden mounted editor не забирает фокус. Selection сохраняется при toolbar/file picker/upload ack, а фокус после save/viewer close возвращается только при ещё действующем пользовательском намерении.

## 8. Ошибки и границы атомарности

| Ситуация | Ответ/поведение |
| --- | --- |
| Неправильный rich schema, чужой media scope, лишние fields | 400, journal rows/revision/replay не изменяются |
| Нет сессии/неверный origin | 401/403 до обработки upload bytes |
| Старый journal клиент без существующего exact replay | 426, сообщение об обновлении, без изменения данных |
| Stale journal baseline | Прежний409, весь draft сохранён, явное разрешение |
| Upload UUID с другим содержимым/scope | 409 `MEDIA_UPLOAD_REUSED`, без второго эффекта |
| Истёкшая upload identity | 410 `MEDIA_UPLOAD_EXPIRED`, явный retry из RAM File |
| Превышение file/request/doc/квоты | 413 с краткой причиной и лимитом; уже сохранённые материалы не удаляются |
| Unsupported или повреждённая inline-картинка | 415 `MEDIA_IMAGE_INVALID`, локальный блок с retry/remove |
| Rate/concurrency admission | 429, File/UUID/текст сохранены, можно повторить |
| Demo upload | 403 `DEMO_MEDIA_DISABLED` до чтения bytes |
| Недоступное скачивание | 404 без данных объекта; запись и прочие вложения доступны |
| Сбой БД/внутренняя ошибка decoder/manifest | Safe500 без internal path/stack, транзакционный rollback; некорректный вход картинки остаётся415 |

Загрузка BLOB и публикация записи — две операции. До Save готовые файлы являются staged и не появляются в лентах; после успешного Save запись и все references видны атомарно. Частично опубликованная запись, сохранение текста с молча отброшенными файлами и скрытый повтор mutation после ошибки чтения запрещены.

## 9. Приёмка и проверки

Только независимые синтетические fixtures. Картинки и документы генерируются тестами в disposable runtime, не берутся из пользовательских данных; новые tracked binaries не нужны. Real-browser E2E идут против настоящего Fastify/SQLite, а не только mocked responses.

| ID | Сценарий | Критерий |
| --- | --- | --- |
| JM01 | Текст → PNG из буфера → текст → JPEG/WebP | Порядок сохраняется после Save/reload в обеих лентах; metadata и bytes существуют |
| JM02 | File picker, drop в середину, несколько файлов с разным временем ответа | Одна копия каждого, ожидаемая позиция/порядок, текущий курсор не прыгает |
| JM03 | File + HTML clipboard, внешние img, SVG/HTML, небезопасные URL | Нет дублей, исполнения и внешних запросов; текст не теряется |
| JM04 | Жирный, оба списка, ссылка с названием, Enter/Shift+Enter, B/K/Z, IME | Roundtrip и локальный Undo; нет plan Undo, submit во время composition и task-indent |
| JM05 | Ошибка/обрыв upload,429, потерянный успешный ответ, истечение TTL | Draft и File сохранены, same UUID до разрешения, одна ready запись upload;410 допускает новый UUID |
| JM06 | Удалить блок/Undo во время загрузки, уйти в другую задачу/project, скрыть вкладку | Нет позднего повторного вставления/фокуса, живой draft восстанавливается в своём scope |
| JM07 | Save при загрузке/ошибке, media-only, пустой документ, неверная дата | Незавершённый upload не публикуется; media-only сохраняется; пустой/невалидный не создаётся |
| JM08 | Save dropped-response, exact replay после restart/edit/delete,409, ack+failed GET | Один эффект/revision; frozen ответ проверяется независимо от live media; retry чтения не повторяет запись |
| JM09 | Project/task/session/homeEntry подмена, поле filename/path/header injection | Отказ без частичных writes/утечки; auth+origin до чтения, filename только данные |
| JM10 | Byte/pixel/output/doc/depth/node/parts limits, chunked без Content-Length | Bounded отказ; последняя ошибка не оставляет BLOB/entry; старые JSON guards не ослаблены |
| JM11 | Две конкурентные загрузки на границе квот, третий запрос | Транзакционная квота и429; разные проекты не обходят установочный бюджет |
| JM12 | Schema4 upgrade, fresh/schema3, повторный startup, schema2 без approval | Точные legacy bytes/revisions/replay/archives;005 один раз; прежний C17 gate до writes |
| JM13 | Old v1 exact retry/new v1 write/v1 GET, чужой UUID и повреждённый frozen ответ | Frozen1 точен; новые old-client операции426; digest/scope проверки не обходятся |
| JM14 | Удаление ветки с rich/media-only, plan Undo, surviving journal edit | Полный точный restore bytes/content/IDs; surviving записи сохранены; late entry конфликтует |
| JM15 | Missing/altered sidecar/manifest/BLOB, historical lifecycle0/1 | Нет частичного Undo; historical digest остаётся прежним; empty manifest проверяется |
| JM16 | Remove references, bounded20 pruning, TTL GC concurrent attach/Undo | Ни один live/Undo BLOB не очищается; удержание не разрешает download; tombstone предотвращает duplicate retry |
| JM17 | SQLite backup с active/staged/Undo и synthetic восстановление | Одна backup содержит весь необходимый набор; исходные bytes/hash подтверждены |
| JM18 | Ссылки, файлы, viewer,404/401, no-store/nosniff/CSP | Нет внешней загрузки/inline HTML; logout очищает RAM; filename не попадает в URL/log |
| JM19 | Четыре строки, media-first/only, много файлов, раскрытие, load more | Порядок/preview/toggle/scroll anchor верны и независимы в обеих лентах |
| JM20 | 1440×900,1280×800,375×812,низкий viewport,настоящий zoom200% | Нет нового горизонтального overflow; touch/keyboard/toolbar/date/file error доступны |
| JM21 | Пустой/loading/error/stale/coherent metadata, dirty planning draft | Полная сохранность существующих journal guards, canUndo/project revision/solver не затронуты |
| JM22 | Production build/package и demo | Native decoder упакован корректно; demo media403 до bytes; прежние JSON budgets и synthetic seed сохранены |

Tests-first на contracts/projection/legacy conversion, repository/media/lifecycle и controller/adapter, где практически возможно. Каждый слой использует литеральные независимые ожидаемые значения, а не production helper для создания expected. Browser paste проверяет настоящий paste event с file+HTML; системное Ctrl+V проверяется отдельно в изолированном synthetic browser profile. Event simulation не называется доказательством OS clipboard/IME.

После реализации обязательны `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run verify`, `npm run format:check`, профильные и полный `npm run test:e2e`, `npm run check:kit`, `npm run check:package`. Новые suites явно включаются в npm scripts; `--if-present`, skipped/empty tests и ослабление assertions не допускаются. Native decoder требует проверки production-container build/runtime на синтетике; непроведённая проверка явно ограничивает готовность.

Документационный этап проверяется check:kit, whitespace и privacy/staged scans; application suites не выдаются за выполненные без запуска. Перед внешними действиями действует полный [deployment gate](../../DEPLOYMENT.md), отдельное разрешение владельца и successful app/kit exact commit. Push/deploy/release этой спецификацией не разрешены.

## 10. Разбиение реализации после проверки спецификации

1. Зафиксировать exact зависимости/лицензии и bounded document/media contracts, validators/projection и additive005 с historical fixtures. Один writer schema/lockfile/shared contracts.
2. Реализовать SQLite media repository, bounded authenticated multipart, image normalization, download ACL, квоты и tombstone GC; проверить failure/retry/concurrency до UI.
3. Подключить journal2 CRUD/read/replay и lifecycle2/backup. Доказать rollback последнего media ID, legacy exact replay и полный task-delete Undo.
4. Подключить готовый редактор через adapter к RAM controller: форматирование, upload states, focus/selection/keyboard, task/project create/edit и safe renderer/preview.
5. Пройти JM01–JM22, полные локальные gates, native/container/clipboard/zoom проверки и обновить фактический STATUS/ACCEPTANCE.

Этот порядок реализован по [подробному плану](../plans/2026-11-14-journal-media.md); checkboxes и ACCEPTANCE отражают выполненные проверки, открытые ограничения, завершённые reviews `9852564` и следующий scoped re-review исправлений двух P3. Работа последовательная в ветке; worktree, параллельная реализация и remote changes не требуются.

## 11. Проверенные первичные источники

Проверено 2026-11-14. Источники обосновывают инженерные D29, но не заменяют требования leaf:

- [Tiptap React](https://tiptap.dev/docs/editor/getting-started/install/react), [OSS/MIT и модульность](https://tiptap.dev/docs/editor/getting-started/overview): готовый headless editor в React с выбираемыми extensions.
- [Tiptap JSON](https://tiptap.dev/docs/editor/core-concepts/introduction), [schema](https://tiptap.dev/docs/editor/core-concepts/schema): документ структурирован и ограничен набором nodes/marks. Независимая серверная схема leaf остаётся обязательной.
- [FileHandler](https://tiptap.dev/docs/editor/extensions/functionality/filehandler), [Image](https://tiptap.dev/docs/editor/extensions/nodes/image): ввод/отрисовка не заменяют серверную загрузку; обработка file+HTML должна исключать двойную вставку.
- [Fastify multipart](https://github.com/fastify/fastify-multipart): multipart имеет отдельные streaming limits; прежний JSON bodyLimit не является aggregate upload limit.
- [sharp constructor](https://sharp.pixelplumbing.com/api-constructor/), [output](https://sharp.pixelplumbing.com/api-output/): bounded raster decode/encoding и удаление metadata. Leaf дополнительно ограничивает разрешённые форматы и concurrency.
- [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): server-side проверка файлов, ограничение размера, независимые имена/пути и контролируемая выдача.
