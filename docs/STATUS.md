# Статус разработки

## Подготовка локального коммита видимости FS-связей — 2026-10-08

Подготовлены 13 файлов отображения FS-связей при неполных датах: Gantt, строки/CSS, client/browser tests и документация. Отдельная запись аудита публикации/Render сохранена в рабочем файле вне index; код при подготовке не менялся.

PASS на закреплённом runtime: `verify` (typecheck/lint, 756/756 unit/integration tests, production build), `format:check`, `check:kit`, `check:package`, профильный actual-server E2E (38/38, два viewport, без skips/retries), `git diff --check` и полный `preflight` (52/52 kit tests, workspace/index/history и metadata scans). Полный E2E, Docker smoke и sandbox probe повторно не запускались. Push/deployment/publication не выполнялись. Следующий шаг — проверка повседневного сценария владельцем, затем S4–S6.

## Видимость FS-связей при неполных датах — 2026-10-08

Сохранённые зависимости теперь видны на Ганте между условными полосами и между реальной и условной полосой, включая завершённого предшественника. Геометрия использует те же отображаемые интервалы, что полосы; условная связь отличается пунктиром и подписью. Перекрывающиеся интервалы обходятся у начала successor, чтобы полоса не закрывала наконечник. Стрелки появляются только после acknowledgement; collapse/filter и концы вне периода скрывают их. Summary и несохранённый preview исключены. Source/null поля, серверные FS/summary/CPM, API и схема не менялись.

Изменены Gantt, строки/CSS, client/browser tests, UI/DECISIONS/ACCEPTANCE и уточнения C19/C24. Пять независимых вариантов регрессии сначала подтвердили отсутствие стрелки, затем прошли. Browser проверяет связь завершённой работы с бездатной подзадачей, две условные полосы, no-ack, удаление, reload/undo и отсутствие изменений исходных задач. Синтетические captures обоих viewport просмотрены вне checkout. Существующий jsdom-тест reveal стабилизирован управляемым animation frame и явной проверкой scrollIntoView: первая общая проверка выявила отсутствие этого browser API, финальный запуск прошёл без необработанных ошибок.

PASS: `verify` — typecheck/lint, 756/756 unit/integration tests в 42 файлах, production build; `format:check`, `check:package`, `check:kit`, `security:workspace`, `git diff --check`. Профильный actual-server E2E `fs-dependencies` + `conditional-gantt` — 38/38 в 1440×900 и 1280×800 без skips/retries.

Не запускались: полный E2E, preflight, Docker smoke и sandbox probe. Index и прежние незакоммиченные изменения сохранены; commit/push/deployment/publication не выполнялись. Следующий шаг — проверка повседневного сценария владельцем, затем продолжение S4–S6.

## Подготовка локального коммита C24 — 2026-10-08

В коммит подготовлены 43 файла FS-зависимостей: клиент, чистый каскад, серверные команды, tests, спецификация, план и ADR 011. Несвязанная запись аудита публикации/Render сохранена в рабочем файле вне index. Код при подготовке не менялся.

PASS повторно в корневом checkout: `verify` (typecheck, lint, 751/751 unit/integration tests, production build), `format:check`, `check:package`, `security:workspace`, полный `preflight` (52/52 kit tests с настоящим Gitleaks, workspace/index/history и metadata scans), staged whitespace check. E2E повторно не запускались; предыдущие 118/118 и ограничения приведены ниже. Следующий шаг — S4 доска/статусы/undo; push/deployment/publication не выполнялись.

## FS-зависимости — финальное review и корневая интеграция, 2026-10-08

Реализованы C24/D17: единый поиск «После окончания» при создании основной задачи и подзадачи, в Details, из строки списка и полосы Ганта. Связь независима от родства; сервер атомарно переносит зависимые исходные сроки, пересчитывает существующий CPM и критичность родителей. Одна команда и одна undo охватывают связь, каскад и расчёт. Пустые даты сохраняются; условные значения Ганта не используются как реальные сроки.

Три независимых варианта и три независимых выбора завершены. Отдельно подготовленные [спецификация](superpowers/specs/2026-10-08-fs-dependencies-design.md) и [план](superpowers/plans/2026-10-08-fs-dependencies.md), каждая implementation task и весь feature diff прошли независимые review с исправлениями и scoped повторной проверкой. Итог: spec compliant, quality Approved, открытых замечаний нет. Реальные browser регрессии закрепили Enter после поиска, неперекрывающиеся кнопки, видимый keyboard selection, динамический размер picker и сохранение прежнего окна быстрых сроков.

PASS в основном checkout: `verify` — typecheck, lint, 751/751 unit/integration tests в 42 файлах и production build; format:check, check:package, security:workspace; полный preflight — doctor, check:kit, 52/52 kit tests с настоящим Gitleaks, workspace/index/history и metadata guards/scans. На побайтово совпадающем feature-кандидате полный actual-server E2E прошёл 118/118 в 1440×900 и 1280×800, включая 32 новых FS проверки, без skips/retries. Повторять тот же browser набор после точного переноса не требовалось. Синтетические captures просмотрены вне checkout. Проверка полного feature range на whitespace прошла после удаления трёх пробелов в пустых строках плана.

Изменения перенесены из изолированного worktree; исходная несвязанная запись STATUS сохранена дословно, индекс не менялся. Прежний отказ workspace guard на служебном linked-worktree `.git` pointer устранён применением обычного корневого gate, без изменения политики. Промежуточный таймаут остановки синтетического сервера не повторился в финальном полном E2E; timeout/retries не ослаблены. Текущих failed checks нет. Docker smoke, sandbox probe и remote CI не запускались; push/deployment/publication не выполнялись.

Ограничения D17: leaf-only FS одного проекта, лаг 0, перенос в обе стороны только для tight-цепочки, зазор сначала поглощает задержку, сохранённого anchor нет. Done не переносится автоматически; необходимый поздний перенос через done и явный конфликт исходных сроков отклоняют всю команду. Следующая продуктовая работа — S4 доска/статусы/undo, затем S5 restore/import/export и S6 приёмка; первый релиз остаётся незавершённым.

## FS-зависимости — Task 3, синтетическая приёмка и handoff, 2026-10-08

Добавлена actual-server browser приёмка C24/D17: 16 сценариев в каждом из 1440×900 и 1280×800. Основной и дочерний QuickAdd сохраняют nullable даты, очищаемую длительность и выбранные FS одним command/revision; отдельные drafts и фокус сохраняются. Details принимает канонические weekday даты и clean baseline; список/условный Гант используют existing immediate edge commands без открытия панели или изменения условных source дат. Проверены hidden duplicate paths вне фильтров, nested Escape, dirty guards, empty/search/no-ack, 20 keyboard candidates и рост 12 chips у нижнего края. Настоящие source/done/cycle/calendar failures и stale 409 сохраняют draft/IDs и snapshot; потерянный после server apply ответ повторяется exact envelope одним outcome.

Literal §6.1 проверяет смену критичной ветки P/Q, H и оба резерва, summary общего R, одну точную undo и restart с исходными nullable полями/edge IDs. Historical infeasible UI остаётся отдельным preexisting synthetic snapshot без скрытого repair; frozen/exact assertions прежнего explicit-cpm сохранены. В compact-workspace прежний conflict fixture подготовлен явно только в disposable БД; исходные diagnostic/geometry/undo assertions сохранены.

Приёмка выявила и закрепила регрессиями три локальных UI-исправления: Enter выбирает первый найденный predecessor без внешнего submit, chain не перекрывается кнопкой подзадачи, успешный acknowledgement сохраняет прежнее открытое окно быстрых сроков и возвращает title focus. DECISIONS/SCHEDULING/UI/ACCEPTANCE/START_HERE и статус spec/ADR согласованы: C24 фиксирует только порученный объём, D17 — рабочий causal push/tight pull без anchors; C16 остаётся чистым анализом, каскад выполняется только записью перед ним. Схема, migrations, lockfile, security policy и три утверждённых PNG не изменялись.

PASS: финальный `verify` — typecheck/lint, 751/751 unit/integration tests в 42 файлах, production build; format:check, check:package, check:kit, doctor; test:kit 52/52 с настоящим Gitleaks; staged/history guards и Gitleaks. Полный финальный E2E — 118/118 в двух viewport, включая 32/32 новых FS сценария и сохранённые historical/frozen controls, без skips/retries. Synthetic captures просмотрены вне checkout; traces/video/retry выключены.

FAILED: linked-worktree workspace guard — PERSONAL_HOME_PATH в инфраструктурном `.git` pointer; политика/pointer не изменены. Ordinary workspace/preflight назначены финальному integrator gate в корневом checkout после независимого review. Один промежуточный browser teardown graceful-shutdown отказ не повторился в следующем полном прогоне; timeout/retries не увеличены. Не выполнялись Docker smoke, sandbox probe, remote CI, push/deployment/publication.

Ограничения: leaf-only FS, лаг 0, strict nullable/done/direct-edit отказ и отсутствие сохранённого anchor — рабочий D17; missing dates не создаются из parent/today/display. Независимые Task 3/final reviews и корневой preflight впереди. Следующее продуктовое действие — S4 доска/статусы/undo, затем S5 restore/import/export и S6 приёмка; первый релиз не объявлен завершённым.

## Подготовка локального коммита C23 — 2026-10-08

Подготовлены изменения шапки, переключателя и множественных фильтров C23, светлая обводка условных полос толщиной 0,75 px, соответствующие tests и документация. Предшествующая несвязанная запись аудита публикации/Render исключена из коммита и сохранена в рабочем файле. Application checks приведены в записях C23 и возврата оформления выше по истории этого журнала; код при подготовке не менялся.

PASS: preflight на закреплённом runtime — doctor, check:kit, 52/52 harness tests с настоящим Gitleaks, workspace/index/history и metadata guards/scans. Публикация и deployment не выполняются; следующий шаг — продолжение S4–S6.

## Возврат оформления условных полос — 2026-10-08

По запросу владельца отменён точечный вариант: возвращены сплошная заливка `#dbe8df`, светлая обводка `#a9bfb0`, толщина 0,75 px и пунктир 4/3. SVG pattern и связанный fill удалены; Gantt и browser-ожидание preview возвращены к состоянию до точечного оформления. UI обновлён, остальные незакоммиченные изменения сохранены.

PASS: production build, format:check, профильный browser E2E conditional-gantt/inline-add — 6/6 в двух desktop viewport, check:kit и diff whitespace. Общие unit/integration, полный E2E и Docker smoke для возврата оформления не повторялись. Следующий шаг — визуальная проверка владельцем; S4–S6 остаются незавершёнными.

## Точечная обводка и заливка условных полос — 2026-10-08

Обводка условных полос и preview быстрого ввода заменена круглыми точками толщиной 1 px: SVG stroke 0/3 с round linecap. Сплошная заливка заменена редким светлым SVG pattern на прозрачном фоне; pattern ID уникален для экземпляра Ганта. Геометрия, фокус, действия и данные сохранены. Изменены Gantt, CSS, действующее browser-ожидание оформления preview и UI/STATUS; предыдущие изменения сохранены.

PASS: `verify` — typecheck, lint, 661/661 unit/integration tests в 38 файлах, production build; format:check; профильный browser E2E conditional-gantt/inline-add — 6/6 в двух desktop viewport, без skips/retries; check:kit, check:package, workspace guard и diff whitespace. Дополнительная синтетическая Chromium-проверка подтвердила stroke 1 px, round linecap, точечный контур и pattern fill; capture просмотрен вне checkout. Полный E2E-набор и Docker smoke для декоративной правки не повторялись. Следующий шаг — визуальная проверка владельцем; S4–S6 остаются незавершёнными.

## Светлая обводка условных полос Ганта — 2026-10-08

В `.gantt-work.conditional` толщина пунктира уменьшена с 1,5 до 0,75 px, цвет осветлён с `#5d836a` до `#a9bfb0`. Условные полосы и preview быстрого ввода меньше выделяются; заливка, геометрия, пунктир 4/3 и клавиатурный focus outline сохранены. Изменены только два CSS-значения и эта запись; прежние незакоммиченные изменения сохранены.

PASS: production build, format:check, профильный browser E2E — 6/6 в 1440×900 и 1280×800 (conditional-gantt/inline-add), check:kit и diff whitespace. Синтетический capture просмотрен вне checkout. Новых тестов для двух декоративных значений не добавлялось; общие unit/integration и полный E2E не повторялись. Поведение, scheduler/API и данные не изменялись. Следующий шаг — визуальная проверка владельцем; backlog S4–S6 сохраняется.

## Шапка, иконки и множественные фильтры — C23, 2026-10-08

Реализовано уточнение C23: встроенные SVG отмены/поиска/фильтров и переключателя «Список / Гант», мягкое зелёное выделение активного вида, кнопка фильтров с постоянной шириной и бейджем выбранных статусов. Popover под кнопкой перекрывает правую область Ганта, не сдвигая строки. Статусы выбираются чекбоксами со счётчиками задач проекта; черновик применяется одной кнопкой «Применить». Общий чекбокс различает полный, частичный и пустой набор. Escape, внешний клик и уход фокуса отменяют неприменённые изменения; «Применить» возвращает фокус на кнопку, общий сброс — в поиск. Поиск пересекается с объединением статусов; родительский контекст и общие строки дерева/Ганта сохраняются. C23/D16 записаны в DECISIONS/UI/START_HERE; прежняя спецификация C22 помечена в части фильтров как историческая.

Изменены client-компоненты, чистая фильтрация, CSS и соответствующие unit/browser tests. Сервер, scheduler/API, исходные даты, CPM, revision и undo не меняются от фильтров; это проверено полными синтетическими снимками и отсутствием write-запросов. Зависимости, lockfile и три утверждённых PNG не менялись. Исходная несвязанная запись STATUS сохранена.

PASS: `verify` — typecheck/lint, 661/661 unit/integration tests в 38 файлах и production build. После финальной правки формы SVG отдельно прошли typecheck, lint, build и format:check. Профильные client tests — 24/24. Новое browser-покрытие нескольких/пустого набора, явного применения, отмены черновика, фокуса и неизменности снимка — 2/2 в двух desktop viewport. Финальный полный E2E PASS — 86/86 в 1440×900 и 1280×800, без skips/retries. Актуальных failed checks нет. Check:kit, check:package, workspace guard и diff whitespace прошли.

Синтетические captures просмотрены, хранятся вне checkout. Геометрия сохраняется с допуском 1 px, высоты заголовка/toolbar/строк и scrollTop не меняются при действиях вида/фильтров. Промежуточные browser-отказы вызваны запуском прежней сборки, сравнением server-порядка с порядком дерева, устаревшим ожиданием текстового undo и локатором с неизменным именем кнопки фильтров; ожидания исправлены под действующее поведение без ослабления проверок данных или геометрии.

Не выполнялись Docker smoke, удалённый CI, commit/push/deployment/release. Фильтры даты/исполнителя не входят в это уточнение. Следующий шаг — проверка обновлённого рабочего экрана владельцем и продолжение S4 (доска O03/статусы/undo); S5–S6 и первый релиз остаются незавершёнными.

## Стабильные виды и компактные фильтры — C22, 2026-10-08

Обновлены [спецификация C22](superpowers/specs/2026-10-08-stable-view-controls-design.md), DECISIONS/UI/C20/START_HERE и [план](superpowers/plans/2026-10-08-stable-view-controls.md). Реализация выполнена отдельными агентами в изолированных worktree с последовательным изменением общих компонентов; каждую задачу и итоговое изменение проверили независимые reviewers. Финальные verdicts: spec PASS, quality APPROVED, открытых замечаний нет.

Чекбокс заменён двумя кнопками «Список / Гант» с доступным активным состоянием. Общие дерево, заголовок и toolbar сохраняют высоту, DOM редактора, выбор, раскрытие, фильтры, черновики и прокрутку. Постоянная дата периода удалена; полная дата «Сегодня» по timezone проекта доступна при наведении и фокусе. Статус/общий сброс перенесены в popover; поиск и отдельная очистка текста остаются в шапке. Счётчик существующей filterTasks расположен внутри toolbar, нулевой результат — в области задач. Клавиатура, внешний клик, отменённое нажатие, loading и смена проекта проверены. Исправлена гонка Escape в настройках: локальная синхронная проверка не позволяет закрыть dirty-диалог до обновления родительского состояния.

PASS: финальный `verify` — typecheck, lint, 657/657 unit/integration tests в 38 файлах, production build. Полный E2E — 84/84: по 42 сценария в 1440×900 и 1280×800, два последовательных запуска configured projects, без skips/retries. `format:check`, `check:kit`, `check:package`, workspace guard и diff whitespace прошли. Первый preflight прошёл 52/52 harness tests с настоящим Gitleaks и workspace/index/history/metadata scans; финальные staged/history guard/Gitleaks и подготовленный diff также прошли. Все локальные commit hooks включены.

Синтетические browser captures просмотрены, хранятся вне checkout. Первая строка на 185,5 px; toolbar 44 px, заголовок 58 px, строки 38 px. Геометрия сохраняется в допуске 1 px с панелью и длинным названием; scrollTop 400 и горизонтальное положение шкалы восстанавливаются. Действия вида/фильтров не дают API-записей, полный серверный снимок/revision/source dates/CPM/undo остаётся прежним. Сервер, схема, scheduler/API, зависимости, lockfile, security policy и три утверждённых PNG не менялись.

Промежуточные отказы воспроизведены регрессиями и исправлены: потеря фокуса редактора при настоящем клике, фокус исчезающих scale/filter/QuickSchedule полей, Shift+Tab и отменённый pointer-переход. Первый полный browser run дал 81/82 из-за гонки dirty-настроек; команда завершилась SIGTERM при наличии полного отчёта. После исправления финальные два запуска прошли. Активных failed checks нет. Не повторялись Docker smoke и sandbox probe. Несвязанная исходная запись аудита сохранена отдельно от коммита. Push/deployment/release не выполнялись. Следующий шаг — проверка повседневного сценария владельцем и продолжение S4 (доска O03/статусы/undo); S5–S6 и первый релиз остаются незавершёнными.

## Финальные исправления C22 — 2026-10-08

Переключение «Список / Гант» из поля даты или длительности открытых быстрых сроков теперь передаёт фокус на выбранную кнопку: закрывающееся окно исключено из защиты фокуса постоянных редакторов. Название и план быстрого ввода сохраняются без записи. Диалог настроек проекта получает признак изменённого черновика при вводе и проверяет его синхронно при Escape, поэтому черновик остаётся открытым даже до следующего обновления родительского состояния. Сервер, API, календарные правила, схема, undo и зависимости не менялись.

RED: новый браузерный тест обоих размеров окна выявил потерю фокуса на «Список»; новый компонентный тест подтвердил закрытие диалога при запаздывающем родительском dirty. GREEN: профильные client tests 31/31, browser E2E `view-controls` + `planning-ui` 12/12 в двух размерах, typecheck, lint и production build. Полный E2E и общие публикационные проверки остаются задачей финальной интеграции. Следующий шаг — общий verify и полный браузерный прогон C22, затем продолжение S4–S6.

## Центрирование значков быстрого ввода — 2026-10-08

В основном вводе QuickAdd шрифтовые плюс, галочка и крестик заменены встроенными SVG 16×16 с одинаковой толщиной линий. Кнопки подтверждения/отмены сохраняют 30×30 px, имеют одинаковые скругления и цвет обводки; центр значка совпадает с центром кнопки. Плюс расположен по центру круглой обводки 20×20 px. Общие CSS-правила теперь выравнивают видимые значки независимо от метрик системного шрифта.

PASS: `verify` (typecheck, lint, 646/646 tests, production build), `format:check`, `check:kit`, профильные E2E ввода (2/2 в двух viewport). Отдельная синтетическая Chromium-проверка измерила размеры и центры всех трёх SVG при viewport 1440/1280 px, стандартной/минимальной ширине дерева и пустом/заполненном названии; снимки визуально просмотрены вне checkout. Не повторялись: полный E2E, preflight, Docker smoke и sandbox probe. Несвязанная запись аудита остаётся вне коммита. Следующий шаг — проверка повседневного сценария владельцем и продолжение S4–S6.

## Пропорции кнопок и подготовка коммита C21 — 2026-10-08

Исправлены стили основного быстрого ввода: кнопки подтверждения и отмены имеют квадрат 30×30 px, не сжимаются во flex-строке и центрируют значки. Плюс занимает круг 20×20 px; фокус меняет цвет обводки без изменения размеров. В синтетическом Chromium проверены оба viewport (1440 и 1280 px) и минимальная ширина дерева 300 px; размеры измерены, снимки визуально просмотрены вне checkout. В коммит включены изменения C21 и это исправление; несвязанная запись аудита сохранена в рабочем файле отдельно от index.

PASS: `verify` (typecheck, lint, 646/646 unit/integration tests, production build), `format:check`, `check:kit`, `check:package`, `doctor` (11/11), профильные E2E ввода/условного Ганта/компактного пространства (10/10 в двух viewport), `preflight` (52/52 harness tests с настоящим Gitleaks, workspace/index/history/metadata scans). PASS: окончательный staged diff (`--check`) и 21 подготовленный blob (`security:staged`, guard/Gitleaks); локальные hooks включены. Использованы закреплённые Node/npm и только синтетические данные.

Не повторялись: полный E2E, Docker smoke и sandbox probe. Следующий шаг — проверка повседневного сценария владельцем, затем продолжение S4; S5–S6 остаются незавершёнными.

## Ввод задач в строке — C21, 2026-10-08

Реализован основной ввод в общей строке дерева/Ганта. «+ Подзадача» появляется при наведении и фокусе; Shift+Enter открывает ввод, прежние Insert/Shift+Insert сохранены. Tab/Shift+Tab меняют уровень только в названии. Alt+D открывает компактное окно сроков с одним чипом, пресетами «Сегодня», «Завтра», «До пятницы», «Как у родителя» при известных сроках, редактируемой длительностью и связанным вводом C18. Сброс очищает сроки; явная отмена основного ввода возвращает фокус к исходной строке. Undo в шапке стал иконкой с доступным именем и tooltip, заменив подпись C20.

Черновик показывается приглушённым пунктиром даже с полным выбранным интервалом; при открытии или изменении сроков размещение вне видимой области показывается на шкале. Сохранённые конечные задачи с неполным интервалом тоже пунктирные по C19. Preview использует чистые helpers, не меняет серверное дерево, coverage, сводные сроки, FS или CPM. Сохранение, exact retry и undo используют прежнюю атомарную API-команду; отдельные основной и panel drafts сохранены. Сервер, схема, API-контракт, зависимости и security policy не менялись. У панели подзадач общий чип/окно сроков; Gantt preview относится к основному вводу.

Изменены App, QuickAdd, новый QuickSchedule и presentation helpers, TaskTree/Timeline/Gantt, компактный вариант PlanFields, TaskPanel disabled state, строки/CSS, client/browser tests, UI/DECISIONS и [план](superpowers/plans/2026-10-08-inline-task-add.md). Исходная несвязанная запись аудита в этом файле сохранена.

PASS: финальный `verify` — typecheck, lint, 646/646 unit/integration tests в 38 файлах, production build. Полный Chromium E2E — 78/78, двумя отдельными запусками по 39 tests в 1440×900 и 1280×800, без skips/retries. После финальной правки показа черновика вне области повторены verify 646/646 и профильные E2E 18/18 для ввода/условного Ганта/дерева/фильтров. Синтетические capture в обоих размерах визуально просмотрены и остаются вне checkout. Форматирование, kit/reference/fixture checks, package boundary, workspace guard и diff whitespace прошли.

Промежуточные failures: отсутствующий Shift+Enter воспроизведён тестом; исправлены jsdom fallback для popover, восстановление фокуса после удаления и конфликт доступного имени preview с input. Старые ожидания подписи undo и постоянно открытых полей после retry заменены проверками нового UI с сохранением assertions по source/revision/exact payload/undo/restart. Первый общий browser run завершён SIGTERM без итогового отчёта; причину не установили. Два финальных запуска по viewport прошли. Актуальных failing checks нет.

Не запускались: Docker smoke, независимое агентское ревью, test:kit, sandbox probe и публикационные staged/history/preflight checks для этой правки. Index, commit, push, deployment и release не выполнялись; использованы только синтетические данные. Следующий шаг — проверка повседневного сценария владельцем и продолжение S4 (доска O03/статусы/undo); S5–S6 и первый релиз остаются незавершёнными.

## Подготовка коммита уточнения C20 — 2026-10-08

В локальный коммит подготовлены 14 файлов согласованной компоновки: UI, связанные client/browser tests и документация. Код при подготовке коммита не менялся; результаты application checks приведены ниже.

PASS: preflight на закреплённых Node/npm (doctor 11/11, check:kit, 52/52 harness tests с настоящим Gitleaks, workspace/index/staged/history/metadata checks), git diff --cached --check. Индекс содержит только файлы этой задачи; изображения, runtime storage и приватные данные не добавлялись. Push, deployment и release не выполнялись. Следующий шаг — проверка компоновки владельцем; S4–S6 остаются незавершёнными.

## Уточнение компоновки C20 — 2026-10-08

Удалён повтор «Задачи» над деревом. Переключатель Ганта объединён с управлением шкалой, доступен при выключенной диаграмме и сохраняет клавиатурный фокус. Меню настроек/переименования перенесено к выбранному проекту слева; длинные названия сокращаются с полным accessible name и tooltip. Подписанная кнопка «↶ Отменить» находится в шапке перед поиском с прежними блокировками. Кнопка `?`, текст, состояние и стили локальной помощи Ганта удалены. Общая справка пока не реализована. Изменены App, ProjectSidebar, TaskTimeline, strings, CSS, существующие client/browser tests и документы C20; сервер, scheduler/API, schema и зависимости не менялись.

PASS на закреплённом runtime: verify (typecheck, lint, 641/641 unit/integration tests, production build); affected E2E 32/32 в двух viewports. После финальных правок ширины меню повторно прошли typecheck, lint, build и focused E2E 12/12. Также PASS: format:check, check:kit, check:package, security:workspace и git diff --check. Первая строка дерева на 182,5 px вместо 228,5 px, горизонтального переполнения нет. Проверены границы меню, Enter/Space/Escape/Tab, фокус переключателя, dirty/retry/conflict, rename/undo/restart, фильтры и согласованность строк дерева/Ганта. Финальные синтетические снимки экрана и открытого меню визуально просмотрены; файлы остаются вне checkout.

Дополнительная browser-проверка сначала обнаружила выход меню на 13 px за левую границу; ширина исправлена без ослабления проверки. Первоначальный lint обнаружил неиспользуемый import удалённого теста помощи; import удалён. Актуальных failed checks нет. Полный E2E-набор, Docker smoke и независимое ревью не запускались. Коммит, push, deployment и release не выполнялись. Следующий шаг — проверка обновлённой компоновки владельцем; основная задача доски O03 и незавершённые S4–S6 сохраняются.

## Выравнивание формы переименования — 2026-10-08

Поле названия занимает всю ширину диалога. Основная кнопка и «Закрыть» расположены в общем правом ряду под полем; удалена унаследованная нижняя граница формы. Сообщение о несохранённом черновике и явный сброс расположены выше действий, поэтому кнопки сохраняют выравнивание после ввода. Изменены только ProjectControls и app.css, серверное поведение не менялось.

Проверено на закреплённом runtime: `verify` PASS (typecheck, lint, 641/641 unit/integration tests, production build), `format:check` PASS. Финальный focused E2E PASS — 6/6 для настроек, переименования, retry/conflict и undo в 1440×900 и 1280×800. Первый запуск дал один FAIL при Escape в форме настроек; три отдельных повтора и повтор всего выбранного набора прошли. Причина единичного сбоя не установлена, стабильность этого сценария требует наблюдения.

Дополнительная синтетическая browser-проверка PASS: обе кнопки имеют высоту 37 px и одинаковую координату Y в чистой и изменённой форме, поле шириной 398 px; горизонтального переполнения нет. Проверены Tab/Shift+Tab, защита dirty Escape, явный discard, clean close, возврат фокуса и неизменность серверного дерева. Четыре снимка сохранены вне checkout, чистая и изменённая формы визуально просмотрены. `check:kit`, `security:workspace` и `git diff --check` PASS. Полный E2E-набор, Docker smoke и независимое ревью этой правки не запускались. Следующий шаг — проверка формы владельцем; основной backlog S4–S6 сохраняется.

## Компактное рабочее пространство — C20, 2026-10-08

Обновлены DECISIONS, UI, SCHEDULING, ACCEPTANCE, START_HERE и прежние optional-scheduling спецификации. [План C20](superpowers/plans/2026-10-08-compact-workspace.md) реализован тремя отдельными агентами в изолированных worktree; все task reviews и scoped fix reviews приняты. [Спецификация](superpowers/specs/2026-10-08-compact-workspace-design.md) сохраняет scheduler/API и выбранные три PNG.

Убрана постоянная сводка дат/CPM. Меню проекта открывает компактные настройки и переименование; формы сохраняют черновики, ошибки, exact retry и conflict reload. Поиск/статус компактны, сброс условный, undo остаётся постоянной кнопкой. Actionable diagnostics показываются у затронутых строк и подробно в панели; отсутствие дат не является предупреждением. Ready/partial/frozen пояснения и различные critical labels сохранены. Помощь Ганта открывается по запросу. Длинное название сокращается визуально без потери доступного имени; native modal и меню сохраняют фокус. Сервер, domain scheduler, API/DTO, схема, миграции, lockfile, зависимости и security policy не менялись.

Финальный root verify PASS: typecheck/lint, 641/641 unit/integration tests в 37 files, production build. Format:check и check:package PASS. Новые browser checks 4/4 и affected 20/20 PASS в двух viewports; первый ряд 228,5 px, видны 15/12 полных строк, overflow отсутствует. Полный tree/revision/canUndo не меняется от представления, writes=0; сохранение настроек, реальный 409/reload, exact retry потерянного ответа, rename/undo/restart, Tab/Escape и collapse/filter alignment проверены. Четыре финальных синтетических capture просмотрены root и агентом, остаются вне checkout.

Полный root test:e2e PASS — 76/76 в 1440×900 и 1280×800 без skips/retries. После последней правки только browser assertions повторены typecheck/lint/format; application code и прошедшие 641 unit/integration tests не менялись. Check:kit, check:package, test:kit 52/52 с настоящим Gitleaks, doctor и workspace/history checks PASS. Итоговый независимый whole-change review: spec PASS, quality APPROVED, замечаний нет; все task/fix reviews также приняты.

Первоначальный полный browser run дал 74/76 из-за прежних global-label expectations; они заменены проверками локальных индикаторов и панели с сохранением API/source/revision/undo/restart assertions. Единичный промежуточный timeout остановки синтетического сервера не повторился в covering 8/8 и финальном полном 76/76; harness и таймауты не менялись. CW01 spacing, visibility cleanup и menu Escape defects исправлены, порог 230 px не ослаблен. Workspace guard первоначально отклонил временные worktree внутри checkout; они перенесены за его пределы без изменения защитной политики, повтор прошёл. Актуальных failed checks нет. Docker smoke, sandbox probe, push/deployment/release не выполнялись. Следующая продуктовая задача — проверка доски O03 и её статусы/undo; S4–S6 и первый релиз остаются незавершёнными.

## Фавикон из логотипа — 2026-10-08

`src/client/favicon.svg` теперь использует тот же знак `❧` и системный стек шрифтов, что и логотип в sidebar. Фон прозрачный, зелёный цвет взят из предоставленного образца. Конкретная форма глифа зависит от системного шрифта, как и в логотипе. Обновлён хеш public-assets; ранее проверенная версия сохранена в historicalAssets.

PASS: `npm run build`, `npm run format:check`, `npm run check:package`, `npm run check:kit`, `npm run security:staged`, `git diff --cached --check`; Chromium загрузил production SVG с серверной CSP в размерах 16/32/64/128 px, preview просмотрен. Полные application suites и Docker build не запускались для замены статического значка. Push/deployment не выполнялись. Следующая продуктовая задача — проверка доски O03.

## Фавикон — 2026-10-08

В `index.html` подключён локальный `src/client/favicon.svg`: белый лист на зелёном фоне из палитры leaf. Vite выпускает отдельный asset с хешем (`?no-inline`), совместимый с действующей CSP. Docker allowlist и package check разрешают только этот дополнительный файл. Исходник и preview проверены, точные байты добавлены в public-assets manifest; внешних ссылок, шрифтов и метаданных нет. Модель и поведение приложения не менялись.

PASS: `npm run build`, `npm run format:check`, `npm run check:package`; Chromium загрузил production asset и декодировал SVG в размерах 16/32/64 px с серверной CSP, синтетический preview просмотрен. Перед коммитом выполнены `npm run check:kit`, `npm run security:staged` и `git diff --cached --check`. Полные application unit/integration/E2E suites и Docker build не запускались для статического изменения. Push/deployment не выполнялись. Следующая продуктовая задача — проверка доски O03; S4–S6 остаются незавершёнными.

## C19 — подготовка локального коммита — 2026-10-08

По поручению владельца подготовлены 45 файлов C19: условное отображение, создание задач со сроками, тесты и согласованные документы. Повторный verify на закреплённом Node 24.21.0/npm 11.19.0 PASS: typecheck, lint, 620/620 unit/integration tests и production build. format:check, check:package, git diff --check и полный preflight прошли: doctor 11/11, kit, test:kit 52/52 с реальным Gitleaks, workspace/index/staged/history/metadata checks. Первоначальный preflight отказал из-за Node 24.19.0 в оболочке; повторный запуск использовал уже установленную закреплённую версию без изменения политики.

Код при подготовке коммита не менялся. Browser E2E повторно не запускались; результаты реализации приведены ниже. Push, deployment и release не выполнялись. Следующая продуктовая задача — проверка доски O03; S4–S6 остаются незавершёнными.

## Условные полосы и создание задач — C19, 2026-10-08

По поручению владельца обновлены DECISIONS, SCHEDULING, UI, ACCEPTANCE, ARCHITECTURE, START_HERE/AGENTS, основная optional-scheduling спецификация и нормативное приложение. Добавлены [спецификация C19](superpowers/specs/2026-10-08-conditional-gantt-design.md), [ADR 010](adr/010-conditional-display-today.md) и выполненный [план](superpowers/plans/2026-10-08-conditional-gantt.md).

Все конечные работы с неполным интервалом получают приглушённые полосы. Приоритет: собственное начало, собственное окончание с обратным отсчётом, knownStartMin родительской группы, сегодня в timezone проекта. Длина — duration или один display-день. Общий чистый domain helper используется серверным own/group display и клиентским today fallback; не читает часы и не меняет source. Today обновляется раз в минуту и при возвращении вкладки в фокус. Summary/FS/coverage/CPM используют прежние реальные данные, стрелки не выводятся из условных краёв; conditional drag/resize запрещены, Enter/Space открывают панель. Reveal и фильтры сохраняют групповой контекст. Края диапазона ограничивают только рисунок, включая большую сохранённую duration сверх лимита нового ввода.

Общий QuickAdd дерева/подзадач получил раскрываемые PlanFields: default duration=1 очищаема, даты пусты, Today явно задаёт начало через C18. TaskPanel имеет ту же явную кнопку. Существующие nullable поля при открытии не заполняются. task.create совместимо расширена тремя необязательными source полями, omission остаётся null; сервер валидирует полный интервал до преобразования родителя и сохраняет всё одной транзакцией. Independent draft source/title/context сохраняются при ошибке/uncertain ответе; exact retry повторяет payload и очищает только подтверждённый черновик. Изменённые сроки без названия учитываются при beforeunload/logout. Ошибка завершённого ввода не снимается сворачиванием формы; явный сброс восстанавливает default. SQL, миграции, response DTO, версия 2, frozen replies, CPM math, lockfile и security policy не менялись. Прежняя preserveWork политика действует и для duration-only работы; чисто иерархические browser fixtures явно очищают duration.

TDD: новый helper/today fallback, форма создания и расширение API сначала RED на отсутствующей функциональности, затем GREEN. Дополнительный regression воспроизвёл снятие ошибки при повторном раскрытии формы и проверяет исправление/сброс. Literal tests покрывают forward/backward calendars, weekend notes, leap/year/min/max boundaries, большую stored duration и отсутствие mutation. HTTP tests проверяют atomic create, mismatch/weekend rollback, exact retry и один undo. Реальные browser tests проверяют смену дня в timezone без writes, nullable source, фильтр/reveal, keyboard, explicit Today, committed lost response, restart/undo.

PASS на Node 24.21.0/npm 11.19.0: doctor 11/11; финальный verify (typecheck, lint, 620/620 unit/integration tests в 35 файлах и production build); format:check; полный test:e2e 68/68 в 1440×900 и 1280×800 без skips/retries. После финальной правки QuickAdd повторно прошли verify 620/620 и профильные browser suites создания/подзадач/дерева 20/20. check:package, check:kit (48 Markdown, 217 local links, три approved references, numerical fixtures), test:kit 52/52 с реальным Gitleaks, security:workspace и git diff --check прошли. Синтетические снимки Ганта/формы в двух viewports просмотрены; в репозиторий не добавлены.

Первоначальные RED/устаревшие expectations и запуск browser до новой production build исправлены; актуальных failing checks нет. Не запускались независимое ревью, Docker smoke, отдельные публикационные preflight/staged/history checks и OS sandbox probe. Коммит/index, push, deployment, release и production operation не выполнялись. Следующая продуктовая задача — проверка доски O03, затем её статусы/undo; S4–S6 и первый релиз остаются незавершёнными.

## C18 — подготовка локального коммита — 2026-10-08

По поручению владельца подготовлены 19 файлов связанного ввода: domain helper, форма/даты/CSS, unit/browser tests и согласованные спецификации C18. Других изменений в рабочем дереве при подготовке не было. Полный root preflight на закреплённом Node 24.21.0/npm 11.19.0 PASS: doctor 11/11, kit/reference/fixture checks, test:kit 52/52 с реальным Gitleaks, workspace/index/staged/history/metadata guards. Application verify 585/585, полный browser suite 64/64 и финальные профильные E2E 6/6 прошли на этапе реализации; повторный запуск приложения для коммита не требовался, его код не менялся.

Штатные hooks включены. Docker smoke и независимое ревью не запускались. Push, deployment, release и production operation не выполнялись. Следующая продуктовая задача — проверка доски O03 и её статусы/undo; S4–S6 остаются незавершёнными.

## Связанные поля плана — C18, 2026-10-08

Принятое C18 внесено в DECISIONS, SCHEDULING, UI, ACCEPTANCE, основную спецификацию §3.3, нормативное приложение и START_HERE. Выполнен [план связанного ввода](superpowers/plans/2026-10-08-linked-plan-fields.md). Начало сохраняет длительность и пересчитывает окончание; окончание сохраняет начало и меняет длительность; длительность использует начало, а без него — окончание. Если при редактировании даты есть вторая дата, но нет длительности, она вычисляется включительно. Одна длительность не назначает даты, очистка меняет только одно поле, фокус/открытие не заполняют source.

Чистый helper `completeSourceEdit` находится в domain/planning и использует прежнюю civil-day арифметику weekdays/all-days. PlanFields завершает ввод по blur/Enter/выбору календаря, показывает понятную ошибку, краткую подсветку и доступную текстовую подпись пересчитанного поля. CalendarDateInput показывает DD.MM.YYYY, принимает ручной ввод/ISO и сохраняет native calendar с клавиатурным открытием; транспорт остаётся ISO. Число длительности компактное, единицы рядом соответствуют календарю. TaskPanel блокирует invalid Save, прежняя task.edit сохраняет всю тройку атомарно с серверной валидацией и undo. API, схема, миграции, authoritative CPM, lockfile и security policy не менялись.

TDD: domain suite сначала RED на отсутствующем helper, после реализации GREEN; UI suite сначала RED на формате/независимом вводе, затем GREEN. Численные literal tests проверяют опоры, оба календаря, leap/year/DST boundaries, nullable очистку, invalid/overflow и отсутствие mutation. Interaction tests проверяют промежуточный набор, Tab/Enter, календарь, ошибки, done/summary, отсутствие заполнения при focus, некорректные длительности и discard. Browser/API/SQLite подтверждают ноль writes до Save, одну revision/operation/undo при сохранении, серверный интервал, неизменность остальных задач, undo/restart, duration-only, очистку, invalid/discard и оба календаря. Прежний browser mismatch case адаптирован к C18; реальный API mismatch rollback сохранён.

Проверки на Node 24.21.0/npm 11.19.0: полный verify PASS (typecheck, lint, 585/585 unit/integration tests в 32 файлах, production build); полный test:e2e PASS — 64/64 в обоих viewports без skips/retries. После добавления клавиатурного открытия native picker — финальные focused linked-fields browser checks 6/6. Format:check, check:kit, check:package, security:workspace и git diff --check PASS. Синтетические panel captures 1440×900/1280×800 просмотрены, остаются вне checkout. Начальный doctor на Node 24.19.0 дал FAIL node-version; повтор на закреплённом runtime PASS 11/11.

Независимое ревью, Docker smoke, test:kit и полный publication preflight не запускались. Commit/push/deployment/production operation не выполнялись; использована только временная синтетика. Native picker сохраняет внешний вид браузера; сохранение остаётся явной кнопкой. Следующая задача — проверка владельцем доски O03 и её статусы/undo; S4–S6 и первый релиз остаются незавершёнными.

## S4 — локальная фиксация и повторные проверки — 2026-10-08

Поиск/фильтр и быстрый ввод во вкладке «Подзадачи» зафиксированы локальным коммитом `e0dfa08` вместе с клиентскими/браузерными tests, планом и рабочими уточнениями D14–D15. Интерактивный HTML-прототип иерархической доски выделен в отдельный коммит с относящейся к нему документацией. Компоновка остаётся предложением по O03; сохранение статусов и undo доски пока не подключены. Предыдущие записи ниже описывают состояние на момент реализации.

Перед фиксацией повторно прошли `verify` (typecheck, lint, 551/551 unit/integration tests в 32 files, production build), `test:e2e` (58/58 в обоих viewports, без skips/retries), `format:check`, `check:package`, `security:workspace` и обычный root `preflight` с настоящим Gitleaks и 52/52 kit tests. Оба staged-снимка прошли `check:kit`, изменения — `git diff --cached --check` и `security:staged`; история дополнительно проверена через `security:history`. Штатные pre-commit/commit-msg hooks включены. Использованы Node 24.21.0/npm 11.19.0 и синтетические фикстуры.

Первый doctor на другом Node patch отклонил окружение; повтор на закреплённом runtime прошёл 11/11. Проверка снимка первого коммита обнаружила ссылку на ещё не включённый прототип; относящийся к доске абзац перенесён во второй коммит, повторный `check:kit` прошёл. Новые изменения поведения приложения не вносились. Независимое ревью и Docker smoke не запускались. Push, deployment и release не выполнялись. Следующая задача — проверка компоновки доски владельцем (O03), затем серверные статусы/undo; S4–S6 остаются незавершёнными.

## S4, вкладка «Подзадачи» и прототип доски — 2026-10-08

Выполнена вторая задача [S4](IMPLEMENTATION_PLAN.md): вкладка «Подзадачи» переиспользует полное основное дерево и QuickAdd внутри компактной панели. Основной поиск не скрывает её ветку; сворачивание общее, глубина относительная, исходные parentId сохранены. Ввод ограничен выбранной веткой, отдельные черновики привязаны к проекту/задаче и сохраняются при переходах и смене вкладки. Insert/Shift+Insert направляют в ввод панели, Shift+Tab не выходит выше её корня. Переходы к детям сохраняют историю, вкладку и строку для возврата; исчезнувшая строка возвращает фокус к вводу. Закрытие панели возвращает фокус в основной экран. Создание, точный retry и undo используют существующие серверные транзакции. Dirty details, busy/loading, conflict, неопределённый ответ и удалённый родитель блокируют создание без потери черновика; удалённая выбранная задача с черновиком остаётся видна без stale tree.

Подготовлен [локальный интерактивный прототип иерархической доски](../design/prototypes/hierarchical-board.html) на синтетических данных: раскрываемые группы через три колонки, три уровня вложенности, конечные работы по статусу и задачи верхнего уровня. Родители не дублируются карточками. Раскрытие и сворачивание работают мышью и клавиатурой; карточки ещё не меняют статус и не обращаются к серверу. O03 остаётся открытым, прототип не стал четвёртым утверждённым референсом. Поведение вкладки записано как рабочее уточнение D15, не подтверждённое C.

Изменены App, TaskPanel, TaskTree, QuickAdd, компактный CSS ввода, клиентские/браузерные tests, документация и HTML prototype. Существующие незакоммиченные поиск/фильтр сохранены. Сервер, схема, календарь/CPM, shared contracts, lockfile и security policy не менялись. Проверка subtree на независимой фикстуре 5 000 уровней подтверждает порядок, глубину, идентичность source объектов и исходных родителей. App regressions проверяют отдельные drafts, dirty details, возврат, исчезнувшую строку/родителя, точный retry и сохранение другого фокуса. Browser/API/SQLite проверяют полную ветку под фильтром без mutation, клавиатурный перенос, создание внутри ветки с сохранением прежних дат/связей, один undo, offline/retry, последнюю строку и conflict reload удалённой задачи.

Проверки на Node 24.21.0/npm 11.19.0: `verify` PASS — typecheck, lint, 551/551 unit/integration tests в 32 files и production build. Полный `test:e2e` PASS — 58/58 в 1440×900/1280×800 без skips/retries; новая вкладка покрыта 8 browser cases. `format:check`, `check:package`, `check:kit`, `security:workspace` и `git diff --check` PASS. Root `preflight` PASS: doctor 11/11, kit/reference/fixture checks, test:kit 52/52 с настоящим Gitleaks, workspace/index/staged/history/metadata guards; index не менялся. Прототип отдельно проверен в свежем браузере: 11 уникальных карточек, раскрытие/сворачивание и Enter на группе в обоих viewports. Три approved PNG и собственные synthetic panel/board captures обоих размеров просмотрены; captures находятся вне checkout.

Новые App regressions сначала RED на отсутствии scoped ввода/возврата, Insert и исчезнувшем родителе. Первый browser run выявил потерю фокуса при disabled input; возврат перенесён в эффект после обновления DOM с сохранением другого активного поля. Browser undo при открытой overlay-панели проверяется штатным Ctrl+Z из дерева. Старый sibling test уточнён до scoped input, assertions parentId/afterId сохранены. Начальный doctor на другом Node patch дал FAIL node-version, на закреплённом runtime — PASS 11/11. Финальных failed application checks нет.

Независимый review и Docker smoke этой задачи не запускались; выполнен локальный review diff. Черновики живут только в текущей клиентской сессии и не переживают reload/logout. Сохранение статусов и undo доски, S4 целиком и S5–S6 остаются незавершёнными. Commit, push, deployment и release не выполнялись, production/private данные не использовались. Следующий шаг — проверка владельцем предложенной компоновки доски (O03), затем её подключение к серверным статусам/undo и сквозная приёмка S4.

## S4, первая задача — поиск и фильтр по статусу — 2026-10-08

Выполнена первая задача [плана S4](superpowers/plans/2026-10-08-s4-task-filters.md): поиск по названию и фильтр по статусу с полной цепочкой родителей и общими строками дерева/Ганта. Семантика поиска зафиксирована как рабочее уточнение D14, не подтверждённое C. Прямые совпадения считаются отдельно от строк «Контекст»; поиск раскрывает ранее свёрнутые пути, временное сворачивание результатов не меняет обычное дерево. Сброс восстанавливает прежнее раскрытие и фокусирует поиск. «Показать на Ганте» снимает фильтры. Смена проекта сбрасывает критерии; conflict reload того же проекта сохраняет их. Черновики панели и быстрого ввода не отбрасываются.

Изменены только клиентские projection/controls, App/TaskTimeline/TaskTree, строки и CSS; Gantt отменяет незавершённый жест при изменении видимых строк. Сервер, схема, календарь/CPM, shared contracts, lockfile и security policy не менялись. Независимые literal fixtures проверяют AND, статус родителей, Unicode/literal поиск, исходные объекты, пустые результаты и цепочку 5 000 уровней; App interaction tests — клавиатуру, сброс, временное сворачивание, drafts, project switch, loading/conflict/offline. Pointer regression имеет положительный контроль обычного жеста. Реальный browser/API/SQLite suite доказывает ноль mutation requests при фильтрации, неизменность полного tree/schedule/revision/canUndo и SQL operation/undo counts; отдельно проверяет dirty draft, keyboard, Show on Gantt, status edit и undo.

Проверки на Node 24.21.0/npm 11.19.0: `verify` PASS — typecheck, lint, 541/541 unit/integration tests в 31 files и production build. `format:check`, `check:package`, focused browser 4/4 и полный `test:e2e` 50/50 PASS в 1440×900/1280×800 без skips/retries. Root `preflight` PASS: doctor 11/11, kit/reference/fixture checks, test:kit 52/52 с настоящим Gitleaks, workspace/index/staged/history/metadata guards. После финальных документационных правок повторены `check:kit` (44 Markdown/184 links) и `security:workspace`, оба PASS. Три approved PNG и шесть собственных synthetic main/filter/panel captures обоих viewports просмотрены; captures остаются вне checkout.

Начальный doctor в shell с другим Node patch дал FAIL node-version; повтор на закреплённом runtime прошёл. TDD RED: отсутствующий projection module и шесть отсутствующих/неработающих поисковых сценариев; GREEN после реализации. В focused browser исправлено ошибочное имя кнопки раскрытия в новом тесте, assertions сохранены. Финальных failed checks нет. В browser launcher для текущего прогона убрана конфликтующая CLI color variable без изменения файлов запуска или защитной политики.

Независимый review новой задачи и Docker smoke не запускались; выполнен локальный review diff. Production/private data, commit, push, deployment и release не использовались. S4 целиком и S5–S6 остаются незавершёнными. Следующая задача — проверка и доведение вкладки «Подзадачи» на общем дереве/быстром вводе, затем synthetic prototype ещё не утверждённой иерархической доски (O03).

## Адаптация optional scheduling и CPM — локальная приёмка завершена 2026-10-08

Tasks 1–7 [плана адаптации](superpowers/plans/2026-10-07-optional-scheduling.md) завершены: необязательные исходные сроки без Auto/deadline, совместимая migration003 с preview/acknowledgement и private archive, атомарные API/undo, серверный CPM введённых интервалов и отображение ready/partial/infeasible в tree/Gantt/dependencies. Display dates не становятся source dates; frozen historical ответы возвращаются без пересчёта. C05/OS16 выполнены в пределах локальной адаптации; это не завершение первого релиза.

[Технический CPM annex](superpowers/plans/2026-10-07-explicit-date-cpm.md), execution candidate `9c71ed2aa8b8f9f9a68a282d50189b24299d14df`, получил независимые Spec и Standards/executability APPROVED до реализации CPM. Каждая граница Task7 A→B/C→D→E прошла два независимых review. Два финальных review всей адаптации `37726cc603ca9fee54d11592306cd0bca490a2ad..a9a12214006eb4e794b1e545b9859922fb80fd84` дали APPROVED. Единственный финальный minor о текущем статусе в трёх документах исправлен в `049451e9195d9dec5369863fe0abf81b056c7789`; два scoped re-review дали APPROVED, открытых замечаний нет. Последующая запись фактов приёмки меняет только документацию; прикладной код и тесты совпадают с reviewed candidate.

Итоговые controller checks на Node 24.21.0/npm 11.19.0: `npm run verify` PASS — typecheck, lint, 524/524 unit/integration tests в 29 files и production build; `format:check` и `check:package` PASS. Actual browser E2E 46/46 PASS в 1440×900 и 1280×800, без skips/retries. Ordinary root `preflight` после принятого финального исправления PASS полностью: doctor 11/11, documentation/reference/fixture checks, test:kit 52/52 с настоящим Gitleaks и workspace/index/staged/history/commit-tag metadata guards. Независимые unit/integration runs исполнителя: 322/322 и 202/202 соответственно.

Три approved PNG и шесть собственных synthetic main/panel/graph captures обоих viewports просмотрены controller и финальными reviewers. Исключённый subtask collage не использовался. Предупреждение полного E2E run о конфликте CLI color variables устранено только в launcher; focused undo browser run повторён 4/4 PASS без предупреждения, source/security policy не менялись.

S4 повседневный UX/доска, S5 restore/import/export и S6 релизная приёмка остаются незавершёнными. Следующий продуктовый этап — S4: поиск/фильтры с родительским контекстом и иерархическая доска с отдельной проверкой ещё не утверждённого board layout. Container smoke выполнен в Task5; после CPM Docker не повторялся. Production/private data, реальный upgrade, push, deployment и release не выполнялись.

Ниже сохранены исторические checkpoint records; их ожидавшиеся на тот момент reviews/checks закрыты итоговой приёмкой выше.

## Task 7 checkpoint E — серверная критичность в UI и browser acceptance — 2026-10-08

После двух независимых APPROVED exact checkpoint D выполнен E [утверждённого annex](superpowers/plans/2026-10-07-explicit-date-cpm.md). Tree, Gantt и dependencies показывают общую критичность только для ready; summary получает отдельный indicator только при containsCritical=true. Incomplete показывает явно подписанный анализ датированной части, отдельные dashed/brown task/edge/summary indicators и резерв до известного горизонта. Infeasible и historical pending не получают critical highlights. Историческая подпись — точно «Сохранённый результат без расчёта критического пути». Панель разделяет структурный резерв проекта и резерв текущего размещения; done с положительным projectFloat не становится critical из-за constraintFloat=0. React использует готовые серверные IDs/floats, без CPM или новых layout/board/filter features.

Новый независимый literal UI suite:12/12. Actual server browser suite сохраняет все прежние сценарии и добавляет8 сценариев в каждом configured viewport 1440×900/1280×800: P04→P05→undo→restart, 40-level summary/branch change, tie/disconnected/gap/tight FS, done N06, unknown/partial/conflict, P10 calendar/undo, потерянный committed response/exact retry без дополнительных SQL writes, focus/collapse/scale. Assertions используют literal критические IDs, floats и source, а не calculator. Осмотрены три approved PNG; собственные synthetic main/panel/graph captures обоих viewports сохранены вне repository и просмотрены. Source/display/provenance, dirty panel, loading/empty/offline/keyboard contracts сохранены.

Browser RED выявил реальную потерю фокуса при busy Undo. App.undo запоминает originating button, после response восстанавливает его лишь когда activeElement=body; уже выбранный пользователем другой control сохраняет фокус. Если one-step undo оставляет кнопку disabled, fallback — доступная строка дерева, затем quick input. Held-response RED1 failed/1 passed до fallback; обе проверки GREEN в обоих viewports. Scale select получил явное accessible name. D review cosmetic minor закрыт: imports перенесены в начало двух test files, obsolete instruction comment удалён, без изменения assertions/behavior.

TDD UI сначала RED5 failed/3 passed; после реализации GREEN8, после дополнительных independent surfaces12. Первый full verify выявил один старый pending fixture с искусственным nonempty critical array; fixture исправлен до настоящего frozen empty IDs, все три прежних graph cases сохранены, positive ready/partial покрыты новыми literal tests. Промежуточные browser failures исправлены: отсутствующий testInfo, ожидание доступного имени scale/disclosure, взаимодействие с открытой modal panel, duplicate SVG/panel text locator и Undo focus. Assertions не исключались, retries/skips не добавлялись; полный свежий run GREEN46/46.

Node24.21.0/npm11.19.0: full verify PASS — typecheck, lint,524/524 tests в29files и production build; explicit unit322/322 в15files, integration202/202 в14files; actual E2E46/46 в двух configured viewports без skips/retries. Format:check, check:package, check:kit43Markdown/165links/3approved references и test:kit52/52 с real Gitleaks PASS. CPM math, shared schemas, frozen modules/outcomes, SQL/native/provenance/source policy, lockfile и security/hooks не менялись в E.

E и whole-adaptation acceptance ждут двух новых независимых reviews одного common candidate SHA, затем controller integration и ordinary root preflight. Локальный GREEN не является review approval, production migration или release. Docker не повторялся: нового container/runtime packaging риска нет. S4–S6 и первый релиз незавершены; production/private data и remote actions не использовались. Следующий шаг — финальные scoped guards/обычные hooks/history, immutable candidate и два независимых final reviews.

## Task 7 checkpoint D — atomic LIVE response и frozen retry — 2026-10-08

После двух независимых APPROVED exact checkpoint B/C выполнен D [утверждённого annex](superpowers/plans/2026-10-07-explicit-date-cpm.md). Repository проверяет current calculate/tree/schedule и новый mutation response LIVE-only schemas внутри прежних транзакций. HTTP schedule route также принимает только LIVE. Pending или malformed internal output даёт безопасный internal500, а не Zod400; invalid response до или после save откатывает project/tasks/dependencies/provenance/operations/undo и sqlite_sequence. Cached target retry имеет отдельный strict frozen/LIVE union parser после прежней проверки payload/session/project/digest; legacy replay сохранён lookup-only без solver и изменения stored JSON/archive.

Новый literal repository suite проверяет P04→P05→undo→restart/exact retry, P10 calendar/undo, malformed/pending result и rollback, done structural float/explicit return, C17 private pass-through, validated equal acknowledgement/undo/reopen, status/calendar/edges retention, raw FS conflict и preserveWork transfer. Actual HTTP добавляет literal P10, safe500 для current GETs/mutations, conflict+unknown с одной revision/operation/undo, полный P04→P05→undo→restart и byte-identical saved retry без solver. Actual SQL003 synthetic fixture возвращает frozen revision9 pending после LIVE revision10/restart; scope/digest failures не вычисляют schedule и не пишут историю/архив.

Точечная коррекция execution snippet одобрена controller: новый done test ожидает существующий accepted Task4/Task5 `DONE_PLAN_LOCKED`, а не incidental `DONE_PLANNING` из annex. ApplyPrivateSourcePatch guard переиспользован без второго внешнего guard; source validation-before-ack, original done return и публичный error contract сохранены. Existing response-schema failure regression переключён с union parser на current liveProjectTreeV2Schema; assertions rollback/save/retry сохранены. Frozen modules/outcomes, CPM math, source policy, public schemas, SQL/native storage, lockfile, security/hooks и production UI не менялись.

TDD: literal repo/API tests сначала RED4 failed/15 passed — pending/malformed fresh injections проходили current path, HTTP возвращал200, плюс расхождение done error code. После LIVE guards и согласованной коррекции — GREEN19; дополнительные read/after-save/restart controls расширили focused suite до25/25. First full integration выявила один старый fault spy на union parser; после обновления seam — focused33/33 и integration202/202 в14files. Full verify на Node24.21.0/npm11.19.0 PASS: typecheck, lint, 512/512 tests в28files без skips, production build. Format:check, check:package, check:kit (43 Markdown/164 links/3 approved references) и diff check PASS.

D требует двух независимых exact-SHA implementation reviews до E. Пользовательская status подпись остаётся прежней; float/partial labels, literal UI fixtures и browser acceptance E ещё не выполнены. Browser/Docker/full kit/root preflight не повторялись для серверного checkpoint; полная Task7 приёмка остаётся впереди. S4–S6 и первый релиз незавершены. Production migration, remote actions, publication/deployment не выполнялись. Следующий шаг — две независимые D проверки, затем dispatch E.


## Task 7 checkpoint B/C — explicit CPM и initial frozen compatibility — 2026-10-08

После двух независимых APPROVED checkpoint A выполнен единый B/C [утверждённого annex](superpowers/plans/2026-10-07-explicit-date-cpm.md). Единственный current calculateSchedule возвращает LIVE ready/incomplete/infeasible: entered interval координаты, обратный pass, project/constraint floats, tight critical edges и отдельный partial weak-component result с общим Hknown. Projection сохраняет real/summary/display/source minima и raw FS; marked C17 leaves исключены из real/coverage/CPM, остаются graph vertices и source notes. Invalid/missing/mismatch source даёт incomplete, доказанный FS conflict — infeasible с подавлением анализа. Summary и display не стали CPM вершинами; source не переписывается.

В том же checkpoint initial adapter/resolver/preview/preparer переключены на server-only frozen pending projection/source helpers из exact reviewed Task4 f5e92ab pin; существующий frozen calendar побайтово сохранён. New initial SQL003/preview regressions используют throwing current LIVE solver и сохраняют прежний pending outcome, raw archive и private marker. Cached parsing/response/digest policy, SQL/native schema, provenance storage, source validation, lockfile и security/hook configuration не менялись. Server текущего проекта получает LIVE composition; explicit LIVE-only current guards, durable replay fault checks и critical UI относятся к D/E. Прежние global ID consumers уже получают реальные critical sets, но status подпись ещё старая, новые float/partial labels и browser acceptance относятся к E; B/C не является полной product acceptance.

TDD: сначала новые domain/compatibility suites дали RED отсутствующих modules; после approved module implementation initial adapter/SQL003 preview дали конкретные 3/6 compatibility failures из-за вызова throwing LIVE solver. После frozen imports — GREEN. Existing Task2 suite дала27/51 RED из-за старых pending fields/classification; все 51 cases сохранены с независимыми real-only assertions и новым LIVE outcome, плюс 3 обязательных literal additions. Полная integration выявила один existing HTTP assertion pending/empty critical IDs для known singleton; он обновлён до literal ready/zero floats/own critical ID, без новых D guards.

Проверено на Node24.21.0/npm11.19.0: CPM 50/50 с P01–P11/N06/C17/fork/join/ties/partial/gap/tight/done/unknown/conflict/deep/wide/extremes/origin invariance; focused contracts/domain/calendar/Task2 suite 144/144 в 4 files; independent exhaustive delay-enumeration oracle по 14 ready fixtures; focused legacy-compatibility/optional-migration/optional-upgrade/legacy-pending-projection 117/117 в 4 files. Full unit 310/310 в 14 files и integration 180/180 в 13 files без skips; typecheck, lint, build, format:check, check:package и diff check PASS. Self-review проверил approved math body и exact f5 generation после одинакового форматирования, byte-identical frozen calendar и отсутствие active scheduling/planning/calendar imports у frozen consumers.

B/C требует двух независимых exact-SHA implementation reviews до D. C05/OS16 ещё не завершены: нужны live-only current safe500/rollback guards, durable cached replay/restart tests D и literal UI/browser acceptance E. Browser/Docker, full kit tests и root preflight не повторялись на этом checkpoint; полная Task7 приёмка остаётся позже. S4–S6 и first release незавершены. Production migration, remote actions, publication/deployment не выполнялись. Следующий шаг — две независимые B/C проверки, затем dispatch D.


## Task 7 checkpoint A — strict frozen/LIVE contracts — 2026-10-08

Выполнен только A [утверждённого CPM annex](superpowers/plans/2026-10-07-explicit-date-cpm.md): полный strict frozen pending/LIVE union, отдельные LIVE-only tree/schedule schemas и domain type aliases. Frozen pending сохраняет прежние поля, validators и outcome без defaults, добавления floats/horizon/partial или нормализации старых coverage/interval combinations. Source patch извлекает лишь defined inputStart/inputFinish/durationDays, сохраняя различие между omission и null. Текущий scheduler имеет только уточнённый pending return type; его emitted runtime и пользовательская подпись «Расчёт критического пути ещё не подключён» сохранены. Сужена одна existing Gantt test fixture; production UI не менялся.

TDD: literal annex suite сначала дал RED (2 failed / 14 passed: отсутствующий frozen export и отказ старого parser принимать live infeasible), после полного schema block — GREEN16/16. Дополнительные frozen byte/digest, envelope и strict coverage/summary/float controls расширили suite до32/32. На Node24.21.0/npm11.19.0 прошли typecheck, lint, unit257/257 в13files, integration174/174 в12files, build, format:check, check:package и diff check; skips не добавлены. Self-review подтвердил полный schema block после одинакового форматирования, byte-identical approved execution body без review metadata и неизменность emitted pending scheduler runtime относительно integration base. Lockfile, SQL/native schema, source validation policy, hooks и security rules не менялись.

Checkpoint A требует двух независимых exact-SHA reviews до B/C. Математика, LIVE composition, initial frozen compatibility switch, LIVE-only current server guards и critical UI/browser feature ещё не реализованы; C05/OS16 остаются незавершёнными. E2E/Docker и полный root preflight не повторялись для этого contract checkpoint; integrator выполняет root publication checks отдельно. Следующий шаг после двух APPROVED — единый B/C GREEN checkpoint с одновременным LIVE и initial frozen compatibility. S4–S6 и первый релиз остаются впереди; production migration, публикация и remote actions не выполнялись.


## Root verification принятой адаптации и плана CPM — 2026-10-08

Основной checkout на объединённых reviewed Task5/Task6 прошёл `npm run verify`: typecheck, lint, 399/399 application tests в 24 files без skips и production build. `format:check` и `check:package` — PASS. Полный `preflight` — PASS: doctor, kit (43 Markdown files, 161 local links), 52/52 harness tests с настоящим Gitleaks, workspace/index/staged/history guards и scans, 41 Git metadata objects. Первоначальный workspace refusal выявил личный административный путь только в generated scratch report; пример заменён эквивалентной NVM_DIR-ссылкой, guard policy и application source не менялись.

Два независимых Task5 re-review APPROVED на `ac9c645`; два новых independent execution-plan reviews APPROVED на `9c71ed2`. Root merge не менял application behavior или approved plan body; STATUS conflicts сохранили обе истории. Worker final browser E2E — 30/30 на двух viewport. Root browser/Docker suites повторно не запускались для идентичного reviewed application source; прежний Docker evidence привязан к исходному Task5 checkpoint, без заявления нового image.

Task5 GREEN и технический CPM plan/review prerequisite закрыты. Далее fresh worker исполняет A→B/C→D→E с отдельными GREEN commits и двумя independent implementation reviews каждого checkpoint. B/C одновременно подключает LIVE analysis и initial frozen compatibility. CPM/C05/OS16 ещё не реализованы; S4–S6 и first release остаются впереди. Production migration, публикация и remote actions не выполнялись.

## Объединение Task 5 и approved execution plan CPM — 2026-10-08

В основном checkout объединены принятый Task 5 (`ac9c645`, два независимых APPROVED) и reviewed execution annex (`9c71ed2`, два новых независимых APPROVED; metadata `003ff23`). Контракты, source policy, математика и все 41 snippets плана сохранены. При объединении разрешён только STATUS conflict с сохранением обоих наборов исторических записей. CPM code ещё не начат.

Task 5 worker подтвердил 399/399 application tests и 30/30 browser E2E. Основной checkout выполняет полный verify/preflight и format/package; эти результаты фиксируются отдельной фактической записью после завершения. Далее Task 7: A→B/C→D→E, с двумя независимыми review каждого checkpoint; B/C переключает LIVE и initial frozen compatibility одним GREEN commit. Production migration, remote actions и release не выполнялись; S4–S6 остаются впереди.

## Принятая интеграция Task 5 — 2026-10-08

Task 5 принят после исправлений: независимые Spec и Standards re-review дали APPROVED на `ac9c6450d0ddac61d8f36086796fb1eeaf5569fe`. Все четыре замечания закрыты. В основном checkout объединены contracts V2, schema003, атомарные source/provenance/undo/replay и optional UI; STATUS conflict разрешён сохранением обеих историй. Application source соответствует reviewed candidate; локальное объединение не добавляет новых правил.

Исполнитель проверил final verify 399/399 и 30/30 actual browser E2E на обоих viewport; typecheck/lint/build/format/package и staged scans/normal hooks прошли. Основной checkout выполняет собственные verify/preflight после объединения также reviewed execution annex. CPM ещё не реализован; Task 7 начинает с strict result contract и отдельных reviewed checkpoints A→B/C→D→E. S4–S6 и первый релиз остаются впереди; production migration и внешние действия не выполнялись.

## Task 5: исправления после первого review — 2026-10-08

Отложенный выбор длительности привязан к исходным project/revision: начало загрузки проекта и принятый новый revision отменяют его; обе кнопки проверяют актуальность перед командой. Разрешённая навигация больше не оставляет диалог без tree, отмена не выполняет mutation. Единственный активный DAG-validator находится в planning; optional graph tests теперь вызывают ту же функцию, что Repository и Dependencies, без изменения frozen legacy solver.

Initial window и reveal Ганта используют source-start, затем source-finish, когда нет real/conditional interval. Исходные отметки остаются независимыми от полос и не принимают planning gestures. Для clipped conditional display добавлено пояснение «Отображение ограничено предельной датой» в title и accessible label; исходная длительность не меняется.

Проверки на закреплённом toolchain: новые regressions сначала дали 4 component failures и 2 actual-server browser failures; после исправления final verify прошёл (399 application tests без skips, typecheck, lint, build), literal render fixtures и отдельный overflow producer control сохранены; повторные typecheck/lint/format:check/check:package — PASS. Два полных browser прогона выявили по одному прежнему тестовому race: Delete до восстановления фокуса после move и reopen до завершения Save(done). Тесты ждут соответствующий animation frame / «Сохранено»; production-поведение не менялось, retries/skips не добавлены. Итоговый полный browser-прогон: 30/30 PASS на1440×900 и1280×800, включая unchanged pinned S3 client; все прежние26 scenarios и4 новые проверки сохранены. Retained graph cases сохранены. SQL/storage/transport/CPM-код и упаковка не менялись. Docker/kit повторно не запускались: прежний Docker evidence относится к исходному Task 5 checkpoint, не к новому image. Workspace/history/preflight остаются обязанностью integrator в обычном checkout; known linked-worktree pointer guard не обходился. Следующий шаг — два независимых re-review точного fix SHA.

## Task 5: атомарная адаптация storage/API/UI — 2026-10-08

Активированы target contracts V2, независимые необязательные source dates/duration, серверная pending-проекция и migration003. C16 policy CLOSED; настоящий CPM implementation pending. Публичные DTO явно перечисляют project/tasks/dependencies и не раскрывают archive/provenance. Операции/undo сохраняются; C17 markers переживают details/status/calendar/edges, restart, preserveWork и undo. Явный validated source patch, включая равные значения, подтверждает интервал; status-only возврат в работу marker сохраняет.

Каждый project route требует transport version2 до repository access; unversioned/unsupported получает426. Target command/rename body содержит contractVersion2. Legacy replay использует original body с transport-only replay header, возвращает frozen revision9 после latest10, ничего не выполняет при неизвестном запросе и проверяет digest/schema. Schema2 startup без approval и schema1 отклоняются до изменяющих PRAGMA/DDL; CLI readonly preview/digest confirmation и повторная проверка внутри IMMEDIATE-транзакции подключены. Deadline не переносится в finish, display не сохраняется как source.

UI сохраняет светлое дерево/Гант и компактную панель. Три optional поля, отдельные source markers, условные полосы, source-only labels при неизвестном прежнем интервале, explicit duration choice для resize, dirty drafts и удалённая выбранная задача покрыты тестами. Статус pending объясняется «Расчёт критического пути ещё не подключён». README/BOOTSTRAP/DEPLOYMENT описывают backup/preview/explicit apply и границы промежуточного checkpoint.

Проверено на закреплённых Node24.21.0/npm11.19.0: verify — typecheck, lint, 394 application tests без skips и build; format:check, check:package и check:kit — прошли. Browser suites проверены на1440×900 и1280×800: 24 target E2E и2 actual pinned unchanged S3 tests. Original S3 SHA/API source hashes, offline build, настоящий old ApiError и browser assets подтверждают426/uncertain=false/no writes. Отдельно actual pinned S3 registry отклоняет schema3. Synthetic CLI, migrated HTTP replay/rename, corruption safe500, premigration deleted-task undo и provenance durability проверены. Local Docker synthetic smoke прошёл: точная migration003, native DROP, explicit upgrade, fresh chain, non-root/read-only, loopback, restart и native backup; только собственные новые ресурсы, удалённые после проверки. Все шесть synthetic screenshots просмотрены относительно трёх approved references.

Suite traceability: прежние Auto/Fixed/deadline target assertions заменены на nullable source, N01–N05/pending, FS/summary/display, done reopen, version/replay, private marker и rollback scenarios. Исторические численные CPM fixtures сохранены целиком в tests/scheduling.test.ts на frozen server-only solver; compatibility/migration/upgrade suites сохранены и расширены. Список application suites не сокращён и skipped tests не добавлены; изменение числа403→394 отражает замену поведения C11–C15 и объединение связанных assertions. Kit исторические CPM примеры остаются отдельным evidence, не новым расчётом.

Publication guard в linked worktree: security:workspace остановлен на категории PERSONAL_HOME_PATH для служебного `.git` pointer; preflight здесь не завершён. Это известная граница workspace guard, политика не менялась. Scoped security:staged и обычные commit hooks обязательны; integrator повторяет workspace/history/preflight в основном checkout после принятия.

Не запускались: production migration/deployment, remote actions, push/release, restore/import/export и полный релизный acceptance. Первый релиз не готов. Следующий шаг: независимый Spec/Standards review точного интеграционного SHA, затем Task7 CPM после завершения review его нормативного приложения. Исторические записи ниже описывают состояние своих checkpoint.


## Интеграция reviewed C17 CPM annex — 2026-10-08

В основном checkout сохранён technical annex с двумя новыми независимыми APPROVED на substantive `bfa0f8e1d2cf42a8d0c13f9e968304217ba931f9`; metadata `8060ffc` сохраняет approved body/snippets. Разрешён единственный конфликт STATUS: сохранены оба набора исторических записей. Application source, schema registry и lockfile не менялись; CPM code ещё не начат. Task 5 integration проходит собственные application checks и требует двух независимых review перед исполнением annex.

Документационная интеграция прошла `check:kit` (43 Markdown files, 159 local links), `format:check` и diff check; staged guard/Gitleaks и обычные hooks обязательны при commit. Полный application preflight выполнен на принятом Task 4; для documentation merge он не заменяет последующую проверку интеграции Task 5. Production migration и внешние действия не выполнялись.

## Review metadata sequencing CPM annex — 2026-10-08

Current execution candidate [annex Task 6](superpowers/plans/2026-10-07-explicit-date-cpm.md) `9c71ed2aa8b8f9f9a68a282d50189b24299d14df` получил два новых независимых APPROVED: Spec и Standards/executability. Atomic B/C LIVE/freeze checkpoint, focused compatibility guards и отдельный D deliverable проверены отдельно; bfa0f8e C17/math approval остаётся историческим. В header/footer и ADR008 записаны только review facts. Substantive body, approved procedural instructions и все 41 fenced snippets сохранены побайтово.

На закреплённом Node24.21.0/npm11.19.0 прошли byte comparison approved body/procedural instructions/41fenced blocks, ADR formula/prior STATUS retention, `check:kit` (42 Markdown files, 156 local links), diff checks и staged privacy guard/Gitleaks на трёх scoped docs. Обычные hooks включены. Неизменённые numerical/snippet/application suites повторно не запускались.

Это metadata-only revision, без CPM implementation или application edits. Task5 fix/check/review ещё завершаются; два approvals Task5 здесь не заявлены. Task7 требует actual Task5 GREEN и завершённого review его implementation. Approval плана относится к exact9c71ed2 и не переносится на изменённый body или будущую реализацию.

## Sequencing amendment technical CPM annex — 2026-10-08

[Annex Task 6](superpowers/plans/2026-10-07-explicit-date-cpm.md) уточняет порядок исполнения: B/C LIVE scheduler switch обязан одновременно создать и подключить уже описанную initial frozen projection, её literal tests и frozen resolver/preview/preparer imports в одном GREEN commit. Добавлены focused compatibility checks поверх unit suite и полный scope этого commit. D использует готовый freeze, сохраняет live-only validators/persistence/HTTP/rollback/durable cached replay; initial projection cases не объявляются повторно RED.

Read-only audit точного Task5 candidate5134b93 обнаружил, что initial adapter/preview ещё вызывают active calculateSchedule, а frozen expectations находятся в integration suites. Unit GREEN не защищает historical outcome. Actual Task5 consumer imports в execution instructions уточнены до calculateSchedule/planning; pinned f5 extraction и все snippets остаются прежними. Audit не является approval Task5 implementation.

На Node24.21.0/npm11.19.0 прошли byte comparison всех 41 fenced blocks и nonprocedural annex text с metadata8060ffc, сверка сохранности prior STATUS records, `check:kit` (42 Markdown files, 155 local links), diff checks и staged privacy guard/Gitleaks на двух scoped docs. Обычные hooks включены. Неизменённые численные/snippet/application suites не повторялись.

Изменены только procedural text и factual review status; prior bfa0f8e approvals остаются историческими для C17/math/DTO/source policy. Новый execution candidate pending двух independent reviews, Task5 ещё проходит fix/check/review. Task7 CPM code запрещён до Task5 GREEN и approvals текущего плана. В этом изменении только annex и STATUS; application/schema/lockfile/ADR/runtime и внешние действия не затронуты.

## Review metadata C17 CPM annex — 2026-10-08

Current substantive candidate [technical annex Task 6](superpowers/plans/2026-10-07-explicit-date-cpm.md) `bfa0f8e1d2cf42a8d0c13f9e968304217ba931f9` получил два новых независимых APPROVED: Spec и Standards/executability. Private unavailable input/admission и initial frozen projection проверены отдельно; прежние approvals29f193e остаются историческими. В annex footer и ADR008 записаны факты review/source boundary. Substantive body и все fenced snippets побайтово сохранены относительно approved bfa0f8e.

На закреплённом Node24.21.0/npm11.19.0 прошли byte comparison substantive prefix/41 fenced blocks, `check:kit` (42 Markdown files, 154 local links), diff checks и staged privacy guard/Gitleaks на трёх scoped docs. Обычные hooks включены. Неизменённые oracle/snippet/application tests повторно не запускались.

Это metadata-only revision, без application changes или CPM implementation. Actual Task5 integration/checks/review ещё завершаются; Task7 требует Task5 GREEN. Approval плана не переносится на иной изменённый body или будущую реализацию. Следующий шаг — Task5 GREEN и independent review его implementation, затем исполнение approved annex.

## C17 input amendment technical CPM annex — 2026-10-08

Обновлён [technical annex Task 6](superpowers/plans/2026-10-07-explicit-date-cpm.md) под согласованный Task4 contract: server-private `PrivateSnapshotV2.legacyIntervalUnavailable` передаётся в `OptionalInput.unavailableTaskIds`. Marked leaf с валидной сохранённой парой остаётся unknown: не входит в real/coverage/full summary/CPM и Hknown, сохраняет source notes/minima и raw FS-проверку. Документ задаёт private→pure passage, public field picking, explicit validated acknowledgement, original-done guard, undo/reopen/preserveWork regressions и ordinary unmarked done control. Публичные source/status/duration и DTO не расширяются provenance.

Initial migration/preview после подключения LIVE CPM используют описанную server-only frozen pending projection с закреплёнными Task4 source validation/calendar semantics. Сохранённые cached replies возвращаются без пересчёта; новый текущий результат проходит live-only boundary. Добавлены literal frozen validmissing/invalid/unavailable/FS outcomes, adapter/preview/actual SQL003 synthetic regression и current LIVE controls. Это compatibility archive contract; active scheduler остаётся один. SQL/archive/resolver implementation относится к Task4; source pin `f5e92abf7d2cb9655cfe11e6173f70ae375df857` получил два independent APPROVED (Spec/Standards), будущая runtime integration Task5 ими не одобрена.

На Node 24.21.0/npm 11.19.0 прошли синтаксический разбор 39 TS/TSX blocks, независимый exhaustive delayed-placement oracle 14/14 и strict disposable future-target typecheck amended schemas/domain/private server fragments/Task2 adaptation/API/UI/browser/initial-frozen snippets. Изолированные domain C17 и frozen adapter/preview/SQL003 tests прошли 12/12, skipped 0; preview/migration не вызывают текущий solver. Pure snippets также сохранили positive F03+U partial AB/BC, live-only rejection frozen pending и ограниченные 20 000 Array.some callback checks для 10 000 unknown leaves. Future Repository/HTTP/UI/browser suites только разобраны и типизированы; application GREEN не заявлен.

`check:kit` прошёл: 42 Markdown files, 153 local links, три approved references и неизменённые исторические CPM/calendar examples. Diff checks и staged privacy guard/Gitleaks прошли на двух scoped documents; обычные commit hooks включены. Неизменённые kit tests и application suites не повторялись.

C17 amendment требует двух новых independent APPROVED на один точный SHA. Предыдущие verdicts для substantive `29f193ea8dcd7ab0213fe84fc7dafa913a4a4b21` остаются историческими и не распространяются на изменённый typed/algorithm body. Reviewed Task4 private contract и Task5 GREEN остаются prerequisites для Task7. В этом изменении только annex и STATUS: application/runtime/schema/lockfile/ADR не менялись, production migration и внешние действия не выполнялись. Следующий шаг — два независимых review amended annex.

## Task 4: C17 resolver, preview и durable unavailable — 2026-10-08

Реализованы неактивные helpers C17: frozen server-only S3 calculator/calendar/types, resolver по полному собственному active/operation/undo snapshot, readonly preview counts/digest и locked acknowledgement перед migration writes. Каждая resolution связана с original task и полным context SHA-256; изменение project/calendar/edges/другой задачи того же context отвергается до DDL. Frozen legacy envelope validators не ослаблены, raw payload/response/undo не нормализуются.

[ADR 009](adr/009-unavailable-legacy-provenance.md) фиксирует техническое исполнение C17: private provenance table, strict private undo snapshot, immutable resolution metadata в archive, optional pure input `unavailableTaskIds`. Недоступный done lock остаётся unknown даже при сохранённой валидной input pair; source/status/duration остаются прежними. Известные исходные FS-конфликты и display anchors сохраняются. Явный source patch очищает marker после валидации; для done требуется явное reopening, равные значения также проверяются. Ordinary explicit done остаётся known. SQL 003 и её exact digest обновлены вместе.

Проверки: `npm run verify` — typecheck, lint, 403/403 теста в 22 suites и build; targeted compatibility/migration/upgrade — 108/108; `npm run test:kit` — 52/52 с настоящим Gitleaks, без skipped; `npm run check:kit`, `npm run format:check`, `npm run check:package`, `npm run doctor`, `git diff --check` прошли. Независимые literal M01–M10 проверяют own historical origin/deleted IDs, invalid duration/calendar, valid-pair unknown, preview category counts, exact originals/auth exclusion, stale sources/edges/raw history/context digests, private roundtrip, reopen/frozen replay, undo restore и полный rollback. Начальный RED — отсутствующие helper modules; отдельный mutation control удаления marker suppression дал два ожидаемых M05 отказа, после восстановления targeted suite зелёный.

Registry, active Repository/API/UI, Docker allowlists, lockfile и security policy не менялись. Runtime ещё использует 001/002. Browser E2E, Docker runtime smoke, linked-worktree workspace/preflight, production upgrade и remote actions не запускались. Synthetic undo restore проверяет persistence contract, не новый активный маршрут. Task 5 обязан атомарно сохранять marker при details/status/calendar/edges/restart, переносить его с работой при preserveWork и восстанавливать при undo; вызывать approval первым шагом IMMEDIATE transaction. Task 7 обязан учитывать marker при REAL/CPM допуске и сохранять frozen pending replies. Следующий шаг — два независимых review точного candidate SHA, затем Task 5; самостоятельное approval Task 4 не заявлено.

## Интеграция подготовительных Tasks 1–3 и плана CPM — 2026-10-07

Tasks 1–3 приняты после двух независимых review каждого checkpoint. Финальные substantive SHA: source contract `0930e51`, проекция `f0412fd`, migration/replay preparation `59580ad`. Task 3 payload-validation blocker закрыт повторными Spec и Standards APPROVED на `59580add9905addf03e57d76542227b85ed786e6`. Неактивные модули объединены в основном checkout; registry по-прежнему содержит только 001/002.

Технический CPM annex получил два независимых APPROVED на `29f193ea8dcd7ab0213fe84fc7dafa913a4a4b21`; последующий `889cb6a` фиксирует только review metadata, сохраняя substantive body и snippets. Реализация CPM не начата. Task 4 обязан представить reviewed durable unavailable outcome для невосстановимого legacy-интервала, включая retained valid source pair и undo; изменение scheduling input требует соответствующей поправки annex и двух новых review до Task 7.

Основной checkout прошёл `verify`: typecheck, lint, 362/362 application tests в 21 suite без пропусков и production build. `format:check`, `check:package`, staged diff check и полный `preflight` прошли: doctor, kit, 52/52 kit tests с настоящим Gitleaks, workspace/index/staged/history guards и scans. Browser E2E и Docker smoke не повторялись для неактивной подготовки; базовые browser tests ранее прошли 18/18. Production migration, публикация и внешние действия не выполнялись.

Следующая задача — Task 4: принятые C17 resolution rules, preview/digest acknowledgement и independent review; затем Task 5 атомарно переключает API/storage/UI. C16/C17 policy gates закрыты, application acceptance C05/OS16 и S4–S6 остаются впереди.

## Technical CPM annex Task 6 — 2026-10-07

Подготовлен [implementation annex C16](superpowers/plans/2026-10-07-explicit-date-cpm.md) и добавлена ссылка в ADR 008. Документ задаёт полный strict live/frozen union, совместимые с будущим Task 5 pure interfaces, рабочую координату и H/Hknown, critical edge predicate, literal numerical fixtures и исполнимые RED/GREEN шаги. Покрыты P01–P11/N06, fork/join/равные пути/разрывы, глубокие summary, blocked weak components, conflict+unknown, done, крайние даты, undo/restart и frozen pending replies. Сохранённый invalid/mismatch source остаётся unknown/incomplete без доказанного FS-конфликта по нормативной C16; это явная адаптация промежуточного Task 2, без исправления source.

Первоначальный кандидат проверен на закреплённом Node 24.21.0: независимый полный перебор допустимых задержек малых literal ready fixtures прошёл 12/12 без production solver/calendar imports; schema/domain/numerical-test фрагменты прошли strict typecheck в disposable future-target harness. Все 17 TypeScript/TSX фрагментов прошли синтаксический разбор. `npm run test:kit` прошёл 52/52, skipped 0, настоящий Gitleaks и synthetic hook scenarios. `npm run check:kit` прошёл (42 Markdown files, 152 local links, три references, исторические 10 CPM и четыре calendar examples); `git diff --check` и `git diff --cached --check` прошли. `security:staged` прошёл на трёх scoped blobs: privacy guard и Gitleaks без покрываемых находок. Проверки документа и isolated snippets не являются application GREEN; текущий runtime/schema/source/lockfile не менялись.

Substantive candidate `29f193ea8dcd7ab0213fe84fc7dafa913a4a4b21` получил два независимых verdicts: Spec **APPROVED**, Standards/executability **APPROVED**. Technical annex reviewed; application CPM implementation не заявлена. Task7 требует Task5 GREEN; C17 unavailable-lock handoff остаётся pending Task4/5, altered scheduling input требует amendment annex и двух новых reviews. C16/O06 policy CLOSED; реализация CPM, C05/OS16 и S4–S6 остаются впереди. Application tests/E2E, production migration, push и deployment не запускались.

Раунд 1: оба независимых reviewer дали CHANGES_REQUIRED. Исправленный кандидат добавляет positive F03+U partial task/edge DTO и отдельную UI подпись, P10 weekdays→all-days→undo с literal floats и одной revision, live-only safe internal500 validators для current paths и rollback injection, явную адаптацию existing Task2 suite с сохранением frozen parser expectations, Set-based diagnostic dedup и широкий synthetic fixture, concrete Repository/HTTP/legacy replay/UI/browser tests. Отдельно обозначена Task4/5 handoff граница unavailable historical done lock по C17; неоднозначный legacy исход не принимается как восстановленный lock.

Для исправлений прошли независимый delayed-placement oracle 13/13, синтаксический разбор всех 29 TS/TSX блоков и strict disposable future-target typecheck schema/domain/Task2 adaptation/server/API/UI/browser snippets. Изолированное исполнение pure annex snippets подтвердило F03+U partial AB/BC при некритичном AC, отсутствие global IDs, live rejection frozen pending и 20 000 Array.some callback checks для 10 000 unknown leaves. Это проверка фрагментов и заявленных future interfaces, не запуск будущих Repository/HTTP/browser suites. `check:kit` прошёл (42 Markdown files, 152 local links), diff checks и staged guard/Gitleaks прошли; обычные commit hooks включены. Неизменённый `test:kit` повторно не запускался. Application/runtime/schema/lockfile не изменены.

Последующая запись подтверждает только review metadata для approved substantive SHA выше; формулы, typed body и все 29 snippets побайтово сохранены. Для metadata-only revision прошли `check:kit`, diff checks и staged guard/Gitleaks на трёх документах, обычные commit hooks включены. Oracle/snippet/application checks повторно не запускались: исполняемый материал не менялся. APPROVED не переносится на иную реализацию.

## Task 3: исправление payload validation после review — 2026-10-07

Standards review candidate `68e6cd9bf89ffe7a126808cb991d5d9d333e0036` обнаружил P2: object-only проверка original operations.payload позволяла классифицировать unsupported version/command как legacy format 1. Spec review подтвердил inactive scope. Добавлены независимые frozen command/rename envelope schemas без нормализации: полная прежняя vocabulary, strict fields, UUID/revision/plan validation и привязка body.operationId к ключу operation row. Проверка выполняется до DDL; исходный payload text не заменяется parsed/normalized JSON. Active request schemas и runtime mutation/replay wiring не изменены.

18 отрицательных synthetic cases сначала дали RED: прежняя preparation принимала неизвестные версии/команды/режимы, лишние поля, неподдерживаемые envelopes и неверные/mismatched identities. Теперь каждый даёт safe INVALID_LEGACY_SNAPSHOT, сохраняя всю schema/current/history и отсутствие archive. Дополнительные положительные проверки покрывают все legacy command branches и три plan modes, raw rename/command whitespace, exact archive text/digest и canonical replay. Task 4 unavailable outcome gate остаётся отдельным; эта правка его не решает.

Прошли: focused compatibility/migration/legacy repository — 95/95; `test:integration` — 143/143; `test:kit` — 52/52 с настоящим Gitleaks без пропусков; `typecheck`, `lint`, `format:check`, `check:kit`, `git diff --check`, `git diff --cached --check`, `security:staged` и обычные commit hooks. Dependency symlink удалена и не staged. Unit/build/E2E/Docker/preflight повторно не запускались: correction ограничена неактивным legacy payload validation; общий checkpoint проверяет integrator. Registry, SQL/digest policy, active API/contracts, lockfile и security policy не менялись. Следующий шаг — independent re-review точного fix SHA.

## Task 3: compatibility preparation — 2026-10-07

Подготовлены неактивные frozen S2 schemas, byte-identical canonical helper, context/digest-bound mapper, lookup-only replay, private archive SQL 003 и synthetic migration helper. Target allowlist исключает legacy planning fields; source-only finish не меняется из-за deadline. Auto и done locks требуют отдельной resolution для каждого active/operation/undo context; duration/status сохраняются, ordinary source нельзя переписать resolution. Scalar stored duration не получает новый input cap. Category counts охватывают current и всю history, включая удалённые задачи. [ADR 007](adr/007-legacy-scheduling-migration.md) уточняет frozen response и transaction boundary.

Helper до DDL проверяет exact SQL digest, один archive marker, frozen schema/JSON, context coverage и все projections. Archive сохраняет lossless project/task scalar rows и byte-identical operation payload/response/undo JSON с SHA-256, не содержит auth/session копий и не зависит от active task. Внешняя immediate transaction включает archive, legacy column drops, source updates, frozen target responses/digests, migrated undo и запись версии 3. Replay после restart проверяет original canonical body/project/session и frozen response version/digest/schema; не читает current tree, не рассчитывает его и не создаёт mutation/undo. Synthetic старый registry 1/2 отвергает schema 3; записанная 3 не запускает повторную подготовку.

Добавлены 34 независимых synthetic tests: выбранные проекции M01–M10, строгий DTO, revision 9 при current 10/11, rename replay без normalization, 409 на изменённый payload/project/session/version, unknown operation без выполнения, safe internal errors при повреждении frozen response, exact archive/counts/auth/relations, источник каждой historical resolution, deleted undo task, malformed JSON/schema и полный rollback при abort version insert. Наборы проходят cleanup собственных disposable SQLite directories через finally. TDD: сначала module-not-found, затем 27/28 behavioral failures временных interfaces; отдельно RED на input cap для stored duration и разрешённую нежелательную source/duration rewrite, затем GREEN. Между проверками уточнены test expectations для ранее принятого pending результата Task 2.

Прошли: focused compatibility/migration/legacy repository — 62/62; `test:integration` — 110/110; `test:unit` — 219/219; `test:kit` — 52/52 с настоящим Gitleaks, без пропусков; `typecheck`, `lint`, `format:check`, production client/server `build`, `check:package`, `check:kit`, `doctor`, `git diff --check`. Перед scoped commit прошли `security:staged` и `git diff --cached --check`; обычные hooks остаются включены. Dependency symlink удалена и не входит в index.

Ограничения: active Repository/API/UI, contracts/scheduler, registry, Docker/package allowlists, lockfile и security policy не переключены; обычный openDatabase применяет только 1/2. Resolution rules и acknowledgement ещё не реализованы: здесь только synthetic chosen sources, нет разрешения на production migration. Legacy unavailable diagnostic проверена на source-preserving null pairs. Task 4 должен явно различать materialized и source-preserved-unavailable outcomes также при сохранённой valid explicit pair; текущий ResolutionIndex содержит только source и не несёт outcome. Существующая pair не объявляет невосстановимый lock восстановленным. Настоящий undo route, version headers/new target mutation digests, весь runtime upgrade и сохраняемый pending parser после CPM проверяются в Tasks 4–7. Browser E2E/Docker smoke/workspace preflight не запускались: preparation не подключена к приложению; общий preflight выполняет integrator после gate. Production данные и внешние действия не использовались.

Следующий шаг — два независимых review точного Task 3 commit; затем Task 4 C17 resolver/preview/acknowledgement и его independent review до Task 5 registry/API/UI checkpoint.

## Task 2: исправление после review — 2026-10-07

Spec review candidate `bd5bad5c8e1429e56a3af77db91b8cba640bf1db` получил APPROVED; standards review нашёл недетерминированный результат для повторного task ID с разными parent/source fields. Исправлен только неактивный модуль: duplicate identity прекращает расчёт до построения иерархии и coverage, возвращая pending infeasible, coverage 0/0, пустые проекции и safe diagnostics. Вход не изменяется; произвольная duplicate запись не используется для проекций.

Две независимые регрессии на точной malformed fixture и варианте с разными source fields сначала упали; GREEN проверяет все шесть перестановок каждой. Дополнительный контроль повторных dependency ID и пар с разными endpoints подтверждает детерминированность существующей сортировки и maps без изменения их алгоритма. Прошли `npm test -- tests/optional-scheduling.test.ts` — 51/51 без пропусков, `typecheck`, `lint`, `format:check`. Полные unit/integration/build/E2E повторно не запускались: правка ограничена ранее проверенным ранним отказом неактивного модуля на malformed graph. Active приложение, owner policy и shared contracts не менялись. Следующий шаг — independent re-review точного fix diff.

## Task 2 адаптации сроков — 2026-10-07

Подготовлены неактивные `src/domain/optional-scheduling-types.ts` и `src/domain/optional-scheduling.ts`: реальные пары без вывода отсутствующих границ из duration, проверка исходных FS-краёв, полный summary по конечным потомкам и отдельный conditional display. `knownStartMin` хранится независимо от валидности полного интервала и других source fields; сводный диапазон публикуется только при полном coverage ветви. Итеративные обходы поддерживают произвольную глубину и находят настоящие циклические компоненты без включения downstream задач. Узкий `validateOptionalDependency` копирует проверенный leaf-only validator; активные validator и Repository остаются прежними до Task 5.

Добавлены 48 независимых тестов с буквальными ожидаемыми датами/числами: N02–N04, рабочие/календарные выходные, одиночные границы FS, conflict вместе с unknown, finish-only пометка, weekend anchor, clipping без изменения source duration, malformed graph, 40/10 000 уровней, permutations и immutable inputs. Тип результата проверен на точное соответствие strict pending DTO при typecheck; synthetic UUID результат также проходит runtime schema. TDD RED наблюдался на отсутствующем модуле, затем на пяти N02/N04 failures временной заглушки и двух регрессиях независимой source-опоры. Финальный GREEN: targeted optional planning/scheduling/calendar — 94/94; `test:unit` — 216/216; `verify` — typecheck, lint, 292/292 application tests в 19 suites без пропусков и production client/server build. Отдельный `test:integration` прошёл 76/76. `format:check`, `check:package` и `check:kit` прошли; kit проверил 41 Markdown file, 140 local links и прежние numerical examples.

Перед коммитом прошли `git diff --check`, `git diff --cached --check` и `security:staged`: пять scoped blobs, privacy guard и настоящий Gitleaks без покрываемых находок. Временная dependency symlink удалена; она не входила в index.

Ограничение Task 2: `analysisStatus = pending-policy`, общие critical IDs пусты, floats и общий прогнозный finish отсутствуют. Промежуточная feasibility проверяет source/FS по brief: несвязанная unknown работа сама по себе не даёт incomplete, невалидный сохранённый source даёт infeasible. Это не конечная C16 семантика live CPM: Task 7 должен считать отсутствие валидного интервала incomplete, а infeasible давать при доказанном FS-конфликте; frozen pending replies сохраняют прежний outcome. Active contracts/API/UI, scheduler, SQLite schema/registry, lockfile и security policy не изменены. Browser E2E, Docker smoke и workspace/preflight этого linked worktree не запускались: новый модуль ещё не подключён к приложению. Пользовательский runtime и внешние действия не затронуты. Следующий шаг — два независимых review точного Task 2 candidate, затем Task 3 compatibility preparation и Task 6 CPM annex по approved plan.

## Task 1 адаптации сроков — 2026-10-07

Подготовлены неактивные `src/shared/optional-contracts.ts` и `src/domain/optional-planning.ts`: strict V2 формы без legacy planning fields, независимые nullable source поля, source patch с omission/null, проверка нового полного интервала и безопасное чтение сохранённой невалидной пары как `null`. Новый source валидируется только при изменении значения; text/status save и одинаковый patch не отклоняют прежний calendar-invalid ввод. Input duration ограничена 1–1 000 000, stored duration и производный span пары этим input cap не ограничены. `test:unit` включает новый независимый набор; [ADR 006](adr/006-optional-scheduling-contract.md) фиксирует W05, body/header version 2, exact legacy replay и frozen outcomes, сохраняя различие proposals, закрытых owner policy gates C16/C17 и будущих implementation/review dependencies.

TDD RED наблюдался сначала на отсутствующих modules, затем на 11 поведенческих failures из 38 при временной реализации без validator. GREEN: targeted optional/domain/calendar — 63/63; после корректировки типизированной тестовой фикстуры optional — 38/38. Прошли `typecheck`, `lint`, `format:check`, `test:unit` — 168/168, `test:integration` — 76/76, `build`, `check:package` и `check:kit` — 41 Markdown files, 140 local links, три references, прежние 10 CPM и четыре calendar examples. `git diff --cached --check` и `security:staged` прошли: шесть scoped blobs, privacy guard и настоящий Gitleaks без покрываемых находок.

Target modules импортируются только друг другом и тестами; active contracts/API/UI, SQLite schema/registry и lockfile не изменены. Browser E2E не запускались: Task 1 не подключает новое поведение к UI. Workspace/preflight linked worktree не запускались. После интеграции Task 1 на `0930e512cf01daefbbb099b3330346692ef2a738` получены два независимых APPROVED; координатор подтвердил targeted 63/63, typecheck и полный preflight обычного checkout: doctor 11/11, kit 52/52 без пропусков, workspace/index/staged/history guards и настоящий Gitleaks. Пользовательский runtime и внешние действия не затронуты. Следующая задача после Task 1 — Task 2: реальные интервалы, полный summary, diagnostics и отдельный conditional display по approved plan; CPM, legacy conversion и transport boundary остаются последующими tasks.

## Принятие политик O06 и legacy migration — 2026-10-07

Владелец принял [нормативное приложение](superpowers/specs/2026-10-07-optional-scheduling-policy-proposal.md): анализ введённых интервалов с общим горизонтом, раздельными резервами и честным unknown; однократную конвертацию доступных legacy Auto/done интервалов с exact archive и explicit preview. Добавлены C16/C17 и [ADR 007](adr/007-legacy-scheduling-migration.md)/[ADR 008](adr/008-explicit-date-cpm.md). O06/G-CPM и G-MIGRATION CLOSED как выбор политики. Синхронизированы START_HERE, DECISIONS, SCHEDULING, UI, ACCEPTANCE, ARCHITECTURE, IMPLEMENTATION_PLAN, базовая spec и её implementation plan. Код/API/schema ещё требуют реализации.

Установлены закреплённые Node 24.21.0 / npm 11.19.0 из официального Node distribution; SHA-256 архива проверен. Среда выбирается существующим `nvm use` по `.nvmrc`; выбор обеих версий проверен в отдельной оболочке. После синхронизации полный `npm run preflight` прошёл: doctor 11/11, 40 Markdown files / 133 local links, 52/52 kit tests без пропусков, workspace/index guards, Gitleaks workspace/staged, history/metadata guard и Gitleaks. Preflight не менял index. `git diff --check` прошёл.

Application tests, новая миграция и новый CPM не запускались: изменение документационное; P01–P11/M01–M10 пока не являются исполняемыми application tests. Independent APPROVED базовых spec/plan сохранены с прежними SHA и не выданы за review новых изменений. Owner policy закрыта; Task 4 resolution/acknowledgement implementation и Task 6 typed CPM annex/review ещё впереди. Следующий шаг — реализация по Tasks 1–3 и подготовка technical annex Task 6; при Task 5 обычный startup legacy БД должен отказать до writes без подтверждённого preview/digest. Production operation не выполнялась.

## Текущее состояние

2026-10-07: подтверждены [C11–C17](DECISIONS.md): исключён общий сценарий автоматического назначения сроков от начала проекта; начало, окончание и длительность задачи необязательны, отдельный дедлайн не нужен. Для подзадач без начала предусмотрена приглушённая полоса от минимальной известной даты с указанной длительностью или одним днём для отображения. Неопределимые сводные сроки не показываются. Приняты математическая политика CPM и однократная legacy конвертация; их реализация впереди. S2–S3 пока использует прежние defaults Auto/partial summary/deadline и не соответствует этому уточнению.

S0–S3 реализованы. Дерево и SVG-Гант используют один набор видимых строк и одну вертикальную прокрутку. Панель редактирует режим/длительность/ограничения, проект задаёт начало/календарь/часовой пояс. Выбранная схема показывает непосредственных соседей и отдельные реальные FS-рёбра. Сервер остаётся единственным источником расчёта; task.edit сохраняет текст, статус и план одной транзакцией и одной отменой.

Задачи без дат не получают полос; одиночные даты — пометки. Критичность отделена от статуса; coverage, partial, incomplete, fixed/done conflicts и дедлайн видны. Три утверждённых референса просмотрены; исключённый коллаж не используется. Только синтетические тестовые данные, пользовательский runtime не открывался.

Это ещё не готовая V1: S4 повседневный UX/доска, S5 restore/import/export и S6 приёмка остаются впереди. Зависимости, lockfile, схема БД, Git identity review и scanner policy не менялись в S3. Внешняя публикация и deployment не выполнялись.

| Этап | Статус |
|---|---|
| S0: репозиторий и исполняемый фундамент | Реализован и проверен |
| S1: дерево, панель, SQLite CRUD | Реализован и проверен; browser/restart scenarios проходят |
| S2: scheduling module и транзакции | Реализован, интегрирован и проверен: verify 186/186, browser E2E 12/12 и итоговый preflight прошли |
| S3: Гант, редактор плана и схема зависимостей | Реализован и проверен: verify 206/206, browser E2E 18/18; ограничения ниже |
| S4: повседневный UX и доска | Не начат |
| S5: self-hosting и сохранность данных | Есть Docker/Compose, consistent backup и проверка synthetic migration 001 → 002; restore/import/export и полноценный upgrade не реализованы |
| S6: релизная приёмка | Не начат |

## Следующая задача

Сначала адаптировать планирование к C11–C15: необязательные даты/длительность, отсутствие общего сценария Auto от начала проекта и отдельного дедлайна, приглушённые полосы подзадач без начала и скрытие неопределимых сводных сроков. Уточнить O06 (критический путь по явным датам), подготовить совместимое изменение API/хранения и независимые тесты; не терять существующие данные. Затем выполнить S4: поиск/фильтры с родительским контекстом, повседневный UX и иерархическая доска. Дизайн доски остаётся рабочим предложением и требует отдельной визуальной проверки владельцем. Далее S5 restore/import/export и S6 релизная приёмка. Перед внешней публикацией отдельно нужны поручение владельца, проверка remote CI/серверной защиты и решение о лицензии.

## План адаптации сроков — 2026-10-07

Финальная локальная интеграция: исходный коммит договорённостей `6317791dff9dc944de3a1676effebcf1322b2ff6` сохранён до документальных работ; одобренные спецификация и план перенесены fast-forward до `c4c8193ed82c464998f16bd163def93c22a22fe2` в основной checkout. Итоговая запись меняет только review metadata в STATUS, IMPLEMENTATION_PLAN и плане; requirements, нормативная спецификация и fenced examples не изменены. Внешние действия и пользовательский runtime не затронуты.

Финальные проверки в основном checkout: `check:kit` — прошло (37 Markdown files, 96 local links, три references, исторические 10 CPM и четыре calendar examples); `test:kit` — прошло 52/52, skipped 0, настоящий Gitleaks; `git diff --check` — прошло; `security:workspace` — прошло (157 entries); `security:staged` — прошло (три changed blobs); `security:history` на интегрированном candidate — прошло (156 index entries, 289 historical versions / 20 metadata objects), guard и Gitleaks без покрываемых находок. Обычные commit hooks остаются включёнными. Один полный `preflight` — не прошло: остановился на doctor exact Node check (24.19.0 вместо 24.21.0); остальные doctor checks прошли, последующие preflight stages не выполнялись. npm 11.17.0 вместо зафиксированной 11.19.0; pins, инструменты и политики не менялись. Typecheck/lint/application unit/integration/E2E и production migration не запускались: итоговая задача меняет только Markdown; новые fenced tests и примеры не выдаются за исполненную реализацию.

После двух положительных независимых ревью спецификации на `69b05dca5cf0c2c248eb9843b38f4f5b6f91c857` отдельный агент подготовил [план реализации](superpowers/plans/2026-10-07-optional-scheduling.md). Семь задач задают точные files/interfaces, независимые source/FS/summary/display/migration/replay/undo/UI примеры, RED/GREEN команды, scoped commits и два независимых review на каждом checkpoint. Неактивная подготовка отделена от единого переключения API/хранения/UI; добавление автоматически применяемой migration 003 находится после G-MIGRATION. Для настоящего CPM нужен owner decision G-CPM/O06, математический ADR и отдельно одобренный численный implementation annex. W01–W06 остаются техническими предложениями, оба policy gates открыты.

Авторский coverage/placeholder/type review документа выполнен. Раунд 1 на `1a151c29c81d78096b634eb7e2458443f5a61c51`: оба независимых plan reviewer — CHANGES_REQUIRED. Закрыты пять blockers: отдельные source markers и literal UI tests, pinned unchanged S3 source/build/browser upgrade refusal с original ApiError probe, удаление выбранной задачи с сохранностью dirty draft и focus, frozen target replay после migration/restart при immutable original payload/archive и полные exported schemas/test helper definitions. Раунд 2 на `c4c8193ed82c464998f16bd163def93c22a22fe2`: соответствие спецификации — APPROVED; исполнимость/standards — APPROVED. Нормативная approved spec не менялась. Application source, SQL, fixtures, lockfile и runtime не менялись; fenced examples не исполнялись как реализация. Application tests/E2E и production migration не запускались. Следующий шаг — отдельное поручение владельца на реализацию; G-CPM/O06 и G-MIGRATION открыты, положительные документальные ревью не выбирают owner policy и не начинают реализацию.

Проверки первого кандидата: `npm run check:kit` — прошло (37 Markdown files, 96 local links, три references, исторические 10 CPM и четыре calendar examples); `git diff --check` — прошло. `npm run test:kit` — прошло 52/52, skipped 0, настоящий Gitleaks и синтетические hook scenarios; fenced examples не исполнялись. `npm run security:staged` — прошло, четыре changed blobs; `npm run security:history` — прошло, 156 index entries и 283 historical versions / 18 metadata objects до candidate commit, guard и Gitleaks без покрываемых находок. Обычные commit hooks остаются включёнными. `npm run doctor` — не прошло exact Node check (24.19.0 вместо 24.21.0), остальные конфигурационные проверки прошли; npm 11.17.0 вместо зафиксированной 11.19.0. Public workspace/preflight linked worktree не запускались повторно: прежний служебный `.git` pointer refusal не обходится, интеграционная проверка нужна в обычном checkout.

Для исправлений раунда 1 повторно прошли `check:kit` (37/96), `git diff --check`, `git diff --cached --check`, `security:staged` (два changed blobs) и `security:history` (156 index entries, 287 historical versions / 19 metadata objects до нового коммита), включая настоящий Gitleaks. Изменены только plan/STATUS; source и security/hook policy не менялись. Ранее прошедший `test:kit` повторно не запускался; application/E2E tests и pinned build examples ещё не исполнялись, поскольку это документальный кандидат. Exact Node/npm и linked-worktree workspace/preflight ограничения сохраняются.

## Спецификация адаптации сроков — 2026-10-07

Создана [спецификация C11–C15](superpowers/specs/2026-10-07-optional-scheduling-design.md): traceability, nullable-поля, реальные и условные интервалы, полный summary, FS без автосдвигов, persisted deadline/history/replay/undo и независимые примеры N01–N06 с критериями OS01–OS17. Технические предложения W01–W06 явно отделены от решений владельца. O06 остаётся открытым в G-CPM; G-MIGRATION отдельно ограничивает production-переход legacy Auto/done, не скрывая изменения прежнего расписания. Согласованы актуальные ссылки в SCHEDULING/ARCHITECTURE/IMPLEMENTATION_PLAN и противоречившие уточнению критерии ACCEPTANCE; исторические планы S2–S3 сохранены.

Код, schema, lockfile, fixtures и пользовательский runtime не изменены. Три утверждённых PNG просмотрены; исключённый референс не использован. Авторская проверка документа выполнена. Раунд 1 независимого ревью на f31e29a: требования — APPROVED, техническая совместимость — CHANGES_REQUIRED. Закрыты два blockers: server-side HTTP426 для unversioned S3 до mutation/DTO/cached response и transport-only target-aware exact legacy replay без изменения archived canonical payload; дополнительно уточнены A07/A12. Проверена совместимость refusal со старым error parser/UI. Раунд 2 на `69b05dca5cf0c2c248eb9843b38f4f5b6f91c857`: оба независимых reviewer — APPROVED. O06/G-CPM и G-MIGRATION открыты; одобрение документа не начинает реализацию.

Проверено: `npm run check:kit` — прошло (36 Markdown files, 88 local links, три references, прежние 10 CPM и четыре calendar examples); `git diff --check` — прошло. Kit не исполняет новые N01–N06 и не проверяет адаптацию приложения. Независимая арифметическая проверка календарных чисел N01/N02/N04 и резервов гипотетического N06 стандартной библиотекой прошла; это не application test. `npm run test:kit` — прошло 52/52, skipped 0, настоящий Gitleaks; `npm run security:staged` — прошло (шесть changed blobs); `npm run security:history` — прошло (274 file versions / 16 metadata objects до кандидат-коммита), guard и Gitleaks без покрываемых находок. `npm run doctor` — не прошло exact Node check (фактически 24.19.0, требуется 24.21.0), остальные проверки doctor прошли. `npm run security:workspace` — не прошло в linked worktree: PERSONAL_HOME_PATH на служебном `.git` pointer; политика не менялась. Полная workspace-проверка требуется после интеграции в обычный checkout. Для исправлений раунда 1 повторно прошли `check:kit` (36/88), `git diff --check` и `security:staged` (три changed blobs). Hook/security policy и executable код не менялись; ранее прошедший test:kit повторно не запускался. Application tests/E2E и production migration не запускались: задача документальная.

## Исключение отдельного дедлайна — 2026-10-07

Зафиксировано подтверждённое решение C15: отдельный дедлайн не нужен; необязательная дата окончания сохраняется. Согласованы DECISIONS, SCHEDULING, UI, ACCEPTANCE (A16), ARCHITECTURE, START_HERE, AGENTS и этот журнал. Прежние deadline-поля в описании реализованной модели и историческом scheduler-контракте явно обозначены как требующие адаптации.

Код, API, схема БД и сохранённые данные не изменялись; поле пока остаётся в приложении. Application tests и E2E не запускались, поскольку изменение только документационное. Следующий шаг — исключить deadline при совместимой адаптации планирования к C11–C15.

Проверено: `npm run check:kit` — прошло (35 Markdown files, 75 local links, три утверждённых references, 10 CPM и четыре calendar examples); `git diff --check` — прошло. Эти проверки документации не подтверждают удаление поля из приложения.

## Уточнение модели сроков — 2026-10-07

Изменённые области: DECISIONS, SCHEDULING, UI, START_HERE, AGENTS и этот журнал. Зафиксированы подтверждённые правила C11–C14; прежний scheduler-контракт явно отделён от целевых требований. Уточнение владельца возвращает необязательную длительность и допускает приглушённые полосы подзадач без начала. D13 отдельно обозначает рабочие границы отображения: реальные пары дат определяют полосу, без точки привязки приглушённая полоса не рисуется, визуальные значения не сохраняются и не входят в сводный расчёт/CPM. Критический путь и визуальные зависимости не отменены; адаптация расчёта отмечена O06.

Код, схема БД, fixtures и пользовательский runtime не изменялись. Application tests и E2E не запускались: поведение приложения этим документальным уточнением не меняется. Следующая задача — согласовать расчёт по явным датам и реализовать адаптацию.

Проверено: `npm run check:kit` — прошло (35 Markdown files, 74 local links, три утверждённых references, 10 CPM и четыре calendar examples); `git diff --check` — прошло. Эти проверки документации не подтверждают соответствие приложения новым требованиям.

## S3 — 2026-10-07

Изменённые области: client Gantt/TaskTimeline, общая геометрия и календарные intent helpers, PlanFields/ProjectPlan/ScheduleStatus, Dependencies, TaskPanel/App/tree labels/styles; shared task.edit contract и Repository command composition; independent unit/client/API/SQLite fixtures и браузерные сценарии. [Спецификация](superpowers/specs/2026-10-07-s3-planning-ui-design.md), [план](superpowers/plans/2026-10-07-s3-planning-ui.md) и [ADR 005](adr/005-planning-ui.md) описывают реализацию существующих требований и defaults.

Гант поддерживает дни/недели/месяцы, today по часовому поясу проекта, отдельную горизонтальную прокрутку, клавиатурный и pointer-разделитель, обычные/сводные полосы, пометки и реальные FS-стрелки между видимыми работами. Видимое окно ограничено 90/180/366 днями; большие допустимые длительности не создают миллионы SVG-элементов. Collapse меняет только общие строки отображения. Прямые зависимости не подменяются связями родителей.

Pointer drag/resize сохраняет ровно одну команду на отпускание, Escape отменяет preview. Auto move задаёт notBefore, resize — длительность; допустимость FS и CPM пересчитывает сервер. Fixed границы не нормализуются молча; done и summary заблокированы для жестов. Клавиатура и поля дают альтернативу. Детали+план сохраняются одной task.edit; перед планированием done требуется явное изменение статуса. Недопустимый Fixed откатывает также текст и историю операций. Потерянный ответ сохраняет черновик и тот же envelope для повтора.

Граф показывает до четырёх соседей на секцию с «Показать ещё», критическую связь с текстом и отдельную стрелку на каждое ребро. Допустимые кандидаты фильтруются общим domain validator; цикл объясняется названиями. Удаляется связь; переход заменяет выбранную задачу, доступен возврат. «Показать на Ганте» раскрывает предков и нужный период. Компактные даты дополняются полными ISO-датами в accessible labels и tooltip.

Проверено на закреплённых Node 24.21.0 / npm 11.19.0 без изменения глобальной конфигурации:

- `npm run verify` — прошёл: typecheck, lint, 206/206 application tests в 17 suites, skipped 0, production client/server build.
- `npm run test:e2e` — прошёл: 18/18 Chromium scenarios на 1440×900 и 1280×800, retries/skipped 0. Реальный UI проверяет T=8 → T=10 → одну отмену, смену критической ветви, summary, граф, cycle explanation, drag/resize/cancel, keyboard/divider, Fixed/Auto, deadline, unknown и done locks. Перезапуск сохраняет план. На длинном синтетическом списке после вертикальной прокрутки координаты строки и Ганта совпадают; бездатные строки остаются пустыми.
- Синтетические снимки главного окна, деталей и графа на обоих viewport — все шесть открыты и просмотрены. Компактная панель, лёгкое дерево/Гант и отдельные стрелки соответствуют характеру трёх референсов. PNG не добавлялись в репозиторий.
- `npm run format:check`, `npm run check:package`, `npm run check:kit` и `git diff --check` — прошли. Kit проверил 35 Markdown files / 69 local links, три references и независимые numerical fixtures.
- Новые тесты сначала воспроизводили отсутствие task.edit/UI; после реализации прошли. Regression exact retry подтверждает сохранение планового черновика и исходного operationId после потерянного ответа. Graph pagination сохраняет текущую карточку и оставшихся соседей после удаления последнего элемента страницы.
- `npm run preflight` — прошёл: doctor, kit, 52/52 real-Gitleaks/hook tests без пропусков, public workspace guard и Gitleaks, index guard, staged configuration и history/metadata guard+Gitleaks. До staging S3 workspace содержал 155 entries; index 136 entries; история 232 file versions / 14 metadata objects. Подготовленные blobs проверяются отдельно перед коммитом.

Не выполнены в S3: повторный Docker build/smoke, AMD64/HTTPS/remote CI, performance acceptance целевого размера, restore/import/export и S6. Существующая контейнерная проверка S2 не выдаётся за новый S3 smoke. Синтетические snapshots остаются вне checkout и не добавляются в public asset manifest. V1 не объявляется готовой.


## S2 — 2026-10-07

Изменённые области: чистые calendar/scheduling/planning domain modules, shared DTO и команды, SQLite migration 002, Repository snapshots/transactions/undo, API расписания, точная упаковка миграций и тестовые fixtures. [План](superpowers/plans/2026-10-07-s2-scheduling.md) и [ADR 004](adr/004-scheduling-transactions.md) фиксируют реализацию существующих рабочих defaults без превращения их в решения владельца.

Поддержаны Unscheduled/Auto/Fixed, оба календаря, исходные даты, notBefore, deadline, ограничения фиксированных и выполненных работ, coverage и partial summary. Неизвестные связанные работы блокируют downstream; циклы, повторные/межпроектные рёбра и summary endpoints отклоняются до сохранения. Конверсия листа в summary переносит работу и оба конца зависимостей в work-child. Удаление убирает инцидентные связи, одна отмена восстанавливает весь план. Ответы проверяются Zod до commit; некорректный внутренний DTO даёт безопасный 500 и полный rollback. Миграция сохраняет исходные задачи/аккаунт/даты, очищая несовместимый старый формат undo/operations.

Существующая правая панель совместима с scheduled tasks: сохранение названия с неизменными датами не меняет план. Параметры планирования и зависимости пока доступны через API; интерфейс их редактирования относится к S3. Проверен расчёт T=8 → T=10 со сменой критического пути, возврат T=8 одной отменой и сохранность после настоящего перезапуска.

Закрыты два review findings: отсутствующий origin при deadline у unscheduled task и валидация исходящего ответа до commit. Scoped re-review обеих правок прошли. Полный verify также закрывает предыдущую волну admin/auth: readline/promises сохраняет редактирование скрытого пароля при TERM=dumb; три проверки TERM и существующие синтетические reset/login scenarios проходят. Dev smoke использует собственные два порта; обычный Vite default 5173 сохранён.

Проверено на закреплённых Node 24.21.0 / npm 11.19.0 без изменения глобального окружения:

- `npm run verify` — прошёл: typecheck, lint, 186/186 application tests в 13 suites, skipped 0, production client/server build.
- `npm run format:check`, `npm run check:package`, `git diff --check` — прошли.
- `npm run test:e2e` — прошёл после переноса в основной checkout: 12/12 Chromium scenarios на 1440×900 и 1280×800, retries/skipped 0. Проверены планирование, отмена, сохранность после перезапуска, подтверждение/отмена преобразования работы и перенос обоих концов зависимостей.
- Docker build и synthetic smoke — прошли на ARM64: migration 002, native SQLite, FS даты, undo, WAL backup, non-root/read-only, graceful stop/restart persistence. Все 37 production inputs основного checkout совпадают с проверенной сборкой; после переноса Docker checks не повторялись.
- Полный публичный source snapshot — privacy guard проверил 136 entries; реальный Gitleaks не нашёл утечек. Guard и scanner policy не менялись.
- Финальное независимое review выявило один P2: клиентское подтверждение сохранения работы не учитывало undated done/Auto/deadline/связи. Общий чистый predicate синхронизировал клиент и сервер. 16 регрессий проверяют создание/перенос, подтверждение/отмену и пустые/сводные цели; реальный браузерный сценарий проверяет перенос работы и обоих концов связей. Scoped re-review закрыл P2; новых замечаний нет.
- После переноса основной checkout прошёл `npm run verify` с 186/186 tests, typecheck, lint и build; `format:check`, `check:package` и `git diff --check` прошли. До переноса S0/S1 verify также проходил с 102/102 tests.
- Root `npm run preflight` после переноса — прошёл: doctor, kit (32 Markdown / 62 links), 52/52 real-Gitleaks/hook tests, workspace (137 entries), index (119 entries), staged (0 changed blobs), history (189 file versions / 13 metadata objects) и Gitleaks. Index не менялся.

Только disposable synthetic SQLite, аккаунты, задачи и container volume. Production/private данные не читались, index не менялся, commits/push/deployment не выполнялись. Не выполнены: S3 UI, S6 acceptance, remote CI, AMD64 smoke, HTTPS reverse proxy, restore/import/export и полный upgrade/restore процесс.

## Восстановление локального входа — 2026-10-07

В исходном CLI на отдельной синтетической базе воспроизведено попадание служебных байтов стрелок и bracketed paste в пароль: setup проходил, ожидаемый пароль получал `INVALID_LOGIN`. Обычный ввод, Unicode и Backspace работали. `readPassword` переведён на Node readline с отключённой историей и заглушённым выводом; добавлены проверки редактирования, разорванных последовательностей клавиш, повторных запросов, отмены, EOF и ограничения длины.

Добавлены `npm run admin:reset-password` и `make admin-reset-password` (с предварительной сборкой). Локальный TTY и двукратный скрытый ввод обязательны. Новый хеш, отзыв всех сеансов и очистка истории отмены фиксируются атомарно; проекты, задачи и ревизии сохраняются. Повторная проверка хеша внутри транзакции login не позволяет входу, начатому до reset, выдать сеанс по старому паролю. HTTP endpoint восстановления отсутствует. Решение описано в ADR 003; обновлены README и DEPLOYMENT. Схема БД, зависимости, lockfile и scanner policy не менялись.

Проверено:

- `npm run typecheck`, `npm run lint` — прошли.
- `npm test -- tests/domain.test.ts tests/admin.test.ts tests/client tests/repository.test.ts tests/api.test.ts tests/runtime.test.ts tests/backup.test.ts` — 98/98 tests в 7 suites, skipped 0. Проверены сохранность задач, отзыв сеансов, старый/новый пароль, rollback, гонка login/reset и отказ CLI без TTY или с аргументом пароля.
- `make test-e2e` — production build и 8/8 browser scenarios прошли.
- Реальный disposable PTY с собранным CLI — setup и вход прошли для обычного ввода, Unicode, Backspace, стрелок и bracketed paste. Настоящий `make admin-reset-password` прошёл: несовпадающее подтверждение сохраняет старый пароль, успешное подтверждение меняет пароль, символы пароля не выводятся.
- `make format-check`, `make check-kit`, `make check-package`, `make security-workspace`, `git diff --check` — прошли.

Не запускались: `tests/dev.test.ts` и полный `verify` (порт 5173 занят существующим dev-сервером), Docker smoke и preflight. Версии среды остаются указанными в записи Make-команд. Пользовательские пароли и базы не открывались и не менялись; причина конкретного отказа входа не подтверждена. Следующий продуктовый этап — S2.

## Подсказка первого входа — 2026-10-07

Обновлён текст setup-required в `src/client/strings.ts`: причина отсутствия формы входа, локальная команда `make admin-setup` из каталога проекта, отдельная команда Docker Compose и указание задать пароль и обновить страницу. Существующий клиентский тест теперь ожидает Make-команду. Логика входа и CLI не менялись; пользовательский runtime не открывался.

Проверено: `make verify` (typecheck, lint, 84/84 tests и build), `make format-check`, `make check-kit`, `git diff --check` — прошли. Для этой текстовой правки browser E2E и preflight не повторялись; ограничение версии Node из записи Make-команд сохраняется. Следующий продуктовый этап — S2.

## Make-команды — 2026-10-07

Добавлен корневой Makefile со справкой по умолчанию и командами установки, запуска, сборки, тестов, настройки аккаунта, миграций, backup и kit/privacy проверок. Рецепты вызывают существующие npm-скрипты. Make задаёт внешний каталог разработки по умолчанию и сохраняет приоритет явного `LEAF_DATA_DIR`; `db-backup` требует `BACKUP` и передаёт путь одним аргументом; `test-e2e` сначала выполняет build. Обновлены README и BOOTSTRAP. Код приложения, зависимости, схема и security policy не менялись.

Проверено:

- `make help` и dry-run основных команд — прошли. Отдельный disposable smoke без настоящего npm/runtime проверил безопасную команду по умолчанию, default/env/CLI выбор каталога, backup с пробелами и shell-разделителем в имени, отказ без пути и последовательность build → E2E при `-j4`, включая остановку после ошибки сборки.
- `make verify` — прошли typecheck, lint, 84/84 tests в 7 suites и production build.
- `make test-e2e` — сборка и 8/8 Chromium scenarios прошли, retries/skipped 0; только синтетические данные.
- `make check-kit`, `make format-check`, `make check-package`, `make security-workspace`, `git diff --check` — прошли.

Ограничение среды: в текущем терминале Node 24.19.0 / npm 11.17.0 / GNU Make 4.3. `npm run doctor` не прошёл exact Node check: проект требует Node 24.21.0; остальные проверки doctor прошли. Результаты этой волны получены на текущих версиях и не заменяют проверку закреплённой среды. Полный preflight не повторялся. Установка пакетов/браузера/хуков и команды аккаунта/БД через Make проверены без реального выполнения; существующий runtime не открывался. Следующий продуктовый этап — S2.

## S0–S1 — 2026-10-07

Изменённые области: строгая TypeScript/tooling среда и exact lockfile, shared/domain/API/storage/auth/runtime/CLI, клиент и HTTP tests, browser harness, Docker/Compose, application CI, README/BOOTSTRAP/DEPLOYMENT и план реализации. S1 реализован в рамках утверждённого spec. API защищает JSON/origin, ревизии, idempotency, rollback и undo; local setup скрывает пароль. Runtime storage и все synthetic DB находятся вне checkout.

Добавлены реальные browser сценарии для создания проекта/дерева, ввода/очистки дат, статуса/описания, collapse/keyboard/move, удаления ветки/undo, reload и actual process restart. Проверены отказы foreign/missing origin и потерянный ответ после реального committed save: черновик/ошибка видимы, точный retry не применяет команду повторно. При 1024 и 990 px child/sibling action раскрывает доступный быстрый ввод; ниже breakpoint исправлено перекрытие редактора чистой панелью. Dirty-panel protection сохранена.

Локальный dev smoke проверяет custom server port, Vite proxy, browser origin и graceful shutdown обоих дочерних процессов. Native backup тестирует committed WAL при открытом writer, integrity, права 0600/0700 и отказ overwrite/symlink/checkout destination. Контейнерный smoke использует только новый synthetic named volume: non-root, read-only filesystem, loopback, healthcheck, static-root isolation, real SQLite write, CLI setup/backup, SIGTERM exit 0 и restart persistence. Контейнер и его том удалены после smoke.

| Проверка | Результат |
|---|---|
| `npm ci --strict-allow-scripts --no-audit --no-fund` | Прошло по exact lockfile, 273 packages. |
| `npm run verify` | Прошло: typecheck, lint, 76/76 tests в 7 suites и production client/server build. |
| `npm run format:check` / `npm run check:package` | Прошло. |
| `npm run test:e2e` | Прошло: 6/6 Chromium scenarios на 1440×900 и 1280×800, без skipped/retries; narrow actions также при 1024 и 990 px. |
| Синтетические screenshots | Оба открыты и просмотрены; header bounds внутри viewport, дерево/панель читаемы. Approved asset manifest не менялся. |
| `npm run check:kit` / `npm run test:kit` | Прошло: 29 Markdown files, 51 local links, три references; 52/52 real-scanner/hook tests, skipped 0. |
| `npm audit` и `npm audit --omit=dev` | Прошло: 0 vulnerabilities при moderate threshold. |
| Docker build / Compose config / runtime smoke | Прошло на Linux ARM64, including real native SQLite/CLI/health/restart. |
| `git diff --check`, staged diff, `security:staged` / `security:history` | Прошло: 27 changed index blobs; история и metadata также прошли guard/Gitleaks. |
| `npm run preflight` после интеграции | Прошло в обычном checkout на `0e97e22`, Node 24.21.0 / npm 11.19.0: doctor, kit, workspace, index, staged, history/metadata и Gitleaks; 52/52 kit tests, skipped 0; 119 index entries, 178 historical file versions, 10 metadata objects. |
| Финальный whole-branch review | Выполнен; найденный дефект быстрого ввода и два замечания к harness исправлены отдельной волной и закрыты scoped re-review без новых Critical/Important или out-of-scope findings. |

Историческое ограничение Task 3 worker: linked-worktree guard отклонял корневой `.git` pointer по PERSONAL_HOME_PATH; policy не менялась, preflight в worktree не запускался. Preflight исходной интеграции выполнен основным агентом в обычном checkout на `0e97e22` и прошёл полностью; после review fixes новый полный preflight также прошёл на `020f3d4`.

Не выполнены: remote CI execution, AMD64 container smoke, HTTPS reverse proxy, restore/import/export, previous-schema upgrade, scheduling/Gantt/dependencies/CPM, S6 acceptance. Browser snapshots только синтетические и вне публичных assets; traces/video и CI uploads отсутствуют. Документация не содержит raw reports, runtime данных или личных путей.

## S0–S1 — исправления финального review, 2026-10-07

Исправлен quick-add после удаления, undo и переноса задач: общий `apply()` проверяет ссылки только принятого снимка текущего проекта после revision guard. Исчезнувший родитель возвращает контекст к корню проекта, исчезнувший или перенесённый якорь удаляется. Текст и допустимые parent/anchor сохраняются; per-project drafts, dirty guards, conflict recovery и точный retry не меняют контрактов. Новые независимые HTTP fixtures проверяют удаление единственного корня, undo создания, исчезновение родителя при delete/undo, перенос/удаление якоря, сохранение допустимого контекста и отказ старого conflict snapshot с последующим свежим reload.

Readiness fetch реального E2E-процесса ограничен AbortSignal timeout. Cleanup охватывает весь lifecycle после создания собственного временного каталога, включая setup БД/аккаунта и резервирование порта. БД и listeners закрываются, завершение процесса ожидается даже после SIGKILL; удаление собственного synthetic runtime выполняется в finally при ошибках остановки. Dev smoke использует ту же раннюю границу cleanup. Схема, серверная семантика, lockfile, security policy и зависимости не изменены.

| Проверка этой волны | Результат |
|---|---|
| RED на исходном коде | 6 новых клиентских регрессий упали, 26/32 прошли; настоящий Chromium delete→create regression также упал. |
| Focused GREEN | 34/34: 33 React cases и один real dev-process smoke. |
| Финальный `npm run verify` | Прошло: typecheck, lint, 84/84 tests в 7 suites, production client/server build; skipped 0. |
| `npm run format:check`, `git diff --check` | Прошло. |
| `npm run test:e2e` | Прошло: 8/8, 1440×900 и 1280×800, retries/skipped 0; delete→create с подтверждением и сохранением после browser reload. |
| Внешние synthetic probes | Прошло: ранний account setup failure и реальный nonzero child/stop failure оставляют собственный runtime очищенным; TCP listener без HTTP headers вызывает timeout, затем readiness реального процесса проходит. |
| Scoped re-review исправлений | Прошло: I1/M1/M2 закрыты; новых Critical/Important и out-of-scope findings нет. |
| Новый root `npm run preflight` | Прошло в обычном checkout на `020f3d465bfcd57cc7db01361fec00c48c914eb4`, Node 24.21.0 / npm 11.19.0: doctor, kit (29 Markdown / 51 links), 52/52 real-scanner kit tests, skipped 0, workspace/index (119 entries), history (187 file versions / 12 metadata objects), guard/Gitleaks. Full preflight в linked worktree не запускался и policy не ослаблялась. |

Предыдущие audit и Docker/native backup результаты выше не повторялись для этой ограниченной волны. Kit suite повторён основным агентом в новом root preflight после интеграции исправлений. Remote CI, другие архитектуры контейнера, HTTPS proxy, restore/import/export/upgrade и S2/S3 по-прежнему не проверены заново. Следующая продуктовая задача — S2; контрольный scoped review и root preflight завершены.

## REPO-INIT — 2026-10-06

Результат: локальный репозиторий и защитные хуки подготовлены по START_HERE, BOOTSTRAP и PRIVACY. Изменённые области: файлы комплекта в корне, executable bits обоих хуков, этот отчёт; Git-конфигурация только локальная. Remote не задан; публикация, push и deployment не выполнялись.

Среда проверок: Node **v24.19.0**, npm **11.17.0**, Git **2.43.0**. Установлен Gitleaks **8.30.1** из официального release; SHA-256 архива и checksum manifest сверены с digest release assets. Исполняемый файл находится вне репозитория.

| Проверка | Результат |
|---|---|
| Распаковка | Все файлы (51) сверены с исходным архивом; дополнительной вложенной папки нет. |
| `npm run check:kit` | Прошло: 24 Markdown-документа, 39 ссылок, 3 референса, 10 CPM и 4 календарных примера. |
| `npm run test:kit` | Все 14 тестов прошли; пропущенных нет. |
| `npm run security:workspace` | 51 файл проверен; находок по реализованным правилам нет. |
| `npm run hooks:install` | Установлены pre-commit и pre-push; executable bits восстановлены после ZIP. |
| Git ignore | 14 синтетических приватных путей игнорируются; 4 необходимых публичных пути разрешены. |
| Референсы PNG | Все три просмотрены; текстовые/EXIF chunks и данные после IEND отсутствуют. |
| `git diff --cached --check` | Прошло. |
| `npm run security:staged` | Privacy guard и Gitleaks прошли; pre-commit также выполнил обе проверки. |
| `npm run security:history` | Tracked/history guard и Gitleaks прошли после начального коммита. |

Не выполнены проверки приложения, сборка, браузерные E2E и Docker: соответствующего кода ещё нет. Удалённый CI и серверная защита Git не проверялись. Сканеры не заменяют ручной privacy-review перед публикацией. Инициализация репозитория не означает завершение S0 или готовность leaf V1.

## REPO-AUDIT — 2026-10-06

Результат: проверены инструкции Codex/Claude Code, служебные проверки, Git hooks, CI и границы защиты публикации. Общая политика и импорт `@AGENTS.md` соответствуют актуальным форматам; проект имеет работающую часть harness для проверки комплекта, но ещё не имеет исполняемого приложения и проверок поведения агентов. Изменён только этот журнал; исправления защитных механизмов не выполнялись.

Проверено в текущем клоне:

- `npm run check:kit` — прошло: 24 Markdown-документа, 39 ссылок, 3 референса, 10 CPM и 4 календарных примера.
- `npm run test:kit` — 14/14 прошли, без пропусков.
- `npm run security:workspace` — 51 файл, находок по реализованным правилам нет; перед запуском проверено отсутствие приватных путей без чтения их содержимого.
- `npm run security:staged` — прошло на пустом индексе изменений; это не проверка нового содержимого.
- `npm run security:history` — прошло: 51 текущая запись, 52 исторических варианта, Gitleaks 8.30.1 проверил 2 коммита.
- Подтверждены `core.hooksPath=.githooks` и executable bits обоих хуков; настройки не изменялись.

В отдельных временных репозиториях с синтетическими данными воспроизведены ограничения:

1. Токен в сообщениях коммита и аннотированного тега не обнаруживается history guard/Gitleaks. Положительный контроль: тот же синтетический токен в staged/committed файле блокируется Gitleaks; значение не выводится.
2. Корректный PDF, состоящий из ASCII-байтов, проходит guard без записи в public-assets manifest.
3. Сохранение старого одобренного хеша для изменённого asset, требуемое PRIVACY, приводит к отказу `check:kit`, который сравнивает каждый исторический хеш с текущим файлом.
4. Workspace guard читает содержимое запрещённого файла перед сообщением об отказе. Проверено только на синтетическом `.env.audit`; реальные приватные файлы не читались.

По конфигурации: `.claude/settings.json` не включает sandbox; Read deny не покрывает все варианты `.env.*`, uploads/logs и не заменяет изоляцию subprocess. START_HERE безусловно направляет агента к S0 и широкому чтению документации, хотя для аудита или узкой правки нужен только контекст задачи.

Не проверено: удалённый CI, серверные push protection/rulesets, загрузка инструкций в отдельной сессии Claude Code, application tests/build/E2E/Docker. Временные синтетические репозитории удалены; публикации и изменения remote не выполнялись.

Рекомендуемая следующая задача: исправить проверку Git metadata, запрет чтения приватных workspace-путей, классификацию assets и совместимость текущих/исторических хешей; закрепить эти случаи регрессионными тестами. Затем добавить проверяемый безопасный профиль запуска агентов и единый preflight; переход к S0 остаётся продуктовой задачей из плана.

## HARNESS-HARDENING — 2026-10-06

Результат: реализованы рекомендованные локальные изменения обвязки и закрыты четыре воспроизведённых пробела публикации. Приложение leaf не создавалось; S0 остаётся отдельной задачей. Изменённые области: privacy guard, Gitleaks wrapper, asset manifest v2, Git hooks, doctor/preflight, CI, инструкции и профили агентов, синтетические тесты и сценарии, ADR 001.

- History guard и Gitleaks проверяют commit/tag metadata, включая вложенные annotated tags; вывод ограничен правилами, object IDs и безопасными итогами.
- PDF, изображения, документы и архивы требуют approval независимо от текстовой кодировки. Текущие и исторические approvals разделены; исходные три PNG не менялись.
- Приватные workspace-пути отклоняются до чтения файлов и обхода каталогов; manifest/assets не читаются через symlink.
- Добавлен и установлен `commit-msg`; installer сохраняет конфликтующие hooks. Integration tests проверяют реальные хуки, положительные/отрицательные контроли Gitleaks, отсутствие scanner и подавление значений находок.
- `doctor` проверяет среду и конфигурацию, `preflight` объединяет проверки public workspace, index, истории и metadata без изменения index. CI использует тот же набор после установки Gitleaks.
- START_HERE следует текущей задаче. Claude settings включают sandbox с отказом при недоступности и расширенными private read rules. Codex получил credential-free permission profile, disposable OS probe и launcher, который отказывает при неуспешной проверке песочницы. Пять model smoke scenarios заданы как критерии, а не как пройденные model evals.

| Проверка | Результат |
|---|---|
| `npm run test:kit` | Прошло: 35/35, без пропусков; используется настоящий Gitleaks. |
| `npm run check:kit` | Прошло: 26 Markdown-документов, 46 ссылок, 3 референса, 10 CPM и 4 календарных примера; 5 agent scenarios проверены только как данные. |
| `npm run doctor` | Прошло: 10 проверок конфигурации и инструментов. Это не проверка активного sandbox. |
| Workspace guard и Gitleaks | Прошло на публичном рабочем дереве, включая новые незакоммиченные файлы; находок по покрываемым правилам нет. |
| `npm run preflight` | Публикация заблокирована: `EMAIL_REVIEW_REQUIRED` в metadata двух существующих коммитов. Gitleaks файловой истории и metadata прошёл. |
| `npm run agent:sandbox` | Не прошло: runtime/profile probe завершился отказом. Фактическая изоляция Codex не подтверждена; launcher не разрешает запуск модели. |
| Синтаксис служебных `.mjs`, `git diff --check` | Прошло. |

Значения Git identity не выводились и не добавлялись в policy; история не переписывалась. Для публикации владелец должен решить вопрос публичной identity и разрешить требуемое изменение истории либо узкой политики. Автоматических исключений нет. Это finding персональных данных, а не подтверждение утечки действующего секрета.

Не выполнены: запуск Claude Code, model behavior scenarios, удалённый CI и серверные push protection/rulesets, проверки приложения/build/E2E/Docker. Remote отсутствует; commit, push, публикация и deployment не выполнялись. Sandbox runtime требует отдельного устранения отказа и повторного успешного synthetic probe, без ослабления границ. Затем можно выполнить оставшуюся часть S0 по продуктовому плану.

## SANDBOX-FIX — 2026-10-07

Результат: устранён отказ `agent:sandbox`; изоляция подтверждена реальной пробой на Codex CLI **0.153.0**, Node **24.19.0**, Ubuntu **24.04**. Изменённые области: resolver установленного runtime, генератор permission args, sandbox probe, launcher, Codex profile, doctor, harness tests, AGENT_WORKFLOW/SOURCES и ADR 001.

Причины: native helper Codex находился вне разрешённых системных путей; directory-only globs не закрывали файлы внутри; текущий CLI подавлял stdout sandbox-команды. Исправления: вычисляемые read-only grants только для двух реальных бинарников Node/Codex, отдельные root/nested directory rules и proof-файл с уникальным nonce после всех проверок. Runtime paths остаются в памяти. Credential-store symlinks отвергаются до открытия; неизвестные wrappers не разрешаются. `.codex` сохраняет унаследованную защиту от записи и запрет чтения содержимого без конфликта с mount отсутствующего каталога.

| Проверка | Результат |
|---|---|
| `npm run agent:sandbox` | Прошло: public read/write; отказ private reads в root/nested/hidden directories, `.codex` и вне workspace; отказ synthetic loopback connection. |
| `npm run test:kit` через preflight | Прошло: 41/41, без пропусков. Шесть новых регрессий сначала воспроизведены отказом тестов, затем устранены. Unconfined Node child не проходит probe; exit 0/stdout marker без proof также не проходит. |
| `npm run doctor` | Прошло: 10 проверок конфигурации и инструментов. |
| `npm run check:kit` | Прошло: 26 Markdown-документов, 46 ссылок, 3 референса, 10 CPM и 4 календарных примера. |
| Workspace guard и Gitleaks | Прошло: проверено публичное рабочее дерево, включая незакоммиченные изменения; покрываемых findings нет. |
| `npm run preflight` | Публикация заблокирована прежним `EMAIL_REVIEW_REQUIRED` в metadata двух существующих коммитов. Index guard и Gitleaks истории/metadata прошли. |
| Синтаксис `.mjs`, `git diff --check` | Прошло: все 17 служебных скриптов синтаксически корректны. |

Не выполнены: launcher end-to-end с моделью, model behavior scenarios, Claude runtime, удалённый CI/защита сервера и application checks. Проба подтверждает перечисленные границы в проверенной среде, не универсальный аудит изоляции или PII. Пакеты и системные security settings не менялись. Model/API calls, Git identity changes, rewrite history, commit, push и публикация не выполнялись; временные синтетические fixtures удалены.

Следующий шаг перед внешней публикацией: решение владельца по публичной Git identity. После согласованного исправления metadata/policy повторить preflight и сохранить локальную обвязку. Реализация S0 остаётся отдельной продуктовой задачей.

## PUBLIC-IDENTITY-REVIEW — 2026-10-07

Результат: владелец явно разрешил публикацию существующего Git identity email в соответствующих author/committer fields. Это согласованное исключение устранило прежний блокер preflight. Изменённые области: `config/public-git-metadata.json`, metadata review parser/resolver, history guard, kit validation, harness tests, AGENTS/PRIVACY и ADR 001.

Разрешение привязано к двум immutable source commit IDs и полям email; адрес извлекается только в памяти и не дублируется в repository config или этом журнале. Тот же email разрешён в соответствующих полях текущих и будущих коммитов. Источники должны быть достижимыми; manifests с неизвестными scopes, wildcards или duplicate sources отклоняются. Review берётся из index; unstaged правка не расширяет разрешение. Email в именах, сообщениях, файлах и tags остаётся под review. Все secret rules и Gitleaks продолжают проверять исходные bytes.

| Проверка | Результат |
|---|---|
| Новые регрессионные tests | Четыре теста сначала воспроизвели отказ, затем прошли; проверяют scope, index authority, будущие коммиты, другое identity, сообщения/имена/файлы/tags, real Gitleaks secret control и invalid/unreachable sources. |
| `npm run preflight` | Прошло полностью: doctor, public workspace, kit, 45/45 tests без пропусков, Gitleaks workspace, index, history/metadata guard и Gitleaks history/metadata. |
| `npm run security:staged` | Прошло: guard и Gitleaks проверили один новый review manifest в index. Остальные незакоммиченные изменения покрыты workspace checks. |
| `npm run check:kit` | Прошло: 26 Markdown-документов, 47 ссылок, 3 референса, 10 CPM и 4 календарных примера. |
| Синтаксис `.mjs`, `git diff --check` | Прошло: 18 служебных скриптов. |

В index добавлен только файл согласованного review; остальные изменения сохранены в working tree. Git identity settings и история не менялись. Commit, push, deployment и внешняя публикация не выполнялись; разрешение на public email не означает поручение отправить репозиторий. Remote protections/CI, Claude runtime, model scenarios и приложение остаются вне выполненных проверок. Синтетические test repositories удалены.

Следующий шаг: сохранить проверенную обвязку локальным коммитом; перед внешней публикацией отдельно проверить серверную защиту и получить поручение на отправку. S0 приложения остаётся отдельной задачей.

## HARNESS-AUDIT — 2026-10-07

Результат: повторно проверены текущие изменения repository harness перед запрошенным локальным коммитом. Обвязка содержит реальные guard/scanner/hook tests, doctor/preflight, Codex launcher и отдельную OS probe. AGENTS.md (63 строки), CLAUDE.md (13 строк, импорт общей политики) и чтение спецификаций по задаче соответствуют проверенным официальным рекомендациям OpenAI/Anthropic. Новые источники добавлены в SOURCES. Изменены только этот журнал и список источников; найденные ограничения защитных скриптов в рамках аудита не исправлялись.

Проверено:

- `npm run preflight` — прошло: doctor, 69 public workspace entries, 26 Markdown-документов, 47 local links, 45/45 tests без пропусков, Gitleaks workspace, index guard, history/metadata guard и Gitleaks history/metadata.
- `npm run agent:sandbox` — прошло: отдельная synthetic OS probe проверила public read/write, отказ private/outside reads и сети. Это не доказательство изоляции текущей произвольной сессии или end-to-end запуска модели.
- В disposable synthetic копии staged Slack token был заменён чистым текстом только в working tree. `preflight` завершился с exit 0, отдельный Gitleaks `--staged` и установленный pre-commit — с exit 1. Значение не выводилось; временная копия удалена. Пробел вызван отсутствием Gitleaks `--staged` в preflight; index guard не покрывает все scanner patterns. Защита pre-commit для этого случая работает.
- После обновления документации прошли `check:kit`, `security:workspace`, синтаксис всех 18 `.mjs`, `git diff --check` и `git diff --cached --check`. Перед коммитом `security:staged` проверил 35 изменённых index blobs; `security:history` проверил 69 index entries, достижимые файлы и два metadata objects, включая Gitleaks. Настроенных remotes нет; их URL не читались.

Рекомендации по приоритету, без изменения подтверждённых продуктовых требований:

1. Дополнить preflight Gitleaks-проверкой индекса и независимой регрессией для расхождения staged/working bytes. До исправления перед коммитом отдельно запускать `security:staged`.
2. Перед внешней публикацией подтвердить доступные server push protection/secret scanning и обязательный CI; отдельно защищать review изменений hooks, scanners, manifests, workflows и agent settings. Локальные hooks обходимы, CI выполняется после отправки.
3. Проверить effective Claude permissions/sandbox на синтетике; запускать пять model scenarios отдельно для выбранных версий Codex/Claude и сохранять только безопасные passed/failed summaries. Конфигурационные tests и наличие сценариев не подтверждают поведение моделей.
4. Проверять совместимость launchers/profiles после обновления CLI и закреплять проверенные версии среды. Поддерживать компактную общую политику; узкие инструкции выносить по мере появления кода, без обязательного чтения всех specs для каждой задачи.
5. В S0 добавить настоящие typecheck/lint/unit/integration/build и lockfile; затем relevant E2E. Перед распространением выбрать лицензию. Эти задачи не выполнены аудитом.

Не выполнены: model/API calls, Claude runtime smoke, end-to-end Codex launcher, удалённый CI и server settings, application tests/build/E2E/Docker. Не менялись Git identity, история, remotes или security settings; push/deployment/publication не выполнялись. Личные данные не использовались. Отсутствие находок означает только прохождение покрываемых правил: имена, телефоны и изображения требуют отдельного ручного privacy-review.

## HARNESS-FIX — 2026-10-07

Результат: исправлены локальные проверки публикации по итогам аудита. Изменённые области: `scripts/preflight.mjs`, `scripts/run-gitleaks.mjs`, `scripts/harness.test.mjs`, START_HERE, BOOTSTRAP, PRIVACY, AGENT_WORKFLOW, ADR 001 и этот журнал. Продуктовые требования и реализация приложения не изменялись.

- Preflight теперь отдельно запускает Gitleaks для полных изменённых staged blobs. Синтетический scanner-only token в index блокируется даже после очистки working tree; чистая копия проходит, незакоммиченные workspace secrets остаются blocking. Проверено сохранение index и ранняя остановка после отказа workspace guard.
- Staged/history/commit-message scans используют снимок `.gitleaks.toml` из index; workspace scan — снимок working policy. Отсутствующие или nonregular index entries блокируются. Незастейдженная конфигурация не подменяет publication policy. Даже пустой staged diff проверяет scanner configuration.
- Temporary policy snapshots создаются с ограниченными правами вне tracked inputs и удаляются после успеха, находки, отказа message guard или scanner error. Ignore-file directory задаётся явно; raw stdout/stderr не выводится. Dedicated scanner finding code различает wrapper exit 1 (находка) и exit 2 (ошибка), оба блокируют операцию.
- Bootstrap теперь описывает явное добавление проверенной scanner policy в index перед самым первым preflight/commit. Новых зависимостей, установки пакетов и изменений личной конфигурации нет.

Проверено:

- Четыре новые регрессии сначала воспроизвели ошибки, затем прошли; дополнительная регрессия пустого index diff также сначала упала и прошла после исправления. Все fixtures синтетические, временные копии удалены, значения positive controls не выводились.
- `npm run preflight` — прошло полностью: doctor, public workspace guard, kit (26 Markdown files / 47 local links), 51/51 tests без пропусков, Gitleaks workspace и staged, index guard, history/metadata guard и Gitleaks history/metadata.
- `npm run agent:sandbox` — прошло: public read/write, private/outside read denial, network denial в отдельной synthetic OS probe.
- `git diff --check` — прошло. Синтаксис служебных скриптов проверен; application checks отсутствуют вместе с приложением.
- Перед коммитом `security:staged` проверил 9 изменённых index blobs; `security:history` и `git diff --cached --check` прошли. После обновления handoff повторно прошли `check:kit`, `security:workspace` и синтаксис всех 18 `.mjs`.

Не выполнены: model/API calls, effective Claude runtime smoke, end-to-end Codex model launch, remote CI/server settings, app build/tests/E2E/Docker. Эти результаты не подменяются kit tests. Git identity, история и remotes не менялись; push/deployment/publication не выполнялись. Scanner policy в index остаётся reviewable и требует owner review при изменении; snapshots не защищают от намеренного переписывания trusted hooks или правил. Ручной privacy-review изображений и прочих персональных данных сохраняется.

## Шаблон записи handoff

```text
Task ID:
Результат:
Изменённые области:
Проверено (команда → результат):
Не проверено / причина:
Риски или блокеры:
Следующий шаг:
```

Только публично безопасные сведения. Без копирования переписки, env, реальных проектов или локальных персональных путей.

## C25 — спецификация и план размещения FS, 2026-10-08

Подготовлены спецификация C25 и план из трёх этапов: документация, нормализация server cascade, условная геометрия полного DAG. C25 уточняет совместное сохранение сроков/новой связи; D18 фиксирует рабочие правила отображения без обеих дат. Реализация ещё не выполнена. Чужая запись аудита публикации сохранена и не включается в эти коммиты.

PASS: doctor на закреплённом Node/npm; check:kit (58 Markdown, 275 links, три утверждённых PNG просмотрены). Независимое review: spec compliance и quality approved; уточнены literal anchor L04 и сложность отдельного display pass. Application checks не запускались на документационном этапе. Следующий этап — server cascade C25.

## C25 — server cascade, 2026-10-08

Сервер нормализует прямое изменение валидных сроков при новом входящем ребре в той же команде. Проверка direct-source конфликта без нового ребра сохранена. Nullable duration/span, fan-in, downstream, exact retry и один undo проверены domain/repository tests. Browser проверяет совместный draft, keyboard picker, канонические поля и clean baseline. Исходные даты бездатных задач не материализуются.

Tests-first: четыре новых сценария воспроизвели прежний EXPLICIT_PRECEDENCE_CONFLICT. Исправлены literal span одной weekdays fixture и readonly typing тестового envelope; повторный полный verify PASS: typecheck, lint, 761/761 tests, production build. Affected format PASS; actual-server FS Details E2E PASS 8/8 в двух viewports без retries/skips. Следующий этап — условная геометрия DAG. Docker/sandbox/pубликация не запускались.

Независимое scoped review server этапа: spec compliance approved, code quality approved, замечаний нет. Проверены detection новых endpoints/IDs, pre-cascade source/done/provenance validation, causal activation и same-bound barriers.
