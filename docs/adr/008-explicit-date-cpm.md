# ADR 008 — критический путь введённого расписания

Дата: 2026-10-07. Статус: принято владельцем для будущей реализации, [C16](../DECISIONS.md); current execution annex `9c71ed2aa8b8f9f9a68a282d50189b24299d14df` прошёл два независимых review 2026-10-08. Historical C17/math approval bfa0f8e сохранён отдельно. O06/G-CPM закрыт как выбор политики; pure CPM подключён в Task7 B/C после reviewed Task5 GREEN; current LIVE-only guards и UI/browser acceptance остаются D/E.

## Контекст

C11 исключает Auto от начала проекта; C13 разрешает независимо пустые даты/длительность. C05 по-прежнему требует настоящий пересчёт критического пути. Нулевое разрешение менять дату не делает каждую работу критической. Принятые формулы и независимые P01–P11 находятся в [нормативном приложении, разделы 1–4](../superpowers/specs/2026-10-07-optional-scheduling-policy-proposal.md).

## Решение

- В CPM входят только leaf tasks с валидной парой введённых дат. Calendar span — длительность анализа; nullable duration допустима, заданная должна совпадать. Нет вывода отсутствующей границы, source writes, summary vertices или display inputs.
- В рабочей координате `H=max(f)`, включая независимые компоненты и done. Обратный проход: терминальный LF=H, иначе LF=min(H, LS последователей); LS=LF-d. `projectFloat=LS-s` — структурный резерв текущего расписания, без разрешения изменить источник или done.
- `constraintFloat=0` для done; для todo/doing — min(H-f, s последователей минус f). Это локальный резерв при сохранении остальных введённых интервалов. Нулевой constraintFloat не заменяет project-critical.
- Project-critical task имеет projectFloat=0. Critical edge имеет нулевые projectFloat обоих концов и f предшественника=s последователя. Возвращаются sorted множества IDs, включая равные пути; экспоненциальное перечисление путей не требуется.
- `analysisStatus`: `ready`, `incomplete` или `infeasible`. В ready допустимы обычные projectFloat/constraintFloat и criticalTaskIds/criticalDependencyIds. Любой известный FS-конфликт имеет приоритет infeasible; normal/partial critical IDs и floats отсутствуют.
- В incomplete общие floats отсутствуют и общие critical IDs пусты с unknown-пояснением. Отдельный `partialAnalysis` допускается только для полностью датированных слабосвязных компонент, с общим `Hknown=max(f)` всех известных валидных leaves. Поля `knownHorizonFloat`, `partialCriticalTaskIds`, `partialCriticalDependencyIds` относятся только к этому нижнему горизонту. UI явно подписывает анализ датированной части; unknown-компонента блокируется целиком, без рёбер в обход unknown.
- Историческое техническое имя `pending-policy` сохраняется для intermediate/frozen responses. До подключения нового расчёта оно означает отсутствие реализации CPM, а не отсутствие принятого решения владельца: UI объясняет «Расчёт критического пути ещё не подключён», critical IDs пусты, floats отсутствуют. Intermediate status не является выполненным C05; frozen outcome после внедрения CPM не пересчитывается.

## Альтернативы и последствия

Относительный longest-path только по duration может расходиться с Гантом. Аналитический вывод границ расширяет W01 и создаёт ещё один вид дат. Принят анализ показанных интервалов: gaps дают резерв, independent components используют единый горизонт. ProjectFloat является структурной аналитикой и не обещает автоматического сдвига; constraintFloat объясняет ограничения текущего размещения.

Pure analysis остаётся серверным и детерминированным, частью той же транзакции/revision. Calendar arithmetic не перебирает каждый день длинного диапазона. Summary лишь агрегирует критичность конечных потомков; частичная summary critical имеет отдельную подпись.

## Проверка

Task7 B/C реализует approved pure coordinate/graph/backward/composition и одновременно server-only initial frozen projection/source helpers из exact Task4 f5e92ab pin. Existing frozen calendar и archived pending outcome сохранены; adapter/resolver/preview/preparer не импортируют active scheduling/planning/calendar. Проверено: 50 literal CPM tests, 144 focused contracts/domain/calendar/Task2 tests, независимый перебор допустимых задержек по 14 ready fixtures, 117 focused compatibility tests, unit 310/integration 180 без skips, typecheck/lint/build/format/package PASS. Это промежуточный GREEN checkpoint перед двумя independent implementation reviews. LIVE-only current server guards D и server criticality UI/browser acceptance E ещё не реализованы; C05/OS16 не объявляются выполненными.

Следующие записи описывают evidence и ограничения на момент технического review annex; они не подменяют implementation acceptance.

Математические policy inputs и P01–P11 приняты владельцем. [Технический implementation annex Task 6](../superpowers/plans/2026-10-07-explicit-date-cpm.md) определяет полный typed DTO/strict schemas, pure function contracts, numerical fixture format, runnable RED/GREEN steps, fork/join, deep-summary, conflict+unknown и undo/restart cases. Current execution candidate `9c71ed2aa8b8f9f9a68a282d50189b24299d14df` получил независимые Spec **APPROVED** и Standards/executability **APPROVED**. Эти reviews проверили atomic B/C LIVE/freeze checkpoint, focused compatibility guards и отдельный D deliverable; математический/typed body и все snippets сохранены. Прежние verdicts для C17 candidate `bfa0f8e1d2cf42a8d0c13f9e968304217ba931f9` и `29f193ea8dcd7ab0213fe84fc7dafa913a4a4b21` остаются историческими. Последующая metadata запись сохраняет approved body/procedural instructions/snippets и не является review реализации.

Reviewed C17 source boundary задаёт server-private `PrivateSnapshotV2.legacyIntervalUnavailable` → pure `OptionalInput.unavailableTaskIds`. Marked retained valid pair остаётся unknown для real/coverage/full summary/CPM и Hknown; raw known FS conflict, source minima/notes и original edges сохраняются. Public Task/DTO не получают provenance. Annex задаёт explicit validated clear с original-done return, private undo/reopen/preserveWork passage и server-only frozen pending projection для initial migration/preview, отдельно от единственного current LIVE scheduler. Это reviewed technical contract, actual runtime integration ещё относится к Task5.

Task 7 реализует принятые формулы и проверяет точные task/edge IDs, gaps, независимые компоненты, done, partial/infeasible, calendar, глубокую дату и одну отмену. Документальные kit checks не заменяют application tests/OS16. Production release по-прежнему требует S4–S6.

Новый CPM документом не реализован; Task5 GREEN остаётся условием Task7. Нормативная C16 классифицирует сохранённый invalid/mismatch source как unknown/incomplete без доказанного FS-конфликта; Task7 явно адаптирует промежуточную классификацию Task2 в этих границах. Task4 private source pin `f5e92abf7d2cb9655cfe11e6173f70ae375df857` прошёл два review; actual transactional persistence/clear/undo/preserveWork и acknowledgement integration Task5 ещё должны пройти собственные checks/review. Любое последующее изменение scheduling input или substantive annex требует amendment и двух новых независимых reviews до подключения CPM.
