# Synthetic scheduling examples

`cpm-cases.json` contains numerical input/output examples, not an application export format. Working-day indices use half-open intervals; date displays use inclusive finish. No real projects or people are represented.

The examples cover: one-day duration, fork/join, critical-path switch, equal paths, disconnected components, release constraint, noncritical fixed work, fixed conflict, cycle, empty graph. `calendar-cases.json` covers weekends, all-days, year boundary and leap day; public holidays intentionally do not alter the weekday calendar.

The kit verifies these examples using a small independent checker under scripts. This is NOT the production scheduling module and does not validate a future implementation. Port these expectations into real domain tests; add unknown duration, summary hierarchy, transactions, fixed/done semantics, error handling and undo tests from docs/ACCEPTANCE.md.
