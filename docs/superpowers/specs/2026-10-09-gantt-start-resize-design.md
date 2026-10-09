# Изменение начала полосы Ганта — C27

Дата: 2026-10-09. Статус: реализация выполнена; независимые task reviews и финальное whole-change review приняты. Итоговые проверки записаны в [STATUS](../../STATUS.md). Основание: владелец поручил изменение левого края с сохранением окончания, спецификацию, план, реализацию отдельными агентами и циклы review.

## 1. Цель и границы

У реальной конечной незавершённой работы Гант предлагает три разных действия: тело переносит обе даты с сохранением рабочей длины; правая ручка сохраняет начало и меняет окончание; новая левая ручка сохраняет включительное окончание, меняет начало и явно пересчитывает длительность. Новое действие не использует правила изменения начала панели C18: там начало по-прежнему сохраняет длительность и пересчитывает окончание.

Не меняются семантика операции правой ручки и её существующий выбор согласования/очистки длительности, conditional placement C19/D18, зависимости C24/C25, модель nullable полей, schema SQLite, миграции, dependencies и security policy. Не добавляется отдельный deadline, новая библиотека или массовая переделка оформления ручек. Визуальное уточнение C27 намеренно выравнивает внешний вид левой ручки с существующей светлой правой ручкой. Три PNG design/README.md сохраняются; приложенный владельцем screenshot не добавляется в репозиторий.

## 2. Варианты и интерфейс команды

Исследование активного V2: Gantt onPlan принимает move/resize, gesturePatch готовит task.edit; task.move переносит узел иерархии, команды task.resize нет. Historical V1 не расширяем.

Вариант A: новый client patch task.edit {inputStart,durationDays}. Он самый короткий, но authoritative вычисление длительности остаётся клиенту и намерение фиксации окончания теряется. Вариант B (выбранный технический working default): additive V2-команда task.resizeStart с двумя полями taskId и inputStart; сервер сам вычисляет длительность относительно сохранённого окончания. Вариант C: универсальная task.resize с edge и target либо новый intent в task.edit; требует большего контракта и ненужного изменения существующей правой ручки. B минимален для серверного расчёта, не изменяет семантику старых команд и не требует версии 3/миграции; старые серверы предсказуемо отвергнут новую команду. V1/frozen historical replay и ранее сохранённые outcome не пересчитываются.

```ts
{ type: 'task.resizeStart', taskId: UUID, inputStart: ISODate }
```

Strict schema отклоняет неизвестные поля, null, отсутствие начала, invalid UUID/date. Existing V2 envelope сохраняет contractVersion: 2, expectedRevision и operationId. Команда не принимает окончание, duration, predecessors или status: нельзя скрыто совместить новую связь с resize и попасть под нормализацию C25.

## 3. Серверные правила

Внутри existing transaction найти task, потребовать leaf, status != done и достоверный полный realInterval в текущем календаре. Не materialize conditional/nullable/legacy unavailable interval. Сохранить inputFinish побайтово. Проверить inputStart как действительную рабочую civil date; начало <= окончание, диапазон 0001-01-01…9999-12-31. Длительность = workingDaysInclusive(inputStart, сохранённое inputFinish, calendarType); включительность означает одинаковые начало/окончание и durationDays = 1. Допустимый диапазон durationDays: 1…1 000 000; overflow отклоняет команду. Если прежняя длительность null, новое явное действие записывает вычисленное число: это не фоновое заполнение.

Перенос левого края раньше увеличивает рабочую длину, позже уменьшает; окончание никогда не сдвигается. Пример weekdays: 2026-10-05…2026-10-09, duration 5; новое начало 2026-10-02 даёт 6, начало 2026-10-09 даёт 1. Для all-days начало 2026-10-04 при том же окончании даёт 6. Выходной 2026-10-03 в weekdays отклоняется без snapping. Даты civil, timezone не переводит их в timestamp.

Применить existing private source validator/guards и existing causal FS pass. Указать task.resizeStart как explicitlyEditedTaskId при изменении source: incoming FS требует новое начало строго после включительного real окончания каждого доступного predecessor. Нарушение даёт существующий direct-source FS conflict и полный rollback; нельзя push целевую работу и незаметно поменять фиксированное окончание. Unknown predecessor остаётся unknown по D17/C16; conditional finish не подменяет реальное ограничение. Existing historical конфликт не чинится чтением/кешированным retry. Неизменный finish целевой работы не запускает outgoing push/tight pull; downstream source сроки сохраняются. Сводные интервалы и CPM всё равно пересчитываются по новым реальным source полям.

Одна transaction сохраняет source, schedule, revision, outcome и undo snapshot. Ошибка source/FS/done/summary/unavailable/range, stale revision и DB failure оставляют исходный snapshot/undo/outcome неизменными. Retry с exact envelope/operationId возвращает сохранённый outcome один раз; клиент не конструирует новый запрос при неизвестном результате. Undo восстанавливает точные start/finish/duration (включая прежний null), summaries/CPM одним existing undo. После restart сохранённые source поля совпадают с ack. Равное прежнему inputStart не меняет source и не материализует null duration; клиент не отправляет no-op. Если API получает такую команду, он следует existing receipt/revision protocol для принятой команды, но source поля остаются точными; специальный глобальный bypass транзакций не добавляется.

## 4. Клиент и взаимодействия

Расширить тип onPlan/gesture до move | resize | resize-start; прежние значения/правая ручка сохраняются. resize-start отправляет task.resizeStart, а не gesturePatch/C18 и не диалог duration mismatch. Preview меняет только x1, x2 остаётся прежним. Превью временно; записи только при успешном release ненулевого смещения. Недопустимое начало после окончания/выходной/overflow отклоняется с существующим localized invalidGesture сообщением без отправки команды и без перевёрнутой полосы. На сервере эти проверки обязательны независимо от клиента.

Левая ручка — отдельная focusable role=button с centralized русским именем «Изменить начало: <название>», data-gantt-resize-start=task.id. Показывать её только при existing editable(task) и видимом реальном левом конце 0 <= x1 < view.width; clipped край не притворяется началом. Правая ручка сохраняет data-gantt-resize. Обе видимые ручки доступных для редактирования реальных краёв имеют одинаковую полупрозрачную белую заливку `#ffffff99`; светлая накладка обозначает изменение размера. Отдельные зоны `edgeWidth` обеих ручек различимы, не перекрываются даже на однодневной полосе во всех шкалах; компактная геометрия не мешает выбору задачи/цепочке/подзадаче. Общий body drag продолжает работать.

Pointer только primary button и свой pointerId, capture на ручке; stopPropagation предотвращает body move, selection и открытие панели. Escape, pointercancel, lostpointercapture, unmount, смена проекта/revision/календаря/шкалы/видимого периода/rows, loading/read-only отменяют preview и будущий release, без команды. Release собственного capture после окончания не отменяет уже завершённый gesture. Click после drag поглощается; без drag не выполняет запись. Preview не остаётся после отказа.

Tab достигает ручки; ArrowLeft/ArrowRight меняют начало на один рабочий день через indexToDate относительно собственного начала и сохраняют окончание. У новой ручки Shift не переключает действие на правый край; event не всплывает к body. Escape прекращает pending pointer gesture; После успешного ack/отказа доступен повтор с фокусом на настоящей ручке; если начало вышло за период, оно раскрывается после подтверждения. Явное переключение вида, периода, проекта, фильтра или самостоятельный перевод фокуса в другой контрол отменяют восстановление; поздний ack не отменяет выбор пользователя. Неявная потеря фокуса в body при busy, exact retry и same-project reload 409 сохраняют восстановление. На body Arrow сохраняет перенос и Shift+Arrow сохраняет прежний правый resize. Chain Alt+L не регрессирует.

Done, summary, conditional, draft preview, invalid/unavailable реальные интервалы и disabled/loading не имеют ручки и не отправляют resize. Existing dirty-navigation guards/command pending guards обязательны. Во время отсутствия ack source/стрелки/CPM не показываются как сохранённые; ошибки, stale revision и retry используют existing command flow.

## 5. Приёмка: независимые literal fixtures

- GSR01: weekdays 05…09 октября/5 → начало 02 октября/6; finish 09 неизменен. Null duration перед действием → 6; undo возвращает null. All-days 04…09 → 6.
- GSR02: начало равно finish → 1; позже finish, weekend weekdays, invalid civil date, диапазон и duration > 1 000 000 отвергаются атомарно.
- GSR03: predecessor P заканчивается 06 октября, B=07…09/3; resize B на 06 отклоняется, на 08 даёт 2. Finish-only known predecessor также ограничивает; неизвестный finish не выводится из conditional.
- GSR04: цепь B=07…09 → C=12…13 weekdays; resize B на 08 не меняет C, endpoints и edge IDs. Parent с одним B меняет начало 07→08, finish 09; calendarSpanDays 3→2. При независимой A=05…06/2 и B=07…09/3 без связей H=09 неизменен; после B=09…09/1 B остаётся critical. Literal projectFloat A/B: 3/0 → 3/0, constraintFloat: 3/0 → 3/0. Не требовать выдуманного переключения критичного terminal при неизменном окончании.
- GSR05: strict V2 command validation, V1 rejection, done/summary/null/invalid/unavailable guards, exact retry/restart и одна undo. Snapshot/SQL rows до rejected command равны после.
- GSR06: pointer и keyboard новой ручки, body move/правая ручка/C18 regressions, одна revision, persisted source после reload, focus, Escape/pointercancel/lostcapture/no-op/чужой pointer, clipped/однодневная геометрия days/weeks/months.
- GSR07: actual-server E2E в 1440×900 и 1280×800: drag left с фиксированным правым краем, keyboard, weekend rejection, FS error rollback, no-ack exact retry и stale 409 после настоящей конкурирующей записи, dirty guard, undo/reload. Empty/loading/error/conditional/done/summary отображение проверяется синтетически.

## Global Constraints

- Один TypeScript package, React/Vite + Fastify + SQLite; никаких новых dependencies, schema migrations или lockfile изменений.
- Английские identifiers, централизованные русские UI строки; C18 panel semantics сохраняются.
- Только synthetic fixtures, без реальных баз, credentials, exports и owner screenshots; без push/deploy/publication.
- Все authoritative записи, вычисление длительности, FS validation и CPM выполняются сервером атомарно; display значения не записываются.
- Отдельные worktrees для concurrent agents; один writer shared contracts/scheduling semantics; независимый spec review и quality review каждого task с исправлением замечаний перед следующим task.
