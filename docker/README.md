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
docker-compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml up -d
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
docker-compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml exec api python scripts/seed.py
```

## Access Points

- Dashboard: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

## Logs

```powershell
# View all logs
docker-compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs -f

# View API logs
docker-compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs -f api

# View worker logs
docker-compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs -f worker
```

## Stop Services

```powershell
docker-compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml down
```

## Reset Data (Destructive)

```powershell
docker-compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml down -v
```
