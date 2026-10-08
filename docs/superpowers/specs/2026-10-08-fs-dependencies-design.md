# FS-зависимости: простой ввод связи и атомарный перенос

Дата: 2026-10-08. Статус: нормативная спецификация текущего поручения; spec/plan и Tasks 1–3 прошли независимый review; реализация и actual-server gates завершены, whole-branch review одобрил функциональный контракт. Актуальный результат финального review и корневых gates — в [STATUS](../../STATUS.md). [ADR 011](../../adr/011-fs-command-cascade.md) фиксирует архитектурную границу. Документ расширяет команды записи; принятые формулы [C16/ADR 008](../../adr/008-explicit-date-cpm.md), nullable source fields и frozen history сохраняются.

## 1. Требование и выбранные рабочие правила

Владелец требует отдельную от родства связь: работа начинается после окончания другой работы; перенос предшественника переносит зависимую работу и пересчитывает критичность родительской ветки. Связь задаётся при создании, в карточке, из списка и из Ганта. Решение должно оставаться простым. Поручены независимые варианты, выбор, спецификация, план, реализация и циклы review.

Это подтверждённое требование. Следующие подробности — выбранные **рабочие defaults**, а не отдельные подтверждения владельца:

- Только существующая FS, лаг 0, конечные работы одного проекта. Родство, порядок строк и перенос между ветками не создают FS. Новый запрет менять статус до завершения предшественника не вводится.
- Поздняя граница переносит зависимую работу только при необходимости. Цепочка без промежутка следует за переносом в обе стороны; положительный промежуток сначала поглощает задержку. Отдельного переключателя политики нет.
- Пустые даты остаются пустыми. Duration-only, условная полоса, дата группы и сегодня не разрешают назначить реальные даты. При известном единственном начале переносится только оно.
- Удаление связи не подтягивает даты раньше. Done не переносится автоматически. Прямой конфликт явно редактируемых сроков отклоняется атомарно.

Выбран минимальный синтез: единый searchable picker, additive command fields и чистый каскад перед существующим CPM. Новые типы зависимостей, lag, режимы планирования, persisted anchors, таблицы, библиотеки и жест соединения полос не нужны. Обязательны прежние три [PNG-референса](../../../design/README.md): компактная панель и существующая вертикальная схема соседей сохраняются.

## 2. Данные и контракт команд

Используется текущий `DependencyV2` с `id`, `projectId`, `predecessorId`, `successorId`. Новые поля существуют только в командах:

```ts
// Дополнение существующей команды; остальные поля прежние.
task.create { ..., predecessorIds?: UUID[] }
task.edit { taskId, changes: { ..., predecessorIds?: UUID[] } }
```

При create список создаёт входящие рёбра новой задачи вместе с самой задачей. При edit отсутствие поля сохраняет входящие связи; `[]` удаляет их; непустой массив полностью заменяет входящие endpoints. Исходящие связи не меняются. Relation-only edit валиден. Рёбра с неизменившимися endpoints сохраняют IDs; новые получают IDs по существующей модели. Дубликаты IDs отклоняются; не удаляются молча.

`predecessorIds` отделяется от scalar patch до изменения `Task`: его нет в публичном Task DTO, SQLite task row или `Object.assign(task, scalarChanges)`. Старые клиенты без поля работают с прежним shape. Existing `dependency.create/delete` остаются и пользуются тем же validator/каскадом.

Сервер проверяет наличие endpoints в проекте, leaf-only, self, duplicate и DAG. UI исключает недопустимые кандидаты для удобства, но не заменяет проверку. При `preserveWork` сначала выполняется существующее leaf→summary преобразование с переносом собственной работы, связей и private marker; затем проверяются окончательные endpoints. Выбранный parent, ставший summary, не перенаправляется на work child: вся команда отклоняется, выбор нужно исправить.

## 3. Чистый каскад только при записи

Один pure helper получает before/candidate scheduling snapshots, календарь, private unavailable IDs и небольшое описание команды: реально изменённые source task IDs, добавленные рёбра и прямо редактируемую задачу. Он возвращает итоговые source поля/набор изменённых задач либо `DomainError`; не читает часы, SQLite, UI или network и не мутирует исходный before.

Helper запускается внутри существующей immediate mutation transaction после scalar/source/preserveWork/edge validation, перед штатным `calculateSchedule`. Реально изменённая source задача проверяет собственные окончательные incoming constraints. Её исходящие связи активируются только при изменении достоверной authoritative finish boundary (включая переход known/unknown); изменение одного start при прежнем finish не активирует successor. Добавленное FS-ребро активирует своего successor. Достижимость в окончательном DAG задаёт лишь область возможного обхода: каскад обрабатывает причинно активные задачи топологически, каждый fan-in один раз по окончательным входящим границам. Следующий downstream шаг активируется только если каскад действительно изменил authoritative finish промежуточной работы. Разность календарных дат не суммируется вдоль двух ветвей diamond.

GET, чистый анализ, undo, cached exact outcome, frozen replay, title/status-only, перестановка строк и удаление связей не вызывают ремонт сроков. Повтор равных source значений не запускает исторический repair; действующий explicit private acknowledgement по наличию source key сохраняет свою отдельную семантику. Изменение project calendar использует существующую проверку/анализ и не запускает этот каскад. Незатронутые исторические infeasible компоненты не исправляются побочно.

### 3.1. FS-границы

Пользовательское окончание включительно; в рабочей координате `[s,f)` FS требует `s(successor) >= f(predecessor)`. `f` — рабочий индекс заданного окончания плюс один. Применяются существующие civil-date/calendar helpers, без milliseconds или timezone браузера.

Известная FS-граница получается из валидного рабочего `inputFinish` предшественника, включая finish-only работу. При полной паре она должна быть валидной по текущему source контракту. Неизвестные/нерабочие границы и `legacyIntervalUnavailable` не являются достоверными bounds. Summary, условная полоса и её display duration не источники границ.

`newBound` — максимум всех известных входящих `f` после команды; `oldBound` — такой же максимум до неё. Unknown predecessor не отменяет известный правый lower bound другого predecessor, но запрещает раннее подтягивание. Без известного `newBound` новый start не выводится.

### 3.2. Одно правило переноса

Для причинно активного successor с известным рабочим start: если для него не добавлено ребро и `newBound == oldBound`, перенос отсутствует, включая before с прежним FS-конфликтом и done successor. Слабая изменённая ветвь не чинит исторический конфликт при прежнем max. Для добавленного ребра либо реально изменённого max:

1. Если `newBound > currentStart`, необходим поздний перенос к `newBound`.
2. Иначе ранний перенос к `newBound` возможен только при `oldStart == oldBound`, неизменном множестве входящих endpoints и известных валидных old/new finishes **всех** этих predecessors. Задача не должна быть явно редактируемым source этого command.
3. В остальных случаях start сохраняется. Удаление/replacement входящих endpoints само по себе не даёт early pull. Если start/finish не изменились, дальнейшая ветвь не активируется, даже если в ней уже есть исторический конфликт. Новый/ухудшенный проверяемый конфликт от изменённого bound или добавленного ребра обрабатывается правилами переноса/отказа; сохранённый конфликт при прежнем bound не становится побочным repair.

Валидная полная pair переносится целиком с прежним количеством рабочих дней между концами. `durationDays` сохраняется точно, в том числе null. Start-only получает новый `inputStart`, сохраняя null finish и исходную nullable duration. Finish-only, duration-only и полностью пустая работа сохраняют все исходные поля; начало не материализуется.

У start-only работы нет известного нового finish: движение её start не передаётся дальше как придуманная delta. Finish-only работа, наоборот, может ограничивать downstream своим реально известным finish; движение upstream само по себе её finish не меняет. Работа с invalid full pair/нерабочей известной границей не исправляется скрыто: если необходимо устранить доказанный затронутый FS-конфликт, команда отклоняется.

**Промежуток не является сохранённым anchor.** A.f=2, B.s=5: изменение A.f на 6 переносит B.s на 6; следующее изменение A.f на 2 переносит B.s на 2, потому что B стала tight. Исходное B.s=5 возвращает undo, а не скрытая память первоначальной даты. Это явная цена простого default без новой модели.

### 3.3. Явное изменение и защищённые интервалы

При task.edit, реально меняющем source fields, результирующий start редактируемой задачи проверяется по окончательным входящим связям, включая replacement из той же команды. Известный FS-конфликт отклоняет всю команду; явно выбранная дата не заменяется молча. Неизменный finish после изменения start не двигает downstream.

При create с полной pair и predecessors, а также при relation-only edit или dependency.create, существующая/новая пара вправе получить необходимый поздний перенос. Канонические даты возвращаются сервером. Добавление связи к неполному интервалу не выводит недостающую дату. Это отличается от source edit существующей карточки, где явная conflicting date должна дать ошибку.

Done никогда не переносится каскадом. Необходимый поздний push через его известное начало возвращает `DONE_PLAN_LOCKED` и откатывает инициирующую команду. Необязательный early pull оставляет done на месте. Explicit reopen/source edit остаётся в текущем контракте.

Private `legacyIntervalUnavailable` не снимается косвенным переносом, а его raw pair не используется для переноса. Existing diagnostic по сохранённым raw endpoints остаётся: новый или ухудшенный проверяемый FS-конфликт в затронутой области, который невозможно устранить без изменения unavailable работы, отклоняет команду. Равный старый конфликт в другой области не превращается в новый запрет.

Calendar overflow на границах 0001–9999, недопустимые endpoints, cycle и необходимый перенос invalid source отклоняют всю команду. Сообщение показывает названия затронутых работ/цепочку и понятную причину; server logs не получают пользовательские titles.

## 4. Транзакция, анализ и отмена

Одна команда включает task/source/relation patch, весь каскад, существующий summary/CPM, запись snapshot и operation outcome. Одна revision, один operationId, один beforeSnapshot/undo. Cascade `updatedAt` меняется только у работ с реально изменёнными source fields. Ошибка не оставляет ни новой задачи, ни ребра, ни перенесённых дат, ни revision, undo или operation row; существующий rollback охватывает все шаги.

ExpectedRevision и uncertain/exact retry сохраняются. Повтор exact envelope возвращает сохранённый ответ прежде revision check и не переносит даты повторно. Undo восстанавливает точные source/null поля, edge IDs и private provenance одним действием; затем выполняется read-only анализ восстановленного snapshot. Frozen historical responses остаются точными, без live каскада и без нового CPM.

После успешного каскада текущий C16 пересчитывает общий горизонт, floats, critical leaf/edge IDs и `containsCritical` предков. Родитель агрегирует реальные интервалы/критичность потомков: не получает отдельный CPM vertex, свой новый горизонт или зависимость из родства. Incomplete/partial и infeasible suppression остаются по ADR 008. Условные C19 полосы никогда не входят в CPM или summary.

## 5. Один picker в четырёх местах

Общий компонент показывает «После окончания», поиск по названию, список допустимых leaf задач и выбранные removable chips. Results включают короткий путь родителей для одинаковых названий. Поиск идёт по всему проекту, независимо от collapse, поискового фильтра и статуса на основном экране. Неполные задачи доступны: при необходимости краткая подпись «Связь сохранится; перенос использует только заданные даты». Не вводится постоянная новая колонка, предупреждение или summary-панель.

Picker не вызывает API: передаёт выбранные IDs/callbacks контексту. Создание/Details изменяют draft, список/Гант выполняют одну существующую dependency.create/delete на выбранное действие. В immediate контексте добавление/удаление не выглядит сохранённым до ack; серия кликов не создаёт скрытый batch framework. Все стрелки и сохранённые chips берутся из подтверждённого snapshot.

Уточнение отображения от 2026-10-08: подтверждённая связь видна на Ганте и при неполных датах. Рабочее оформление — пунктирная стрелка от отображаемого окончания к отображаемому началу с подписью об условном размещении, если одна из полос условная. Это заменяет прежнее скрытие C19; геометрия не заполняет source поля и не участвует в FS/summary/CPM. Скрытые строки и концы вне периода не соединяются; summary и несохранённый preview не endpoints. Перекрывающиеся полосы обходятся у начала successor, чтобы наконечник не закрывался полосой.

| Вход | Действие и сохранение |
| --- | --- |
| Новый task, основной QuickAdd и QuickAdd подзадачи | Небольшая цепочка «После…» рядом со сроками; выбор chips в текущем отдельном draft; Enter/create сохраняет task и все predecessors одной командой. |
| Карточка, «Детали» | Поле под сроками; изменения relations входят в общий dirty draft. «Сохранить» отправляет одну task.edit с source и replacement; graph-вкладка остаётся обзором непосредственных соседей и existing действиями. |
| Строка списка | Небольшая semantic chain button в действиях leaf строки, доступна при hover/focus и на touch. Picker открывается непосредственно из строки, без обязательного открытия карточки. |
| Выбранная/фокусная полоса Ганта | Отдельная chain action с тем же picker, в том числе для conditional leaf. Она не запускает move/resize и не открывает карточку побочно. Summary и draft preview не endpoints. |

Gantt action — отдельный sibling control, не кнопка внутри кнопки полосы. Pointerdown/click/key останавливают соответствующее всплытие к drag/selection handler. Drag-to-connect, «выбрать на диаграмме» mode и новый direction selector не добавляются. Graph-вкладка сохраняет реальные предшественники сверху и последователи снизу; критичность приходит с сервера.

### 5.1. Клавиатура и состояния

- Alt+L открывает picker из QuickAdd title, focused tree row и focused/selected Gantt leaf. В QuickAdd прежние Tab/Shift+Tab для уровня дерева сохраняются; в picker Tab обычный. Summary показывает краткое пояснение «Выберите конечную работу».
- Фокус попадает в поиск; ArrowUp/Down выбирают result, Enter добавляет выбор, Esc закрывает только picker с stopPropagation. Panel/App Escape не должны закрыться вместе с внутренним popover.
- После закрытия picker или immediate relation action фокус возвращается trigger; если он исчез, к строке, затем соответствующему quick input. Enclosing create/Save сохраняет обычный контекст формы: successful QuickAdd create возвращает фокус в title следующей задачи. Видимый focus и доступные имена обязательны.
- Различаются загрузка, пустой проект/нет других leaf, отсутствие результата поиска и server error. Busy, conflict и uncertain outcome блокируют повторную mutation. Ошибка сохраняет draft, текст не утверждает успех до ack.
- Dirty Details нельзя обходить immediate relation command из списка/Ганта/graph: действует существующая защита несохранённой карточки.

### 5.2. Целостный draft и канонические даты

`predecessorIds` входит в QuickDraft и Details draft, dirty/hasQuickDrafts, cancel/discard, beforeunload/logout guard, branch/project restore и pending operation envelope. Основной ввод и ввод подзадачи держат отдельные drafts. Ошибка, stale revision и uncertain response не очищают IDs.

Successful exact retry очищает только соответствующий quickKey и только полный совпадающий отправленный draft: title, source plan, predecessors и контекст. Сравнение одного title недостаточно; новый выбор связи нельзя стереть поздним ответом прежнего create. Множество predecessor IDs сравнивается канонически.

После успешного save карточка синхронизирует baselinePlan и incoming IDs с подтверждёнными server dates/edges, учитывая возможный necessary push. Dirty draft не заменяется посторонним reload. Новый draft, изменённый пока выполнялась операция, не получает ложное «Сохранено».

## 6. Независимые численные критерии

Здесь `[s,f)` — абсолютные рабочие индексы; для all-days index 0 соответствует 2026-10-05. Supplied duration равна span, если не указан null. Ожидания задаются буквальными числами, без вызова реализации для получения expected values.

| ID | Вход/команда | Обязательный результат |
| --- | --- | --- |
| F01 | A[0,2)→B[2,5)→C[5,7); edit A→[2,4) | B[4,7), C[7,9); H=9; floats всех 0; оба FS critical. |
| F02 | A[2,4)→B[4,7)→C[7,9); edit A→[0,2) | B[2,5), C[5,7); H=7, tight early cascade. |
| F03 | A[0,2)→B[5,7); edit A→[1,3), затем →[4,6), затем →[0,2) | После команд B соответственно [5,7), [6,8), [2,4); gap сначала поглощён, первоначальный start 5 не запоминается. |
| F04 | A[0,2), X[0,4), оба→B[4,6) | A→[1,3): B unchanged. Затем A→[3,5): B[5,7). X→[1,5): B unchanged; max, а не сумма delta. |
| F05 | A[0,2)→B[2,4), A→C[2,5), B/C→D[5,7); A→[2,4) | B[4,6), C[4,7), D[7,9); D переносится один раз на 2 дня. |
| F06 | Weekdays A 2026-10-08..08→B 2026-10-09..12 (duration=null); A→2026-10-09..09 | B 2026-10-12..13, duration=null. Отдельный all-days case: A 2026-10-08..08→B 2026-10-09..10; A→2026-10-09..09 даёт B 2026-10-10..11. |
| F07 | A start=null, finish=2026-10-09; B start=2026-10-08, finish=null, duration=null; добавить A→B в weekdays | B.start=2026-10-12, finish/duration null; analysis incomplete, ordinary critical IDs пусты. |
| F08 | A[0,3); B duration=1, обе даты null; create B с A predecessor | Реальные даты B null, edge существует; C19 отображение условное; CPM incomplete. |
| F09 | A[0,2), U finish неизвестен, A/U→B[2,4); A→[2,4), затем →[0,2) | B→[4,6), затем остаётся [4,6): unknown блокирует early pull. |
| F10 | A[0,3)→B[3,5); явно edit B→[2,4) | Atomic rejection с названиями A/B; исходные pair/edge/revision/undo/operations неизменны. Relation-only add A→B[2,4) вместо direct edit переносит B→[3,5). |
| F11 | A[0,2)→done B[2,4); A→[1,3) | `DONE_PLAN_LOCKED`, весь command rollback. При A[1,3)→done B[3,5), A→[0,2) done B остаётся [3,5). |
| F12 | A[0,2)→B[2,4); удалить ребро | B[2,4), source dates неизменны. |
| F13 | A finishes 9999-12-31 в all-days; добавить A→B с известным start | Atomic calendar-range rejection, без частичного ребра/переноса. |
| F14 | Historical infeasible A[0,3)→B[2,4), duration обоих null; edit A→[1,3) | B[2,4) untouched; command succeeds, прежний infeasible остаётся. Повторить с done B: без `DONE_PLAN_LOCKED`, B untouched. |
| F15 | A[0,2), X[0,5), оба→B[4,6), B→C[5,7); edit A→[1,3) | Max B прежний 5: B[4,6) и C[5,7) unchanged; оба historical conflicts остаются. Repeat с done B либо done C также succeeds. |
| F16 | A[0,2)→B[5,7)→C[6,8); edit A→[1,3) | Gap B поглощает задержку: B[5,7) unchanged, его finish не активирует C; C[6,8) untouched, прежний infeasible остаётся. |

Дополнительно literal cases: start-only→downstream unknown barrier; finish-only successor не получает start; source duration=null сохраняется у полной пары; нерабочая lone date не нормализуется; invalid duration/full pair не исправляется; unavailable raw valid pair не становится bound и marker не снимается. Newly affected raw conflict unavailable отклоняется, прежний unrelated conflict не чинится. Cycle, self, duplicates, foreign/summary endpoints и preserveWork parent selection отклоняются атомарно.

### 6.1. Родитель, переключение критичной ветки и undo

Полный ready проект содержит два родителя P/Q. В P: A[0,2)→B[2,5), в Q: C[0,3)→D[3,5). До edit H=5, все leaves и оба edges critical; summary P/Q=[0,5), оба containsCritical=true, общий предок=[0,5).

Edit A→[2,4) переносит только B→[4,7). После команды H=7; A/B projectFloat=0, C/D projectFloat=2; constraintFloat A/B/C/D соответственно 0/0/0/2. Critical leaves только A/B, edge только A→B. P=[2,7), containsCritical=true; Q=[0,5), containsCritical=false; общий предок=[0,7), containsCritical=true.

Одна undo возвращает буквальный before: A[0,2), B[2,5), P/Q=[0,5), H=5, четыре critical leaves/два edges, исходные IDs и nullable поля. Restart не меняет результат. Это пересчёт существующего проектного CPM и parent indicators, без второго алгоритма критического пути для родителя.

## 7. Review и проверка реализации

До плана независимые reviewers проверяют spec: одну выбранную политику, nullable/done/provenance, literal vectors, four inputs и atomic draft/retry. Замечания исправляются автором; повторный review подтверждает отсутствие unresolved blockers. План проходит собственный review cycle; implementation — отдельный final review и исправления с повторной проверкой затронутых suites.

Tests first где практично: pure cascade literal fixtures; Repository/HTTP одна revision/undo, exact retry, stale revision, rollback всех таблиц и private passage; client/actual browser все четыре входа, оба QuickAdd, keyboard/Esc/focus, кандидаты вне фильтра с одинаковыми именами, rejection/uncertain draft recovery, no unintended Gantt drag, canonical dates после save, parent critical branch switch и undo.

Existing live tests, ожидавшие сохранение `EXPLICIT_PRECEDENCE_CONFLICT` после обычного позднего predecessor edit или relation add, обновляются на фактический перенос согласно этому контракту. Pure analysis infeasible fixtures, C16 numerical vectors и frozen historical answers сохраняют прежние expectations: анализ по-прежнему умеет диагностировать невозможный snapshot.

Обязательные gates: typecheck, lint, meaningful unit/integration, relevant actual-server E2E в configured viewports, build, format, check:package, check:kit и public workspace/security checks по workflow. Новые test suites входят в соответствующие package scripts, без empty/skipped suites/`--if-present`. Данные только синтетические. STATUS фиксирует факты проверки, limitations и следующий task; не объявляет весь S4–S6/первый релиз завершённым.
