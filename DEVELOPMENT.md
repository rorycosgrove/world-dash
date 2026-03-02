# World Dash - Development Guide

## Setting Up Development Environment

### Backend Development

#### Prerequisites
- Python 3.12+
- PostgreSQL 16+ with PostGIS
- Redis 7+

#### Setup

1. **Create virtual environment:**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

2. **Install dependencies:**
```powershell
pip install -r requirements.txt
pip install -r requirements-dev.txt  # Dev dependencies
```

3. **Configure environment:**
```powershell
cp .env.example .env
# Edit .env with local database credentials
```

4. **Run migrations:**
```powershell
alembic upgrade head
```

5. **Seed data:**
```powershell
python scripts/seed.py
```

#### Running Services Locally

**API Server:**
```powershell
cd apps/api
python -m uvicorn main:app --reload --port 8000
```

**Celery Worker:**
```powershell
celery -A apps.worker.celery_app worker --loglevel=info --pool=solo
```

**Celery Beat:**
```powershell
celery -A apps.worker.celery_app beat --loglevel=info
```

### Frontend Development

#### Prerequisites
- Node.js 20+
- npm or yarn

#### Setup

1. **Install dependencies:**
```powershell
cd apps/web
npm install
```

2. **Configure environment:**
```powershell
# Create .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token_here
```

3. **Run dev server:**
```powershell
npm run dev
```

Access at: http://localhost:3000

### Testing

#### Backend Tests

```powershell
# Run all tests
pytest

# Run with coverage
pytest --cov=packages --cov-report=html

# Run specific module
pytest tests/test_storage.py -v

# Run with markers
pytest -m "not slow"
```

#### Frontend Tests

```powershell
cd apps/web
npm run test
npm run test:e2e  # Playwright E2E tests (TODO)
```

### Code Quality

#### Python

**Formatting:**
```powershell
black packages/ apps/ tests/
```

**Linting:**
```powershell
ruff check packages/ apps/ tests/
ruff check --fix  # Auto-fix issues
```

**Type checking:**
```powershell
mypy packages/ apps/
```

#### TypeScript

**Linting:**
```powershell
cd apps/web
npm run lint
```

**Formatting:**
```powershell
npm run format
```

## Common Development Tasks

### Adding a New Feed Source

1. Add to `scripts/seed.py` SAMPLE_SOURCES
2. Run seed script
3. Or use API:

```powershell
curl -X POST http://localhost:8000/sources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Source",
    "url": "https://example.com/feed.xml",
    "type": "rss",
    "enabled": true,
    "tags": ["tag1", "tag2"]
  }'
```

### Creating a Database Migration

```powershell
# Auto-generate migration from model changes
alembic revision --autogenerate -m "Add new field to events"

# Edit generated file in alembic/versions/

# Apply migration
alembic upgrade head

# Rollback if needed
alembic downgrade -1
```

### Adding a New Alert Rule

Edit `packages/intelligence_engine/engine.py`:

```python
def _load_alert_rules(self) -> List[dict]:
    return [
        # ... existing rules ...
        {
            "name": "Your New Rule",
            "required_tags": ["tag1", "tag2"],
            "min_severity": EventSeverity.HIGH,
            "alert_severity": EventSeverity.CRITICAL,
            "alert_title": "🚨 New Alert Type",
            "alert_description": "Description: {event_title}",
        },
    ]
```

### Adding a New API Endpoint

1. Add endpoint to `apps/api/main.py`:

```python
@app.get("/custom-endpoint")
async def custom_endpoint(session: Session = Depends(get_db_session)):
    # Implementation
    return {"result": "data"}
```

2. Update API client in `apps/web/src/lib/api.ts`:

```typescript
async getCustomData(): Promise<any> {
  const response = await apiClient.get('/custom-endpoint');
  return response.data;
}
```

### Adding a New Celery Task

1. Add task to `apps/worker/tasks.py`:

```python
@app.task(name="apps.worker.tasks.custom_task")
def custom_task(param: str):
    logger.info("custom_task_started", param=param)
    # Implementation
    return {"success": True}
```

2. Trigger from code:

```python
from apps.worker.tasks import custom_task
custom_task.delay("parameter")
```

## Debugging

### Backend

**Debug API with breakpoints:**
```powershell
# Install debugpy
pip install debugpy

# Add to apps/api/main.py:
import debugpy
debugpy.listen(5678)

# Run and attach VS Code debugger
```

**View SQL queries:**
```python
# In code:
import logging
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
```

### Frontend

Use React DevTools and browser developer tools.

**Enable verbose logging:**
```typescript
// In components, add:
console.log('Debug info:', data);
```

## Docker Development

### Rebuild Single Service

```powershell
docker-compose build api
docker-compose up -d api
```

### View Logs

```powershell
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f worker

# Last 100 lines
docker-compose logs --tail=100 api
```

### Execute Commands in Container

```powershell
# Open shell
docker-compose exec api bash

# Run Python script
docker-compose exec api python scripts/seed.py

# Database shell
docker-compose exec postgres psql -U worlddash
```

### Reset Database

```powershell
# Stop services
docker-compose down

# Remove volumes
docker volume rm world-dash_postgres_data

# Restart
docker-compose up -d

# Re-run migrations and seed
docker-compose exec api alembic upgrade head
docker-compose exec api python scripts/seed.py
```

## Performance Optimization

### Database Queries

1. **Add indexes** for frequently queried fields
2. **Use select_related/joinedload** to prevent N+1 queries
3. **Paginate** large result sets
4. **Cache** expensive queries in Redis

### API Performance

1. **Use async endpoints** for I/O-bound operations
2. **Implement caching** with Redis
3. **Add compression** middleware
4. **Profile** with Prometheus metrics

### Worker Performance

1. **Increase worker count** for CPU-bound tasks
2. **Use gevent pool** for I/O-bound tasks
3. **Batch operations** when possible
4. **Monitor queue length**

## Troubleshooting

### "No module named 'packages'"

Add to PYTHONPATH:
```powershell
$env:PYTHONPATH = "c:\code\world-dash"
```

### Database connection refused

Check PostgreSQL is running:
```powershell
docker-compose ps postgres
docker-compose logs postgres
```

### Redis connection failed

```powershell
docker-compose restart redis
docker-compose exec redis redis-cli ping
```

### Frontend build errors

```powershell
cd apps/web
rm -rf node_modules .next
npm install
npm run build
```

### Celery tasks not executing

1. Check worker is running: `docker-compose ps worker`
2. Check Redis connection
3. View worker logs: `docker-compose logs worker`
4. Restart: `docker-compose restart worker beat`

## Best Practices

### Python

- Use type hints everywhere
- Follow repository pattern for database access
- Keep business logic out of API endpoints
- Use Pydantic for data validation
- Write docstrings for public functions
- Keep functions small and focused

### TypeScript

- Use strict mode
- Avoid `any` type
- Create reusable components
- Use proper TypeScript interfaces
- Handle loading/error states
- Optimize re-renders with memo

### Database

- Always use migrations (never modify models directly in prod)
- Index foreign keys and frequently queried fields
- Use appropriate data types
- Avoid storing large blobs in PostgreSQL
- Back up before major changes

### Testing

- Write tests before fixing bugs
- Test edge cases and error conditions
- Use fixtures for common test data
- Mock external services
- Aim for 80%+ coverage on core logic

---

**Last Updated**: March 2026
