# ADR 013 — изолированный публичный демо-режим

Дата: 2026-10-09. Статус: рабочее техническое решение D20 для подтверждённой задачи C28; реализация и независимые reviews отражаются в [STATUS](../STATUS.md).

## Контекст

Бесплатное Render demo должно показывать настоящий backend leaf и восстанавливать синтетический пример при каждом старте. Потеря изменений допустима. Обычный self-hosted экземпляр хранит личные данные и не должен случайно открываться без пароля или очищать существующий storage. [Спецификация](../superpowers/specs/2026-10-09-render-demo-design.md) задаёт точные API, seed, ограничения и приёмку.

## Решение

Только `LEAF_DEMO_MODE=1` включает отдельный server runtime: fresh mkdtemp вне checkout, миграции новой SQLite, случайный внутренний аккаунт и атомарный synthetic seed через Repository до listen/ready. Исходный LEAF_DATA_DIR не читается и не удаляется. Cleanup принадлежит только каталогу этого запуска, следует за закрытием SQLite и работает также при startup error. Normal loadConfig/CLI/storage/auth сохраняются.

POST `/api/auth/demo` с strict empty JSON и exact Origin выдаёт обычную opaque session cookie только в демо. GET session получает совместимое optional demoMode; клиент показывает явную кнопку и постоянное предупреждение об общих публичных данных/сбросе. Гости имеют независимые сессии/undo, shared workspace и existing revision conflicts. Демонстрационный password login отклоняется без scrypt; startup-generated password не раскрывается. Demo-only in-memory budgets ограничивают выдачу sessions и мутации до Repository; обычный режим их не получает.

Render Blueprint задаёт один free Docker service, manual deploy, health readyz и совпадающие PORT/LEAF_PORT. Exact configured HTTPS origin либо проверенный Render hostname fallback определяет cookie/CSRF; request headers не являются источником origin, trustProxy остаётся false. Docker default loopback origin удаляется, normal runtime вычисляет тот же default сам. Build context/privacy policies не расширяются.

## Последствия и альтернативы

Новая область доступа ограничена временной синтетической базой. Shared editing может давать409 и требует reload; после restart истекают фактически все demo sessions. SIGKILL не гарантирует удаление собственного каталога, но новый запуск всегда изолирован и не сканирует чужие temp paths. Ограничения Free/cold start и lifetime write budget видимы в документации; это не production release и не DDoS guarantee.

Публичный фиксированный пароль не выбран: он не ограничивает доступ и создаёт лишние дорогие derivations. Per-visitor databases не выбраны из-за lifecycle/ресурсной сложности. Static-only frontend не выбран, поскольку не демонстрирует сохранение и серверный CPM. Очистка существующего LEAF_DATA_DIR запрещена: новый runtime создаёт собственный storage вместо destructive reset.

Реальное размещение, push, публикация образа и изменения remote требуют отдельного разрешения владельца. [План из трёх блоков](../superpowers/plans/2026-10-09-render-demo.md) требует независимого review до каждого коммита и final review всей ветки.
