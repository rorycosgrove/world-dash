# Makefile for World Dash

.PHONY: help build up down logs restart clean test lint format migrate seed

help:
	@echo "World Dash - Development Commands"
	@echo ""
	@echo "  make build     - Build all Docker images"
	@echo "  make up        - Start all services"
	@echo "  make down      - Stop all services"
	@echo "  make logs      - View all logs"
	@echo "  make restart   - Restart all services"
	@echo "  make clean     - Remove containers and volumes"
	@echo "  make test      - Run backend tests"
	@echo "  make lint      - Run linters"
	@echo "  make format    - Format code"
	@echo "  make migrate   - Run database migrations"
	@echo "  make seed      - Seed database with sample data"

COMPOSE = docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d
	@echo "Services started!"
	@echo "API: http://localhost:8000"
	@echo "Frontend: http://localhost:3000"

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

restart:
	$(COMPOSE) restart

clean:
	$(COMPOSE) down -v
	@echo "Containers and volumes removed"

test:
	$(COMPOSE) exec api pytest -v --cov=packages

lint:
	$(COMPOSE) exec api ruff check packages/ apps/
	$(COMPOSE) exec api mypy packages/ apps/

format:
	$(COMPOSE) exec api black packages/ apps/ tests/
	$(COMPOSE) exec api ruff check --fix packages/ apps/

migrate:
	$(COMPOSE) exec api alembic upgrade head

seed:
	$(COMPOSE) exec api python scripts/seed.py

# Development commands (run without Docker)
dev-api:
	cd apps/api && uv run uvicorn main:app --reload

dev-worker:
	uv run celery -A apps.worker.celery_app worker --loglevel=INFO

dev-web:
	cd apps/web && npm run dev

# Database commands
db-shell:
	$(COMPOSE) exec postgres psql -U worlddash -d worlddash

db-backup:
	$(COMPOSE) exec postgres pg_dump -U worlddash worlddash > backup_$$(date +%Y%m%d_%H%M%S).sql

db-reset:
	$(COMPOSE) down -v
	$(COMPOSE) up -d postgres redis
	@echo "Waiting for PostgreSQL..."
	@sleep 5
	$(MAKE) migrate
	$(MAKE) seed
