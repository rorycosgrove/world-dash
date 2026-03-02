# ⚡ World Dash — Quick Start

Get the geopolitical intelligence dashboard running in **5 minutes**.

## Prerequisites

- Docker Desktop installed and running
- 8 GB RAM minimum
- (Optional) Ollama installed locally for LLM enrichment
- (Optional) Mapbox token for map visualization

## Step 1: Configure Environment

```powershell
cd c:\code\world-dash

# Copy environment template
Copy-Item .env.example .env

# Edit .env — set at minimum:
notepad .env
```

**Required:**
```env
POSTGRES_PASSWORD=YourSecurePassword123!
```

**Optional (recommended):**
```env
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token_here     # Free at https://mapbox.com/signup
OLLAMA_ENDPOINT=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2
OLLAMA_ENABLED=true
```

## Step 2: Start Services

```powershell
# Build and start all 7 services
docker compose up -d

# Wait for services to initialize (~30 seconds)
Start-Sleep -Seconds 30

# Verify all services are running
docker compose ps
```

You should see 7 running services:
| Service | Container | Status |
|---------|-----------|--------|
| postgres | worlddash-postgres | healthy |
| redis | worlddash-redis | healthy |
| api | worlddash-api | running |
| worker | worlddash-worker | running |
| llm-worker | worlddash-llm-worker | running |
| beat | worlddash-beat | running |
| web | worlddash-web | running |

## Step 3: Seed Feed Sources

```powershell
docker compose exec api python scripts/seed.py
```

This adds 15 RSS feed sources (defense, geopolitics, security outlets).

## Step 4: Open the Dashboard

| URL | Description |
|-----|-------------|
| http://localhost:3000 | **Dashboard** — main interface |
| http://localhost:3000/settings | **Settings** — manage sources + Ollama config |
| http://localhost:8000/docs | **API docs** — interactive Swagger UI |
| http://localhost:8000/health | **Health check** — verify API status |

## Step 5: Verify It's Working

### Check worker activity

```powershell
docker compose logs -f worker
```

The beat scheduler triggers ingestion every 5 minutes. After the first cycle, you'll see events in the dashboard.

### Don't want to wait? Trigger ingestion now

```powershell
curl -X POST http://localhost:8000/sources/ingest-all
```

Or use the script:
```powershell
.\scripts\trigger-ingestion.ps1
```

Events will appear in the dashboard within 1–2 minutes.

### Check the API

```powershell
# List sources
curl http://localhost:8000/sources

# List events (empty until first ingestion completes)
curl "http://localhost:8000/events?limit=10"

# Check analysis summary
curl http://localhost:8000/analysis/summary
```

## Step 6: Configure LLM (Optional)

If Ollama is running locally, enable LLM enrichment:

**Option A** — Settings page:
1. Open http://localhost:3000/settings
2. Switch to the **Ollama** tab
3. Set endpoint to `http://host.docker.internal:11434`
4. Select a model (e.g. `llama3.2`)
5. Toggle enabled and save

**Option B** — API call:
```powershell
curl -X PUT "http://localhost:8000/llm/config" `
  -H "Content-Type: application/json" `
  -d '{"endpoint": "http://host.docker.internal:11434", "model": "llama3.2", "timeout": 120, "enabled": true}'
```

LLM enrichment adds categories, actors, themes, and significance to each event. The `llm-worker` processes events one at a time to avoid overloading Ollama.

## What to Expect

### First 5 minutes
- Services start and initialize
- Database schema created automatically
- 15 RSS sources configured (after seeding)
- Waiting for first poll cycle

### After 5–10 minutes
- First ingestion completes — 10–50 events appear
- Events show in the network graph and event feed
- Normalization adds tags, entities, locations
- Alerts may be generated for high-risk events

### After 30 minutes (with LLM enabled)
- Events enriched with LLM categories, actors, themes
- Network graph shows meaningful clusters
- Compare mode available for cross-event analysis
- Analysis summary ring shows LLM scan progress

## Common Commands

```powershell
# View all logs
docker compose logs -f

# View specific service
docker compose logs -f llm-worker

# Restart all services
docker compose restart

# Rebuild after code changes
.\rebuild.ps1

# Rebuild specific service
.\rebuild.ps1 -Services api

# Stop all services
docker compose down

# Stop and remove all data (DESTRUCTIVE)
docker compose down -v
```

## Troubleshooting

### Services won't start
```powershell
docker info                     # Is Docker running?
docker compose logs             # Check errors
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Database errors
```powershell
docker compose logs postgres
docker compose restart postgres
Start-Sleep 10
```

### No events appearing
```powershell
docker compose logs -f worker       # Check for ingestion activity
curl http://localhost:8000/sources   # Verify sources exist
curl -X POST http://localhost:8000/sources/ingest-all  # Trigger manually
```

### Frontend not loading
```powershell
curl http://localhost:8000/health    # API reachable?
docker compose logs web             # Frontend errors?
docker compose restart web
```

### LLM not enriching events
```powershell
curl http://localhost:8000/llm/health   # Ollama reachable?
docker compose ps llm-worker           # Worker running?
docker compose logs -f llm-worker      # Check logs
curl http://localhost:8000/llm/config   # Config correct?
```

## Next Steps

1. **Explore the network graph** — click events, Ctrl+click to compare, try different groupings
2. **Add more sources** — use the Settings page or API
3. **Configure LLM** — enable Ollama for deeper enrichment
4. **Read the docs**:
   - [README.md](README.md) — project overview
   - [ARCHITECTURE.md](ARCHITECTURE.md) — system design and data model
   - [DEVELOPMENT.md](DEVELOPMENT.md) — development workflow and debugging
