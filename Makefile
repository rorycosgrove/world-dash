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

build:
	docker-compose build

up:
	docker-compose up -d
	@echo "Services started!"
	@echo "API: http://localhost:8000"
	@echo "Frontend: http://localhost:3000"

down:
	docker-compose down

logs:
	docker-compose logs -f

restart:
	docker-compose restart

clean:
	docker-compose down -v
	@echo "Containers and volumes removed"

test:
	docker-compose exec api pytest -v --cov=packages

lint:
	docker-compose exec api ruff check packages/ apps/
	docker-compose exec api mypy packages/ apps/

format:
	docker-compose exec api black packages/ apps/ tests/
	docker-compose exec api ruff check --fix packages/ apps/

migrate:
	docker-compose exec api alembic upgrade head

seed:
	docker-compose exec api python scripts/seed.py

# Development commands (run without Docker)
dev-api:
	cd apps/api && uvicorn main:app --reload

dev-worker:
	celery -A apps.worker.celery_app worker --loglevel=info

dev-web:
	cd apps/web && npm run dev

# Database commands
db-shell:
	docker-compose exec postgres psql -U worlddash -d worlddash

db-backup:
	docker-compose exec postgres pg_dump -U worlddash worlddash > backup_$$(date +%Y%m%d_%H%M%S).sql

db-reset:
	docker-compose down -v
	docker-compose up -d postgres redis
	@echo "Waiting for PostgreSQL..."
	@sleep 5
	$(MAKE) migrate
	$(MAKE) seed
