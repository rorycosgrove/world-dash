# 🌍 World Dash — Geopolitical Intelligence Dashboard

A real-time world events monitoring and intelligence platform that ingests RSS/OSINT feeds, enriches events with LLM-powered analysis, detects significant geopolitical signals, and visualizes relationships through an interactive network graph.

## Overview

World Dash is a modular full-stack application that automatically:

1. **Ingests** RSS/Atom feeds on a configurable schedule
2. **Normalizes** events — extracting locations, entities, tags, severity, and risk scores
3. **Enriches** events via Ollama LLM — extracting categories, actors, themes, and significance
4. **Analyzes** events through an intelligence engine that generates alerts
5. **Visualizes** the enriched data in an interactive network graph with multi-event comparison

The entire pipeline runs automatically end-to-end. No manual steps are required after initial setup.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js 14)                    │
│  EventFeed │ AnalysisSummary │ FilterBar │ EventNetworkMap   │
│  DebugLog  │ Settings (/settings) │ Zustand store            │
└─────────────────────────┬────────────────────────────────────┘
                          │ REST API (polling)
┌─────────────────────────▼────────────────────────────────────┐
│                    API LAYER (FastAPI)                        │
│  /events  /alerts  /sources  /llm  /analysis  /health       │
└─────────┬──────────────────────────────────────┬─────────────┘
          │ Celery tasks                         │ LLM proxy
┌─────────▼────────────────────────┐   ┌────────▼────────────┐
│  WORKER SERVICES (Celery)        │   │  Ollama (external)   │
│  ┌─────────┐ ┌─────────────────┐ │   │  LLM categorization  │
│  │ worker   │ │ llm-worker     │ │   │  Hot-reload config   │
│  │ (fast)   │ │ (concurrency=1)│ │   └──────────────────────┘
│  │ default Q │ │ llm queue     │ │
│  └─────────┘ └─────────────────┘ │
│  ┌─────────┐                     │
│  │  beat    │ (scheduler, 5 min) │
│  └─────────┘                     │
└─────────┬────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────┐
│                     STORAGE LAYER                             │
│  PostgreSQL 16 + PostGIS  │  Redis 7 (broker + cache + cfg)  │
│  Repository Pattern       │  Runtime LLM config in Redis     │
└──────────────────────────────────────────────────────────────┘
```

### Task Pipeline

Every feed poll triggers a fully automated chain:

```
ingest_source_task  →  normalize_event_task  →  llm_categorize_event_task  →  analyze_event_task
   (default queue)       (default queue)            (llm queue)                (default queue)
```

Each step auto-chains to the next via `task.delay()`. No manual intervention required.

## Services

| Service | Container | Description | Port |
|---------|-----------|-------------|------|
| **postgres** | worlddash-postgres | PostGIS 16 — events, sources, alerts | 5432 |
| **redis** | worlddash-redis | Celery broker (db 1), results (db 2), LLM config | 6379 |
| **api** | worlddash-api | FastAPI REST API | 8000 |
| **worker** | worlddash-worker | Celery worker — ingestion, normalization, analysis | — |
| **llm-worker** | worlddash-llm-worker | Celery worker — Ollama LLM tasks (concurrency=1) | — |
| **beat** | worlddash-beat | Celery Beat scheduler (polls feeds every 5 min) | — |
| **web** | worlddash-web | Next.js 14 frontend dashboard | 3000 |

## Key Features

### Automated Intelligence Pipeline
- RSS/Atom feed ingestion with content-hash deduplication
- Location extraction (country-level via geocoding)
- Entity extraction (military units, weapons, organizations)
- Auto-tagging (military, conflict, diplomatic, cyber, etc.)
- Severity classification (low/medium/high/critical) and risk scoring (0.0–1.0)
- LLM enrichment via Ollama — categories, actors, themes, significance
- Rule-based alert generation (5 predefined rules)

### Interactive Network Visualization
- **Three view modes**: Overview (grouped), Context (single event), Compare (multi-event)
- **Dynamic grouping**: By category, actor, theme, location, or significance
- **Pan & zoom**: Drag to pan, scroll wheel to zoom, fit-to-content button
- **Multi-select**: Ctrl+click to pin events, then compare shared attributes
- **Hover tooltips**: Node details with connected-node highlighting
- **Color-coded nodes**: Events (purple), categories (red), themes (amber), actors (cyan), locations (emerald)

### LLM Integration (Ollama)
- Runtime-configurable endpoint, model, timeout, and enabled flag
- Settings stored in Redis — workers pick up changes without restart
- Settings page at `/settings` for managing Ollama config and feed sources
- Dedicated `llm-worker` with concurrency=1 to prevent Ollama overload
- Automatic retry (max 2 retries, exponential backoff)

### Dashboard Layout
- **Left sidebar**: Event feed with auto-refresh and severity indicators
- **Top bar**: Analysis summary with LLM scan progress ring
- **Center**: Filter bar + interactive network map
- **Right sidebar**: Debug log with LLM processing patterns

### REST API (20 endpoints)
- Events: list, get, stats, context analysis
- Sources: CRUD, bulk ingest trigger
- Alerts: list, get, acknowledge
- LLM: health check, config read/write, model listing
- System: health check, Prometheus metrics

Full API docs available at http://localhost:8000/docs when running.

## Project Structure

```
world-dash/
├── apps/
│   ├── api/                  # FastAPI application
│   │   └── main.py           # 20 REST endpoints
│   ├── worker/               # Celery workers
│   │   ├── celery_app.py     # Celery configuration
│   │   └── tasks.py          # 7 background tasks (auto-chained pipeline)
│   └── web/                  # Next.js 14 frontend
│       └── src/
│           ├── app/
│           │   ├── page.tsx          # Dashboard (3-column layout)
│           │   ├── layout.tsx        # Root layout with nav
│           │   ├── settings/page.tsx # Sources + Ollama config
│           │   └── globals.css       # Tailwind + dark theme
│           ├── components/
│           │   ├── EventNetworkMap.tsx  # Interactive network graph (~920 lines)
│           │   ├── EventFeed.tsx        # Live event list
│           │   ├── AnalysisSummary.tsx  # Progress ring + insights
│           │   ├── FilterBar.tsx        # Severity filter buttons
│           │   ├── AlertPanel.tsx       # Alert list
│           │   ├── DebugLog.tsx         # Debug console with LLM patterns
│           │   └── WorldMap.tsx         # Mapbox GL map (legacy)
│           ├── lib/api.ts              # Axios API client + TypeScript interfaces
│           └── store/dashboard.ts      # Zustand global state
├── packages/
│   ├── ai/                   # LLM integration
│   │   └── llm_service.py    # Ollama client with Redis config
│   ├── feed_ingestion/       # RSS/Atom feed parsing
│   │   ├── parser.py         # Feed parser with deduplication
│   │   └── tasks.py          # Ingestion helpers
│   ├── event_normalizer/     # NLP enrichment
│   │   └── normalizer.py     # Location/entity/tag extraction
│   ├── intelligence_engine/  # Alert generation
│   │   └── engine.py         # Rule-based alerts + clustering
│   ├── storage/              # Data layer
│   │   ├── models.py         # SQLAlchemy models (Source, Event, Alert)
│   │   ├── repositories.py   # Repository pattern
│   │   └── database.py       # Session management
│   └── shared/               # Common utilities
│       ├── config.py         # Pydantic settings
│       ├── logging.py        # Structured JSON logging (structlog)
│       ├── schemas.py        # Pydantic request/response models
│       └── utils.py          # Helper functions
├── infra/                    # Dockerfiles
│   ├── Dockerfile.api
│   ├── Dockerfile.web
│   ├── Dockerfile.worker
│   ├── Dockerfile.llm-worker
│   └── Dockerfile.beat
├── alembic/                  # Database migrations
│   └── versions/
│       ├── 001_initial_schema.py
│       └── 002_add_llm_columns.py
├── tests/                    # Pytest test suite
│   ├── conftest.py           # Fixtures + SQLite shims
│   ├── test_storage.py
│   ├── test_normalizer.py
│   └── test_intelligence.py
├── scripts/
│   ├── seed.py               # Seed 15 RSS sources
│   ├── trigger-ingestion.ps1 # Manual ingestion trigger (Windows)
│   └── trigger-ingestion.sh  # Manual ingestion trigger (Linux/macOS)
├── docker-compose.yml        # Full service orchestration (7 services)
├── rebuild.ps1               # Rebuild + restart services (Windows)
├── pyproject.toml            # Python dependencies
└── requirements.txt          # Pip-compatible requirements
```

## Quick Start

See [QUICKSTART.md](QUICKSTART.md) for a step-by-step guide to get running in 5 minutes.

**TL;DR:**

```powershell
# Clone and configure
Copy-Item .env.example .env    # Edit .env with your passwords

# Start all 7 services
docker compose up -d

# Seed feed sources
docker compose exec api python scripts/seed.py

# Open dashboard
# http://localhost:3000  (dashboard)
# http://localhost:8000/docs  (API docs)
```

Events will begin appearing after the first poll cycle (~5 minutes).

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full development guide including:

- Local (non-Docker) setup for Python + Node.js
- Docker development workflow
- Rebuild script usage
- Testing and code quality
- Common development tasks
- Debugging tips
- Troubleshooting

## Data Model

### Source
Feed source definition (RSS/Atom URL, polling metadata, error tracking).

### Event
Ingested and enriched event with:
- Core fields: title, description, URL, content hash, raw content
- Processing: status, severity, risk score, tags, entities, location (JSONB + PostGIS point)
- **LLM fields**: categories (array), actors (array), themes (array), llm_significance (string), llm_processed_at (datetime)

### Alert
Rule-triggered alert linked to an event with severity and acknowledgment tracking.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Python 3.12, FastAPI, Pydantic v2 |
| Task Queue | Celery 5.3 with Redis broker |
| LLM | Ollama (configurable model, e.g. llama3.2) |
| Database | PostgreSQL 16 + PostGIS + Alembic migrations |
| Cache/Config | Redis 7 (broker + result backend + runtime LLM config) |
| Frontend | Next.js 14, React 18, TypeScript |
| State | Zustand |
| Styling | Tailwind CSS (dark analyst theme) |
| Logging | structlog (JSON) |
| Metrics | Prometheus (`/metrics` endpoint) |
| Containers | Docker Compose (7 services) |

## Security

**Current state** (development/MVP):
- Default credentials in `.env.example` — change for production
- No API authentication
- CORS allows all origins
- HTTP only

**Production checklist:**
- [ ] Change all default passwords
- [ ] Enable API authentication (JWT/OAuth2)
- [ ] Configure CORS whitelist
- [ ] Enable HTTPS/TLS
- [ ] Implement rate limiting
- [ ] Use secrets manager
- [ ] Network isolation

## License

This project is provided as-is for educational and research purposes.
