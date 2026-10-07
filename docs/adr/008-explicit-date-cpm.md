# ADR 008 — критический путь введённого расписания

Дата: 2026-10-07. Статус: принято владельцем для будущей реализации, [C16](../DECISIONS.md); technical annex прошёл два независимых review. O06/G-CPM закрыт как выбор политики; новый CPM ещё не реализован, Task7 требует Task5 GREEN.

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

Математические policy inputs и P01–P11 приняты владельцем. [Технический implementation annex Task 6](../superpowers/plans/2026-10-07-explicit-date-cpm.md) определяет полный typed DTO/strict schemas, pure function contracts, numerical fixture format, runnable RED/GREEN steps, fork/join, deep-summary, conflict+unknown и undo/restart cases. Substantive candidate `29f193ea8dcd7ab0213fe84fc7dafa913a4a4b21` получил Spec **APPROVED** и Standards/executability **APPROVED**; последующая запись review metadata не меняет формулы, типы или snippets и не является review реализации.

Task 7 реализует принятые формулы и проверяет точные task/edge IDs, gaps, независимые компоненты, done, partial/infeasible, calendar, глубокую дату и одну отмену. Документальные kit checks не заменяют application tests/OS16. Production release по-прежнему требует S4–S6.

Новый CPM документом не реализован; Task5 GREEN остаётся условием Task7. Нормативная C16 классифицирует сохранённый invalid/mismatch source как unknown/incomplete без доказанного FS-конфликта; Task7 явно адаптирует промежуточную классификацию Task2 в этих границах. C17 unavailable-lock representation остаётся pending Task4/5; изменённый scheduling input требует amendment annex и двух новых независимых reviews до подключения CPM.
