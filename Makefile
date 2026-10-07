.DEFAULT_GOAL := help
SHELL := /bin/sh

LEAF_DATA_DIR ?= $(HOME)/.local/share/leaf-dev
export LEAF_DATA_DIR
export BACKUP

.PHONY: help install install-browser dev build start admin-setup admin-reset-password \
	verify typecheck lint format-check test test-unit test-integration test-e2e \
	check-package db-migrate db-backup check-kit test-kit doctor preflight \
	security-workspace security-staged security-history hooks-install

help: ## Показать основные команды
	@awk 'BEGIN { print "leaf — основные команды:\n" } /^[a-zA-Z0-9_-]+:.*## / { split($$0, parts, "## "); sub(/:.*/, "", $$0); printf "  %-20s %s\n", $$0, parts[2] } END { print "\nLEAF_DATA_DIR: каталог SQLite вне репозитория; по умолчанию ~/.local/share/leaf-dev."; print "Backup: make db-backup BACKUP=/var/tmp/leaf-backups/new-snapshot.sqlite" }' Makefile

install: ## Установить зависимости по lockfile
	npm ci --strict-allow-scripts --no-audit --no-fund

install-browser: ## Установить Chromium и системные зависимости для E2E
	npm exec playwright -- install --with-deps chromium

dev: ## Запустить разработку на http://127.0.0.1:5173
	npm run dev

build: ## Собрать клиент и сервер
	npm run build

start: ## Запустить собранное приложение на http://127.0.0.1:3000
	npm start

admin-setup: ## Создать локальный аккаунт (один раз, после build)
	npm run admin:setup

admin-reset-password: build ## Задать новый пароль локально, сохранив проекты и задачи
	npm run admin:reset-password

verify: ## Проверить типы, lint, тесты и сборку
	npm run verify

typecheck: ## Проверить TypeScript
	npm run typecheck

lint: ## Проверить код через ESLint
	npm run lint

format-check: ## Проверить форматирование
	npm run format:check

test: ## Запустить все unit/integration тесты приложения
	npm test

test-unit: ## Запустить unit и клиентские тесты
	npm run test:unit

test-integration: ## Запустить интеграционные тесты
	npm run test:integration

test-e2e: build ## Собрать приложение и запустить браузерные E2E
	npm run test:e2e

check-package: ## Проверить границы Docker-пакета
	npm run check:package

db-migrate: ## Применить миграции (после build)
	npm run db:migrate

db-backup: ## Создать резервную копию: BACKUP=/absolute/new-snapshot.sqlite
	@if [ -z "$$BACKUP" ]; then \
		printf '%s\n' 'Укажите путь: make db-backup BACKUP=/var/tmp/leaf-backups/new-snapshot.sqlite' >&2; \
		exit 2; \
	fi
	@npm run db:backup -- "$$BACKUP"

check-kit: ## Проверить документацию, референсы и fixtures
	npm run check:kit

test-kit: ## Запустить kit/guard/hook тесты с настоящим Gitleaks
	npm run test:kit

doctor: ## Проверить версии инструментов и конфигурацию
	npm run doctor

preflight: ## Запустить все kit/privacy проверки репозитория
	npm run preflight

security-workspace: ## Проверить public workspace до появления runtime-файлов
	npm run security:workspace

security-staged: ## Проверить staged blobs через guard и Gitleaks
	npm run security:staged

security-history: ## Проверить историю и Git metadata
	npm run security:history

hooks-install: ## Явно установить локальные защитные Git hooks
	npm run hooks:install
