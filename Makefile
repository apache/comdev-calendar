# Convenience wrappers. Everything here can also be run by hand; see README.md.

.PHONY: help install backend frontend build test test-backend test-frontend \
        lint typecheck format check clean

help:
	@echo "install        install backend and frontend dependencies"
	@echo "backend        run the backend on the configured port"
	@echo "frontend       run the Vite dev server (proxies to the backend)"
	@echo "build          build the frontend into frontend/dist"
	@echo "test           run all tests"
	@echo "lint           ruff"
	@echo "typecheck      mypy and svelte-check"
	@echo "format         reformat the Python code"
	@echo "check          lint, typecheck and test"
	@echo "clean          remove build output and caches"

install:
	uv sync --all-groups
	cd frontend && npm ci

backend:
	uv run asf-calendar --reload

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

test: test-backend test-frontend

test-backend:
	uv run pytest

test-frontend:
	cd frontend && npm run test

lint:
	uv run ruff check backend
	uv run ruff format --check backend

typecheck:
	uv run mypy
	cd frontend && npm run check

format:
	uv run ruff format backend
	uv run ruff check --fix backend

check: lint typecheck test

clean:
	rm -rf frontend/dist frontend/coverage .pytest_cache .mypy_cache .ruff_cache htmlcov coverage.xml
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
