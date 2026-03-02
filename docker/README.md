# Docker Guide

This document covers how to run World Dash using Docker and Docker Compose.

## Prerequisites

- Docker
- Docker Compose
- (Optional) Mapbox API token for map visualization

## Configure Environment

```powershell
cp .env.example .env
```

Edit `.env` and set:
- Database credentials (change default password!)
- `NEXT_PUBLIC_MAPBOX_TOKEN` (get a free token from mapbox.com)

## Start Services

```powershell
docker-compose up -d
```

This starts:
- PostgreSQL (port 5432)
- Redis (port 6379)
- API service (port 8000)
- Celery worker
- Celery beat (scheduler)
- Frontend (port 3000)

## Initialize Database

```powershell
# Run migrations (see alembic/README.md)

# Seed sample RSS sources
docker-compose exec api python scripts/seed.py
```

## Access Points

- Dashboard: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

## Logs

```powershell
# View all logs
docker-compose logs -f

# View API logs
docker-compose logs -f api

# View worker logs
docker-compose logs -f worker
```

## Stop Services

```powershell
docker-compose down
```

## Reset Data (Destructive)

```powershell
docker-compose down -v
```
