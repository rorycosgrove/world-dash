# World Dash — Development Guide

## Docker Development (Recommended)

### Prerequisites
- Docker Desktop installed and running
- 8 GB RAM minimum
- (Optional) Ollama running locally for LLM enrichment

### Start All Services

```powershell
# Copy environment template and edit
Copy-Item .env.example .env
notepad .env   # Set POSTGRES_PASSWORD; optionally set NEXT_PUBLIC_MAPBOX_TOKEN

# Start all 7 services
docker compose up -d

# Seed database with 15 RSS sources
docker compose exec api python scripts/seed.py
```

Services:
- **Dashboard**: http://localhost:3000
- **API docs**: http://localhost:8000/docs
- **API health**: http://localhost:8000/health

### Rebuild After Code Changes

Use the `rebuild.ps1` script to rebuild and restart services:

```powershell
# Rebuild all services
.\rebuild.ps1

# Rebuild specific services
.\rebuild.ps1 -Services web,api

# Rebuild without Docker cache
.\rebuild.ps1 -Services api -NoCache
```

Or do it manually:

```powershell
# Rebuild and restart a single service
docker compose build api
docker compose up -d api
```

### View Logs

```powershell
# All services
docker compose logs -f

# Specific service
docker compose logs -f worker
docker compose logs -f llm-worker

# Last 100 lines
docker compose logs --tail=100 api
```

### Execute Commands in Containers

```powershell
# Open a shell
docker compose exec api bash

# Run seed script
docker compose exec api python scripts/seed.py

# Database shell
docker compose exec postgres psql -U worlddash -d worlddash

# Trigger ingestion immediately
docker compose exec api python -c "from apps.worker.tasks import ingest_all_sources_task; ingest_all_sources_task.delay()"
```

### Reset Database

```powershell
docker compose down
docker volume rm world-dash_postgres_data
docker compose up -d
# Re-seed after migrations complete
docker compose exec api python scripts/seed.py
```

---

## Local Development (Non-Docker)

### Prerequisites
- Python 3.12+
- uv (https://astral.sh/uv)
- PostgreSQL 16+ with PostGIS extension
- Redis 7+
- Node.js 20+
- npm

### 1. Python Setup

```powershell
uv venv
.\.venv\Scripts\Activate.ps1

uv pip install -e .
uv pip install -e ".[dev]"
```

### 2. Environment Configuration

```powershell
Copy-Item .env.example .env
# Edit .env with local database and Redis credentials
```

### 3. Database Migrations

```powershell
uv run alembic upgrade head
uv run python scripts/seed.py
```

### 4. Run API

```powershell
cd apps/api
uv run uvicorn main:app --reload --port 8000
```

### 5. Run Workers (separate terminals)

```powershell
# Default worker (ingestion, normalization, analysis)
cd apps/worker
uv run celery -A celery_app worker --loglevel=INFO -Q default

# LLM worker (Ollama tasks)
cd apps/worker
uv run celery -A celery_app worker --loglevel=INFO -Q llm -c 1

# Beat scheduler
cd apps/worker
uv run celery -A celery_app beat --loglevel=INFO
```

### 6. Run Frontend

```powershell
cd apps/web
npm install
npm run dev   # http://localhost:3000
```

### Environment Variable: PYTHONPATH

If you see `No module named 'packages'`, set:

```powershell
$env:PYTHONPATH = "c:\code\world-dash"
```

---

## Testing

### Backend Tests

```powershell
# Run all tests
uv run pytest

# Run with coverage
uv run pytest --cov=packages --cov-report=html

# Run specific test file
uv run pytest tests/test_storage.py -v

# Run with markers
uv run pytest -m "not slow"
```

Tests use SQLite in-memory with compatibility shims for PostGIS types.

### Frontend Tests

```powershell
cd apps/web
npm run test
```

---

## Code Quality

### Python

```powershell
# Formatting
uv run black packages/ apps/ tests/

# Linting
uv run ruff check packages/ apps/ tests/
uv run ruff check --fix   # Auto-fix

# Type checking
uv run mypy packages/ apps/
```

### TypeScript

```powershell
cd apps/web
npm run lint
```

---

## Common Development Tasks

### Adding a New Feed Source

Option A — via Settings UI:
1. Navigate to http://localhost:3000/settings
2. Use the Sources tab to add a new feed

Option B — via API:
```powershell
curl -X POST "http://localhost:8000/sources" `
  -H "Content-Type: application/json" `
  -d '{"name": "My Feed", "url": "https://example.com/rss", "type": "rss", "enabled": true, "tags": ["custom"]}'
```

Option C — via seed script:
1. Add to `scripts/seed.py` SAMPLE_SOURCES
2. Run `python scripts/seed.py`

### Configuring Ollama / LLM

Option A — via Settings UI:
1. Navigate to http://localhost:3000/settings
2. Switch to the Ollama tab
3. Set endpoint, model, timeout, and enable/disable

Option B — via API:
```powershell
# Check current config
curl http://localhost:8000/llm/config

# Update config (stored in Redis, no restart needed)
curl -X PUT "http://localhost:8000/llm/config" `
  -H "Content-Type: application/json" `
  -d '{"endpoint": "http://host.docker.internal:11434", "model": "llama3.2", "timeout": 120, "enabled": true}'

# Check connectivity
curl http://localhost:8000/llm/health

# List available models
curl http://localhost:8000/llm/models
```

Option C — via environment variables:
Set in `.env` or `docker-compose.yml`:
```env
OLLAMA_ENDPOINT=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2
OLLAMA_TIMEOUT_SECONDS=120
OLLAMA_ENABLED=true
```

### Triggering Ingestion Manually

```powershell
# Via API
curl -X POST http://localhost:8000/sources/ingest-all

# Via script (Windows)
.\scripts\trigger-ingestion.ps1

# Via script (Linux/macOS)
./scripts/trigger-ingestion.sh
```

### Creating a Database Migration

```powershell
uv run alembic revision --autogenerate -m "description_of_change"
uv run alembic upgrade head
```

### Adding a New Alert Rule

Edit `packages/intelligence_engine/engine.py` and add to `_load_alert_rules()`:

```python
{
    "name": "Your Rule Name",
    "required_tags": ["tag1", "tag2"],
    "min_severity": EventSeverity.HIGH,
    "alert_severity": EventSeverity.CRITICAL,
    "alert_title": "Alert Title: {event_title}",
    "alert_description": "Description: {event_title}",
}
```

### Adding a New Celery Task

1. Add to `apps/worker/tasks.py`:

```python
@app.task(name="apps.worker.tasks.my_task")
def my_task(param: str):
    logger.info("my_task_started", param=param)
    # Implementation
    return {"success": True}
```

2. Trigger: `my_task.delay("value")`

### Adding a New API Endpoint

1. Add to `apps/api/main.py`:

```python
@app.get("/my-endpoint")
async def my_endpoint(session: Session = Depends(get_db_session)):
    return {"result": "data"}
```

2. Add client method in `apps/web/src/lib/api.ts`:

```typescript
async getMyData(): Promise<any> {
  const response = await apiClient.get('/my-endpoint');
  return response.data;
}
```

---

## Debugging

### Backend

**View SQL queries:**
```python
import logging
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
```

**Debug API with breakpoints:**
```powershell
uv pip install debugpy
# Add to apps/api/main.py: import debugpy; debugpy.listen(5678)
# Attach VS Code debugger
```

**Check worker task flow:**
```powershell
docker compose logs -f worker llm-worker
```

### Frontend

- **DebugLog panel** (right sidebar) shows real-time processing information including LLM scan progress
- **Browser DevTools** console shows `console.debug` messages from EventFeed with LLM scan stats
- **React DevTools** for inspecting component state
- **Network tab** for verifying API calls

### LLM Debugging

```powershell
# Check if Ollama is reachable
curl http://localhost:8000/llm/health

# View LLM worker logs
docker compose logs -f llm-worker

# Check LLM config
curl http://localhost:8000/llm/config

# Check analysis summary (shows LLM scan progress)
curl http://localhost:8000/analysis/summary
```

---

## Troubleshooting

### Services won't start
```powershell
docker info                    # Verify Docker is running
docker compose logs            # Check error messages
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Database connection refused
```powershell
docker compose ps postgres
docker compose logs postgres
docker compose restart postgres
```

### Redis connection failed
```powershell
docker compose restart redis
docker compose exec redis redis-cli ping
```

### Worker not processing tasks
```powershell
docker compose logs worker
docker compose exec redis redis-cli ping
docker compose restart worker beat
```

### LLM enrichment not working
1. Verify Ollama is running: `curl http://localhost:11434/api/tags`
2. Check LLM worker is up: `docker compose ps llm-worker`
3. Check config: `curl http://localhost:8000/llm/config`
4. Check logs: `docker compose logs -f llm-worker`
5. Ensure `OLLAMA_ENABLED=true`

### Frontend build errors
```powershell
cd apps/web
Remove-Item -Recurse node_modules, .next -ErrorAction SilentlyContinue
npm install
npm run build
```

### No events appearing
- Wait for first poll cycle (~5 minutes) or trigger manually
- Check worker logs: `docker compose logs -f worker`
- Verify sources exist: `curl http://localhost:8000/sources`

---

## Performance Tips

- **Database**: Add indexes for frequently queried fields; paginate large result sets
- **Workers**: Increase `worker` concurrency for more throughput; keep `llm-worker` at concurrency=1
- **API**: Use async endpoints for I/O-bound operations; leverage Redis caching
- **Frontend**: The EventNetworkMap uses `ResizeObserver` and fits to container — avoid unnecessary re-renders

---

## Best Practices

### Python
- Use type hints everywhere
- Follow repository pattern for database access
- Keep business logic in `packages/`, not in API endpoints
- Use Pydantic for all data validation
- Write docstrings for public functions

### TypeScript
- Use strict mode
- Avoid `any` type — use interfaces from `lib/api.ts`
- Handle loading/error states in components
- Use Zustand store for shared state

### Database
- Always use Alembic migrations — never modify models directly in production
- Index foreign keys and frequently queried fields
- Use PostGIS types for geospatial data

### Testing
- Write tests before fixing bugs
- Use fixtures from `tests/conftest.py`
- Mock external services (Ollama, RSS feeds)
- Aim for 80%+ coverage on core packages
