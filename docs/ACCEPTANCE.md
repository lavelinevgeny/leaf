# Приёмка leaf V1

Каждому критерию нужен тест или воспроизводимая ручная проверка с синтетическими данными. Служебный `check:kit` не заменяет ни один application test.

Адаптация C11–C17 имеет отдельные [критерии OS01–OS17](superpowers/specs/2026-10-07-optional-scheduling-design.md) и [принятое нормативное приложение P01–P11/M01–M10](superpowers/specs/2026-10-07-optional-scheduling-policy-proposal.md). O06/G-CPM и G-MIGRATION закрыты решениями C16/C17; Tasks 5–7 и их синтетическая application acceptance выполнены, актуальные результаты — в [STATUS](STATUS.md). Исторические Auto-числа A08–A09 и соответствующие fixtures остаются примерами S2–S3, а не алгоритмом по явным датам. Полная V1 по C05 требует реализации принятого численного набора и S4–S6; документальное решение не заменяет тестов.

| ID | Действие | Ожидаемый результат |
|---|---|---|
| A01 | Создать проект и дерево из 5+ уровней без дат | Иерархия видна; исходные сроки не назначены. C19: конечные задачи без anchor видны сегодня приглушёнными полосами, summary без реальных интервалов отсутствуют. UI default duration=1 можно очистить; API defaults остаются null. |
| A02 | Создать 40 уровней вложенности программно | Нет искусственного лимита/переполнения рекурсии в поддерживаемом размере; UI сохраняет доступ к названиям. |
| A03 | Перенести ветку в себя/потомка | Операция отклонена, данные не изменены. |
| A04 | Переставить/свернуть/отфильтровать работы | Расписание и критические ID не меняются. Родительский контекст виден. |
| A05 | Задать только одну дату | Реальная дата остаётся отметкой/подписью, без записи второго края или нулевой длительности; C19: условная полоса привязана к собственной дате с duration или одним display-днём (OS07). |
| A06 | Задать/очистить начало, окончание и длительность по отдельности | C18: связанные значения пересчитываются после blur/Enter/выбора календаря, до Save writes нет; очистка оставляет только это поле null, duration-only без дат. Один Save/undo охватывает всю тройку. Invalid input сохраняет черновик; API по-прежнему отклоняет противоречивую тройку (OS01–OS03). |
| A07 | Задать predecessor на пятницу и FS successor с явным началом в понедельник; затем задать successor на ту же пятницу | Для пн–пт понедельник допустим; прямой source edit на пятницу отклоняется атомарно по C24. Relation-only add допускает необходимый push; чистый C16 анализ не меняет дат. |
| A08 | Две параллельные ветви 7 и 3 дня + финал 1 | Исторический Auto пример: T=8. Целевая численная приёмка — C16/P01–P11/N06 и OS16. |
| A09 | Удлинить короткую ветвь до 9 | Исторический Auto пример: T=10. Целевое переключение по явным датам — P04→P05, одна отмена восстанавливает P04. |
| A10 | Обе явно датированные ветви равны | P04: critical обе ветви и только tight FS, все projectFloat=0; без экспоненциального перечисления путей. |
| A11 | Добавить независимую короткую работу | P03/N06: общий H для компонент, короткая independent work имеет положительный projectFloat; отсутствие successors не делает её critical. |
| A12 | Связать задачу с недостающей необходимой границей; отдельно задать валидную пару дат с durationDays=null | Unknown не считается 0; FS по predecessor.finish/successor.start даже без full pair, CPM допускает только valid pair. Nullable duration не делает пару неизвестной. P07/P08: partial отдельно, unknown-компонента не обходится. |
| A13 | Связь создаёт цикл | Отклонена до commit с понятной цепочкой; UI и БД согласованы. |
| A14 | N06: A[0,2)→B[5,6), независимая C[0,10) | H=10; projectFloat A/B/C=7/4/0, constraintFloat=3/4/0; critical только C. Done B даёт constraintFloat B=0 без изменения её projectFloat/duration. |
| A15 | Предшественник заканчивается позже явно заданного начала successor | Historical snapshot: infeasible и локальный конфликт видны без ремонта анализом. Live C24 command: необходимый causal push либо полный rollback защищённого/source-конфликта. |
| A16 | Открыть детали задачи и задать/очистить дату окончания | Дата окончания необязательна; отдельного поля дедлайна и предупреждения о его превышении нет по C15. |
| A17 | Изменить длительность глубокой подзадачи | Обновлены display и анализ; C18: явный ввод duration с одной датой заполняет вторую в черновике и атомарном patch; без опоры даты остаются null. Фоновый анализ сохранённой неполной пары не материализует source по W01; CPM использует только сохранённые валидные пары. |
| A18 | У summary параллельные дети | Полный охват дат, не сумма длительностей; если любой реальный интервал неизвестен, обе summary даты отсутствуют (OS05/OS06). |
| A19 | Добавить первого ребёнка к запланированной связанной задаче | Без потери работы и связей; подтверждённая миграция в work-child транзакцией. |
| A20 | Сделать done, затем изменить предшественника | Длительность не обнулена; завершённые даты не переписаны молча. |
| A21 | Один drag с множеством последствий, затем undo | Весь план возвращается одним действием. |
| A22 | Вторая вкладка изменила проект перед undo | 409 / явное разрешение конфликта; новые изменения не потеряны. |
| A23 | Повторить mutation с прежним operationId | Нет дубля задачи/связи или второго применения. |
| A24 | Открыть зависимости | Предшественники отдельно ведут к текущей; последователи — отдельно из неё. Только реальные связи. |
| A25 | Переместить карточку на доске | Меняется только статус; parent, даты и связи сохранены. |
| A26 | Сохранение не удалось / пропала сеть | Не показано ложное «Сохранено»; повтор не дублирует команду. |
| A27 | Перезапуск / synthetic legacy upgrade / восстановление backup | C17/M01–M10: approved materialized pairs и exact originals сохранены; stale/missing preview acknowledgement блокирует writes. Restore остаётся S5. |
| A28 | Export → новый чистый экземпляр → import | Эквивалентный проект; никакого account/session/password hash в экспорте. |
| A29 | Импорт неправильной схемы/цикла/огромного файла | Отклонён контролируемо, частичных изменений нет. |
| A30 | Только клавиатура | Можно создать/выбрать/изменить/переместить задачу; Tab не ломает формы; Esc/фокус корректны. |
| A31 | Без аккаунта / неверная сессия / CSRF | Нет доступа к проектам и мутациям, даже при известном ID. |
| A32 | Production container restart | Данные на томе, процесс не root, graceful shutdown, healthcheck не выдаёт секретов. |
| A33 | Просмотр страницы Network и production bundle | Нет аналитики, CDN, AI endpoints, секретов и экспортов пользовательских задач. |
| A34 | Synthetic screenshot review 1440×900 и 1280×800 | Соответствует трём выбранным референсам; нет новых тяжёлых дашбордов. |
| A35 | Проверки первого push | Index/history guard + Gitleaks + ручная проверка изображений/metadata; owner authorization. |

| A36 | Создать/открыть все сочетания необязательных сроков; сменить день и timezone | C19: собственная дата → родительская группа → today; длина duration или 1, обе реальные даты приоритетнее. Данные/revision/summary/CPM не меняются от отображения, фильтра или смены дня. Клавиатура открывает полосу, стрелки не записывают условные края. Default duration очищаема, Today явный, retry/undo атомарны. |

## Дополнительные автоматические свойства

Для целевой модели: исходные nullable поля не заполняются условным display; FS проверяется по реальным границам; чистый C16 не меняет даты, активная запись C24 выполняет выбранный causal cascade; duration и календарная длина согласованы. Summary охватывает всех конечных потомков только при полном интервале, иначе обе даты null. Collapse/filter не меняют реальные данные и knownStartMin группы; одинаковый вход даёт одинаковый результат; undo возвращает исходную проекцию по содержимому (revision может увеличиться); ошибка транзакции ничего не меняет. C16 ready: projectFloat/constraintFloat неотрицательны, constraintFloat<=projectFloat, изменение технической опоры не меняет результат, tight predicate проверяет сами рабочие границы. Incomplete не выдаёт partial за global; infeasible не выдаёт floats/critical sets. C17 stale/missing acknowledgement и failed version insert откатывают весь upgrade. Старые Auto-свойства не являются целевым контрактом.

Для calendar-тестов обязательно проверить конец месяца/года, високосный февраль и даты перехода DST, даже если интерфейс работает только с днями. Для export/import проверить HTML/script как обычный текст, обход путей и ссылки на чужой проект.

## Минимальные наборы тестов после S0

Domain unit + property tests, SQLite integration, API auth/validation/transaction tests, React interaction tests, Playwright E2E и визуальный smoke. `npm test` не должен запускать только kit tests и считаться полным тестированием leaf.

## Компактное рабочее пространство C20

Обязательные критерии CW01–CW08 заданы в [спецификации C20](superpowers/specs/2026-10-08-compact-workspace-design.md): вместимость длинного дерева в двух viewports, отсутствие общей сводки и missing-date warnings, keyboard/focus/dirty forms, сохранённые настройки и undo, локальные FS-конфликты, partial/global labels, меню проекта слева, подписанная отмена в шапке, отсутствие повтора «Задачи» и локальной справки, управление шкалой только при включённом Ганте с постоянно доступным переключателем. Серверные данные и revision не изменяются от действий представления.

## FS-зависимости C24 / D17

Уточнение 2026-10-09: hover/focus строки в обоих видах «Список / Гант» и во вкладке «Подзадачи» не показывает кнопку связи; подзадачу создают иконка «Добавить подзадачу» строки ([C30](DECISIONS.md)) и Shift+Enter, отдельная кнопка «+ Подзадача» удалена по C29. На диаграмме цепочка появляется при hover/keyboard focus, открывает picker и возвращает фокус после закрытия. Действия представления не меняют snapshot.

[Нормативная спецификация](superpowers/specs/2026-10-08-fs-dependencies-design.md) задаёт независимые literal F01–F16: поздний push/tight pull, промежуток/max/diamond, weekdays/all-days, null и unknown barriers, direct-edit/done/unavailable rollback, удаление/overflow и отсутствие ремонта прежних конфликтов. §6.1 требует двух равных critical ветвей, после одного edit только A/B/AB critical, literal projectFloat 0/0/2/2 и constraintFloat 0/0/0/2, parent ranges P/Q/R, одну точную undo и restart. Expected values не выводятся из реализации.

Actual-server browser matrix в 1440×900 и 1280×800: основной QuickAdd и подзадача (nullable dates, edge/task одна revision, отдельные drafts/фокус), Details (canonical dates/clean baseline/undo), conditional Гант (один existing edge command, sibling control, без panel/drag), hidden duplicate paths вне фильтра, bounded keyboard visibility и dynamic growth у нижнего края. Проверяются nested Escape, loading/empty/search/errors, dirty guards и no-ack состояние. Lost-response тест сначала реально применяет command через route.fetch, затем теряет ответ; exact body/operationId retry даёт один outcome/task/edge/revision. 409 после настоящей конкурирующей записи и domain/source/done/cycle/calendar failures сохраняют draft/IDs и атомарный snapshot. Исторические infeasible diagnostics и frozen replay assertions сохраняются отдельно от live команд.

Уточнение видимости FS на Ганте: связь датированной (в том числе завершённой) работы с бездатной подзадачей и связь двух условных полос видны после ack, сохраняются после reload и исчезают после удаления/undo. Пунктир отличает условную геометрию; source/null поля и серверный CPM не меняются от отображения. No-ack не показывает новую стрелку; фильтр/collapse и концы вне периода скрывают её. Start-only/finish-only используют ту же геометрию, что полоса; перекрытие не закрывает наконечник.

## Размещение новой FS-связи C25 / D18

L01–L09 из [спецификации](superpowers/specs/2026-10-08-fs-link-placement-design.md): strict inclusive-finish boundary, совместный source/relation edit с каноническими датами, maximum fan-in, реальные nullable поля, атомарные retry/undo/rollback, условная цепочка по полному графу, смена today в обе стороны, filter/collapse/reveal, keyboard и clipped overflow. Условная геометрия не подменяет реальные FS/CPM/summary.

## Левая ручка Ганта C27 / D19

[GSR01–GSR07](superpowers/specs/2026-10-09-gantt-start-resize-design.md) проверяют фиксированное включительное окончание, literal рабочую длительность и прежний null при undo, minimum one-day/границы/выходной без snapping, incoming FS rollback без push целевой работы, неизменный downstream и пересчитанные summary/CPM. Strict V2/V1 compatibility, exact retry/receipt/restart, stale revision, done/summary/conditional/unavailable и no-op guards обязательны. Actual-server pointer/keyboard/cancel/focus/no-ack/dirty regressions выполняются в 1440×900 и 1280×800; C18, body move и правая ручка сохраняют поведение. В настоящем браузере обе видимые ручки доступных для редактирования реальных краёв имеют одинаковую полупрозрачную белую заливку `#ffffff99`, обозначающую изменение размера; computed fill и внешний вид проверяются на длинных и однодневных полосах в обоих viewport. Отдельные зоны `edgeWidth` сохраняются для однодневной полосы в days/weeks/months.

## Журнал задач — J01–J16, D21

Нормативные действия/ожидания — [спецификация журнала](superpowers/specs/2026-10-10-task-journal-design.md). Ниже исполняемые синтетические evidence; итоговые PASS/FAIL/NOT RUN и числа находятся в [STATUS](STATUS.md). Серверные suites входят в перечисляющие unit/integration scripts; browser suites используют настоящий authenticated runtime, новые изолированные contexts, 1440×900 и 1280×800, без записываемых traces/video/screenshots.

| ID | Исполняемое evidence | Что проверяется |
|---|---|---|
| J01 | `tests/journal-repository.test.ts`, `tests/journal-api.test.ts`, `tests/e2e/task-journal.spec.ts` | Leaf/summary/done/undated, общий server ID в обеих лентах, CRUD/reload/reopen. |
| J02 | `tests/journal-contracts.test.ts`, `tests/client/journal.test.tsx`, `tests/e2e/journal-drafts.spec.ts` | Leap/calendar validation, буквальный Moscow day при UTC/browser-zone boundary; untouched меняется, touched/dirty/cleared сохраняется. |
| J03 | `tests/journal-repository.test.ts`, `tests/e2e/task-journal.spec.ts` | Точный body/date edit, неизменный createdAt и server updatedAt, перенос групп, delete/Cancel и reopen. |
| J04 | `tests/journal-contracts.test.ts`, `tests/journal-api.test.ts`, `tests/e2e/task-journal.spec.ts` | Strict bounds/invalid requests, well-formed Unicode/NUL, исходные пробелы/переносы, HTML отображается текстом. |
| J05 | `tests/journal-api.test.ts`, `tests/e2e/journal-drafts.spec.ts` | Origin/JSON/contract/bodyLimit/scoped auth failures; реальный logout/401 очищает RAM и закрывает доступ. |
| J06 | `tests/journal-replay.test.ts`, `tests/e2e/journal-drafts.spec.ts` | Durable exact POST/PATCH/DELETE replay, неизменные UUID/envelopes, один эффект; unknown→admission429 сохраняет envelope/lock; client fixtures unknown→409/404 разрешают explicit rebase/removed copy-only, поздний delete перед frozen ack не воскрешает строку. |
| J07 | `tests/journal-repository.test.ts`, `tests/client/journal-drafts.test.tsx`, `tests/e2e/journal-drafts.spec.ts`, `tests/e2e/task-journal.spec.ts` | Две сессии, pinned5 после remote6/focus/close/reopen/Back,409 без overwrite, explicit rebase/new confirmation; revision/tasks/FS/CPM/Undo плана не меняются от журнала. |
| J08 | `tests/journal-lifecycle.test.ts`, `tests/e2e/journal-navigation.spec.ts` | Stable task IDs/provenance и journal bytes при plan edits/Undo; реальные rename/move/create согласуют labels/picker без изменения dirty planning baseline. |
| J09 | `tests/journal-lifecycle.test.ts`, `tests/e2e/task-journal.spec.ts` | Nested delete/rollback и exact restore IDs/body/date/timestamps; позднее изменение surviving записи сохраняется, revision монотонна. |
| J10 | `tests/journal-lifecycle.test.ts` | Поздние записи блокируют Undo создания; explicit delete разрешает retry, независимая corruption/manifest/digest matrix полностью откатывает restore, collision/version0/zero-entry/pruning. |
| J11 | `tests/journal-migration.test.ts`, `tests/optional-migration.test.ts`, `tests/backup.test.ts`, `tests/e2e/task-journal.spec.ts` | Fresh/schema3/schema4 reopen/failure; legacy preview gate/gaps/future, frozen bytes, синтетический backup журнала и реальный server restart. |
| J12 | `tests/journal-pagination.test.ts`, `tests/e2e/task-journal.spec.ts` | 125 records/50-item pages, дата на границе, no duplicates/gaps, Russian/title/literal `%/_` search, включительный период, stale после rename/delete. |
| J13 | `tests/client/journal-coherence.test.tsx`, `tests/client/journal-navigation.test.tsx`, `tests/e2e/journal-navigation.spec.ts` | Header geometry; Gantt/list/filter/scale/period/collapse/selection/two-axis scroll, title→panel→origin, project defaults/Back/Forward/URL validation, unavailable valid ID против текущего списка и точный известный второй ID/demo re-entry; remote metadata и actual page/tree race/error без plan writes. |
| J14 | `tests/client/journal.test.tsx`, `tests/client/journal-compact.test.tsx`, `tests/client/journal-navigation.test.tsx`, `tests/e2e/task-journal.spec.ts`, `tests/e2e/action-menus.spec.ts` | Встроенный composer проекта без modal/focus trap (уточнение D21 от 2026-10-12): начальный фокус — выбор задачи, пока задача не выбрана, иначе поле текста (§5.7 [спецификации 2026-10-12](superpowers/specs/2026-10-12-journal-menu-ux-design.md)); Escape и успешное сохранение возвращают фокус на «Добавить запись»; иконки строки ([C30](DECISIONS.md)) с собственными hit target поверх даты, видимые и в суженной до 300 px колонке Ганта, same-name picker paths, summary/done/undated, Arrow/Escape/tab overflow, Ctrl/Cmd+Enter. Длинная лента имеет измеренный scrollTop>0 и видимый anchor; открытие composer и Escape сохраняют ID и offset первого видимого anchor, toolbar и header exact; после успешного сохранения ID/toolbar/header exact, anchor offset<0.1 CSSpx из-за нативного округления. |
| J15 | `tests/client/journal-context.test.tsx`, `tests/client/journal-drafts.test.tsx`, `tests/client/journal-navigation.test.tsx`, `tests/e2e/journal-drafts.spec.ts`, `tests/e2e/journal-navigation.spec.ts` | RAM isolation/project composer/task/edit/project, pending remount/exact retry, pinned baselines, dirty history guard, deleted task, beforeunload/logout/401, safe storage/URL/history; поздний focus не перехватывается. |
| J16 | `tests/client/journal.test.tsx`, `tests/demo-api.test.ts`, `tests/e2e/task-journal.spec.ts`, `tests/e2e/journal-drafts.spec.ts` | Empty/no-match/loading/error/load-more/stale/filtered-success, длинный plain text/path и narrow panel; demo admission/retry attempts, normal quotas, no log/browser-artifact leakage. |

Компактные меню и журналы U01–U13 ([спецификация 2026-10-12](superpowers/specs/2026-10-12-journal-menu-ux-design.md)): `tests/client/menu-position.test.ts` (U01), `tests/client/action-menu.test.tsx` (U02), `tests/client/journal-compact.test.tsx` (U05 jsdom, U06, U08, U09), `tests/client/inline-add.test.tsx` (U10 jsdom), `tests/e2e/action-menus.spec.ts` (U03, U04, U07, U10–U12), `tests/e2e/task-journal.spec.ts` (U05, U09, U09b), `tests/e2e/journal-drafts.spec.ts` (U09: регион «Новая запись журнала», Escape и сохранение черновика после закрытия); U13 — итоговые проверки в [STATUS](STATUS.md).

Public export/import и контейнерная приёмка не подменяются этими suites. S4–S6 остаются незавершёнными; production migration/deployment не выполняются этой задачей.

## Компактная карточка D22 — P01–P28

Нормативный контракт — [спецификация D22](superpowers/specs/2026-10-15-task-panel-ux-design.md#13-критерии-приёмки). Ниже проверенное синтетическое evidence 2026-10-16; итоговые команды и числа — в [STATUS](STATUS.md). Browser suites работают с настоящими HTTP/SQLite runtime, каждый test изолирован. Новая приёмка использует длинные название/описание, 30 потомков с глубокой веткой, fan-in/out и 55 записей на двух страницах. Строки таблицы означают покрытие перечисленными тестами, не завершение продуктовых S4–S6.

| ID | Test paths, результат | Проверенное поведение |
|---|---|---|
| P01 | PASS `tests/e2e/task-panel-ux.spec.ts`: desktop geometry | Одно название; 480 px при 1440×900/1280×800, видимые дерево/Гант. |
| P02 | PASS `tests/e2e/task-panel-ux.spec.ts`: desktop geometry, extreme title; `tests/e2e/task-journal.spec.ts`: actual panel scroll owner | Длинная ветка/описание/55 записей, один основной scroll; при нехватке высоты весь shell. |
| P03 | PASS `tests/e2e/task-panel-ux.spec.ts`: desktop geometry, whole task draft | Menu/date не меняют header/tabs/ширину; чистый footer скрыт, глобальные действия появляются для несохранённых полей/связей и retry. |
| P04 | PASS `tests/client/task-panel.test.tsx`; `tests/e2e/task-panel-ux.spec.ts`: whole task draft | Название/source/incoming сохраняются в RAM через три вкладки; статус сохраняется отдельно после выбора. Изменённое описание защищено трёхвариантным диалогом; его сохранение не отправляет остальные черновики. |
| P05 | PASS `tests/e2e/fs-dependencies.spec.ts`: C25 graph saves title source incoming; `tests/e2e/task-panel-ux.spec.ts`: whole task draft | Одна task.edit/revision/Undo, canonical даты 05–06.10.2026; цикл откатывает все поля. |
| P06 | PASS `tests/e2e/linked-plan-fields.spec.ts`; `tests/client/task-panel-schedule.test.tsx` | Literal C18, оба календаря, очистка и nullable без второго Apply. |
| P07 | PASS `tests/client/task-panel-schedule.test.tsx`; `tests/e2e/linked-plan-fields.spec.ts`: duration-only | Подписи start-only/finish-only/duration-only/empty, условные даты не source. |
| P08 | PASS `tests/client/task-panel-schedule.test.tsx`; `tests/e2e/optional-scheduling.spec.ts` | Summary full/incomplete, done reopen и tombstone, реальные locks. |
| P09 | PASS `tests/client/task-panel-schedule.test.tsx`; `tests/e2e/linked-plan-fields.spec.ts`; `tests/e2e/task-panel-ux.spec.ts`: whole task draft | Raw/format/weekend/order ошибки сохраняются; repair фокусирует поле. |
| P10 | PASS `tests/e2e/linked-plan-fields.spec.ts`: persistent editor; `tests/e2e/task-panel-ux.spec.ts` | Calendar Escape → date editor → panel; mounted DOM/raw сохраняются. |
| P11 | PASS `tests/e2e/subtasks.spec.ts`: scoped keyboard creation; `tests/client/App.test.tsx` | Enter создаёт один раз, root-bound Tab/Shift+Tab, отдельный draft. |
| P12 | PASS `tests/client/task-panel-navigation.test.tsx`; `tests/e2e/subtasks.spec.ts` | Dirty блокирует только создание с причиной; preserveWork и draft сохранены. |
| P13 | PASS `tests/e2e/subtasks.spec.ts`: full depth under main filter; `tests/client/task-panel-navigation.test.tsx`: branch return | Полная ветка под фильтром, обе оси scroll, фокус ребёнка; focus→blur отменяет deferred restore. |
| P14 | PASS `tests/e2e/fs-dependencies.spec.ts`: fan-in/fan-out arrows, whole-project picker; `tests/e2e/task-panel-ux.spec.ts` | Отдельные реальные рёбра/card endpoints; self/summary/duplicate/cycle запрещены. |
| P15 | PASS `tests/client/dependencies.test.tsx`; `tests/e2e/fs-dependencies.spec.ts`: C25 graph | Draft edges подписаны, incoming атомарны с task, dirty outgoing заблокирован. |
| P16 | PASS `tests/e2e/task-panel-ux.spec.ts`: outgoing success; `tests/client/dependencies.test.tsx`; `tests/e2e/fs-dependencies.spec.ts` | Отдельный outgoing command, cascade/retry/Undo, trigger получает фокус после busy; пользовательский фокус отменяет restore. |
| P17 | PASS `tests/client/task-panel.test.tsx`; `tests/client/dependencies.test.tsx`; `tests/e2e/fs-dependencies.spec.ts`: synthetic infeasible snapshot; `tests/e2e/compact-workspace.spec.ts`: local diagnostics | Saved CPM отделён от draft; partial/global/infeasible подписи и конфликт. |
| P18 | PASS `tests/e2e/task-journal.spec.ts`: real task create, branch deletion/Undo; `tests/e2e/task-panel-ux.spec.ts`: extreme title | Независимые task/journal drafts; journal submit не меняет plan revision; Undo-конфликты сохраняются. |
| P19 | PASS `tests/e2e/task-journal.spec.ts`: acknowledged task write survives failed feed GET; `tests/client/journal-compact.test.tsx` | Успех write отделён от GET; повторяет только чтение; новый composer не сбрасывается поздним GET. |
| P20 | PASS `tests/e2e/journal-drafts.spec.ts`: late read A/exact replay B; `tests/e2e/fs-dependencies.spec.ts`: uncertain create; `tests/client/App.test.tsx` | Exact operationId/envelope, один эффект, новые drafts и current revision переживают frozen ack. |
| P21 | PASS `tests/e2e/journal-drafts.spec.ts`: pinned revision5, saved breadcrumb; `tests/e2e/journal-navigation.spec.ts`; `tests/e2e/task-panel-ux.spec.ts`: journal header ancestor | Pinned baselines; ready→failed GET→coherent refresh переключает живую header-ссылку и сохраняет читаемый контекст. |
| P22 | PASS `tests/client/task-panel-navigation.test.tsx`: move targets, ordering boundaries; `tests/e2e/action-menus.spec.ts` | Поиск полного пути, корень, перестановка/уровни, запрет себя/потомка и Cancel. |
| P23 | PASS `tests/e2e/task-journal.spec.ts`: branch deletion and plan undo; `tests/journal-lifecycle.test.ts` | Предупреждение об удалении ветки/записей, exact restore и journal conflict. |
| P24 | PASS `tests/client/task-panel-navigation.test.tsx`; `tests/e2e/journal-navigation.spec.ts`; `tests/e2e/journal-drafts.spec.ts`: saved breadcrumb | Три решения, deferred/failing Save, project/parent/neighbor/Back/Forward guard; без перехода до ack. |
| P25 | PASS `tests/client/task-panel.test.tsx`: old subtasks alias; `tests/client/journal-navigation.test.tsx`; `tests/e2e/journal-navigation.spec.ts` | Старые details/subtasks URL, сохранение underlying view/двух осей/фокуса, coherent unknown-history rebase. |
| P26 | PASS `tests/e2e/task-panel-ux.spec.ts`: whole task draft, extreme title; `tests/e2e/linked-plan-fields.spec.ts`; `tests/e2e/action-menus.spec.ts` | Локальный Escape/Undo/Enter, Ctrl+Enter journal, keyboard menus/tabs/ошибки/disabled reasons. |
| P27 | PASS `tests/e2e/task-panel-ux.spec.ts`: 375×812, 375×420, 850×650, extreme title; native zoom ниже | Controls/overlays в viewport, один scroll, панель не добавляет document width; полный длинный ввод доступен. |
| P28 | PASS `tests/e2e/task-journal.spec.ts`: empty/loading/error/load-more; `tests/e2e/journal-drafts.spec.ts`: expired session/deleted task; `tests/e2e/optional-scheduling.spec.ts`; `tests/client/task-panel.test.tsx` | Различимы empty/loading/no-match/offline/deleted; stale metadata выключает ссылки; 401/logout очищают private RAM. |

Настоящий browser zoom 200% проверен в свежем headed Chromium на отдельном Xvfb display с syntheticRuntime. Пять нативных Control+equal переводят `innerWidth` 1440→720, `devicePixelRatio` 1→2 и `innerHeight` 813→406. Панель 480×813 становится fullscreen 720×406.5 CSS px (дробный CSS-пиксель при DPR2); общий document width при том же zoom равен 786 и с закрытой, и с открытой карточкой. Это существующая ширина underlying workspace, карточка её не увеличивает. Шапка с 300 символами, полное описание, все три поля дат, Save/Close и journal editor доступны; временный редактор 440×335 расположен в пределах viewport. Единственный постоянный scroller — shell. Enter добавляет перенос, Ctrl+Enter сохраняет journal entry. CSS zoom и page-scale emulation не использовались. Воспроизведение: свежий синтетический вход, открыть длинную задачу, выставить в меню Chromium 200%, проверить эти размеры, прокрутить к каждому полю/действию и отправить синтетическую запись с клавиатуры. Контекст/браузер/Xvfb/runtime после проверки закрыты; изображения/трассы/профили не сохранялись.

Ограничение history после reload: неизвестный в RAM visit не имеет надёжного физического index delta. UI/URL согласуются через новый visit и rebase; восстановление потерянного browser index не заявляется. Общая мобильная шапка и ширина underlying workspace, доска, restore/import/export и релизная S6 не входят в этот этап. D22 остаётся рабочим default.


## Уточнение карточки D22 — 2026-10-16

Актуальные правила — [UI](UI.md#правая-панель). `tests/client/task-card-redesign.test.tsx` содержит 15 независимых проверок отмены/сохранения, сохранности постороннего и более нового черновика, отката статуса при ошибке, последних подтверждённых сроков после общего Save и закрытия обоих редакторов после exact retry. `tests/e2e/task-card-redesign.spec.ts` проверяет с настоящим HTTP/SQLite: компактное состояние, раздельные записи, однодневный интервал и очистку, ошибки без потери текста, dirty-navigation, фактические четыре строки/переносы/увеличенный шрифт, изменение ширины textarea, отсутствие document scroll и потерянный уже committed ответ с тем же envelope/revision при повторе. Оба desktop projects также открывают карточку при 375×812. Синтетические screenshots состояний 01–08 сохраняются вне checkout и просматриваются вручную.

`tests/e2e/fs-dependencies.spec.ts`, сценарий C25 Details, теперь подтверждает одну task.edit сроков и нового предшественника именно по «Готово», canonical даты и общий Undo. Сценарий C25 graph отдельно сохраняет название/source/incoming общей кнопкой: fallback не утрачен. Одна отмена общего изменения не отменяет отдельно сохранённый статус — это самостоятельная подтверждённая операция.

Для новой карточки дополнительно проверен нативный 200% в свежем headed Chromium на отдельном Xvfb: пять X11 Ctrl+equal, DPR 2, viewport 719×406 CSS px, fullscreen panel 719.5×406. Одинаковая ширина underlying документа 786 CSS px до/после открытия остаётся прежним ограничением общей мобильной шапки. Inline-описание, явная отмена, все три поля сроков и переход в пустой журнал доступны; CSS zoom и page-scale emulation не применялись. Профиль и runtime синтетические, без доступа к пользовательским сессиям.


## Ход работы задачи D23 — W01–W10

Спецификация: [task work progress](superpowers/specs/2026-10-16-task-work-progress-design.md). Приёмка использует независимую синтетику, существующий сервер и два browser projects 1440×900/1280×800; внутри сценариев также 375×812, 375×240, 1440×180 и расширенная панель. Новые client evidence: `tests/client/work-progress.test.tsx`, `journal-entry-body.test.tsx`, `journal-preview-anchor.test.tsx`. Browser evidence: `tests/e2e/work-progress.spec.ts`, действующие journal/navigation/draft suites. Общие итоги команд — в STATUS.

| ID | Проверенное поведение и evidence |
| --- | --- |
| W01 | Task tab «Ход работы», project tab «Журнал», прежние внутренние IDs/URL; client и browser navigation. |
| W02 | Две исходные строки, autogrow ввода/вставки/ширины/шрифта, полная ширина в 480 px панели, side-by-side только от 500 px контейнера; browser geometry/clear/focus. |
| W03 | Enter переносит строку, Ctrl/Cmd+Enter сохраняет точный body/workDate; IME и невалидная дата/пустой текст/лимит не отправляются; client и actual-server browser. |
| W04 | Короткий текст без toggle; пятистрочный, переносимый и длинный URL ограничены четырьмя визуальными строками; ResizeObserver/font events обновляют основание toggle. |
| W05 | LF/CRLF, пустые крайние строки и серии из пробелов/табуляции сокращаются только в preview; normalized-short доступен полностью, server/editor и раскрытые записи обеих лент показывают исходный body. |
| W06 | Независимые раскрытые IDs переживают refresh, вкладки, edit-close и временную выгрузку tail pages; новая задача сбрасывает раскрытие. Hidden short→long/long→short измеряется при reveal. |
| W07 | Backdated группы, пагинация и точный anchor ID/offset сохраняются. В hidden browser regression 25 записей и пять изменённых верхних body возвращаются к исходному offset −17 px. Следующая страница загружается только при нехватке высоты для offset; reachable и exhausted-cursor ветви покрыты. |
| W08 | Existing journal/draft/replay/coherence/navigation проверки сохраняют независимость task draft, retry и сохранность текста; общий результат full suites записывается в STATUS. |
| W09 | Keyboard toggle/меню/date/save/clear, узкая/низкая панель, реальный browser zoom 200% — без горизонтального переполнения панели. |
| W10 | По уточнению владельца project feed использует тот же четырёхстрочный preview, независимые toggle и исходный текст при раскрытии; существующий full editor обеих лент показывает raw body и текстовые действия. |

Нативный zoom 200% проверен root в свежем headed Chromium на отдельном Xvfb display, с disposable syntheticRuntime и новым browser context. Пять нативных X11 Ctrl+equal изменили innerWidth 1439→719, innerHeight 812→406 и DPR 1→2. Панель clientWidth/scrollWidth равны 719 CSS px. Из существовавшей underlying ширины документа 786 CSS px не выводится отсутствие общего mobile overflow; сама панель не переполняется. Раскрытие/сворачивание записи, меню и возврат фокуса, дата, save/clear доступны с клавиатуры и проверены в viewport. Enter добавляет перенос, Ctrl+Enter создаёт ровно одну новую запись с полным текстом; plan revision неизменна. CSS zoom/page-scale emulation не применялись. Browser/runtime/Xvfb закрыты; личные профили, sessions и данные не использовались.


Уточнение W10, 2026-10-16: новый project-specific client scenario в `work-progress.test.tsx` проверяет нормализацию только preview, независимое раскрытие и refresh без записи API. Browser `work-progress.spec.ts` проверяет обе ленты, полный исходный CRLF/editor и общий журнал из 55 записей: четыре строки, независимые toggle, две страницы, сохранение anchor/раскрытия после refresh и смены project tabs, поиск по скрытой строке и неизменную plan revision. Результат команд фиксируется в актуальной записи STATUS.
