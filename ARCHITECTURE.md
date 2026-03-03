# World Dash — Architecture

This document describes the system architecture, key design decisions, data flow, and component responsibilities.

---

## System Overview

World Dash is a **modular monolith** deployed as 7 Docker services. The backend is Python (FastAPI + Celery), the frontend is Next.js 14, and the system uses PostgreSQL/PostGIS for storage and Redis for messaging, caching, and runtime configuration.

```
                    ┌────────────┐
                    │   Browser  │
                    └─────┬──────┘
                          │ HTTP :3000
                    ┌─────▼──────┐       ┌──────────────┐
                    │    web     │──────►│    api       │ :8000
                    │ (Next.js)  │ fetch │  (FastAPI)   │
                    └────────────┘       └──┬───┬───┬───┘
                                            │   │   │
                          ┌─────────────────┘   │   └─────────────────┐
                          ▼                     ▼                     ▼
                    ┌───────────┐        ┌───────────┐        ┌───────────┐
                    │  worker   │        │llm-worker │        │   beat    │
                    │(default Q)│        │ (llm Q)   │        │(scheduler)│
                    └─────┬─────┘        └─────┬─────┘        └───────────┘
                          │                    │
                          ▼                    ▼
                    ┌───────────┐        ┌───────────┐
                    │ postgres  │        │  Ollama   │ (external)
                    │ (PostGIS) │        │  LLM API  │
                    └───────────┘        └───────────┘
                    ┌───────────┐
                    │   redis   │ (broker + config)
                    └───────────┘
```

---

## Architecture Decision Records

### ADR-001: Modular Monolith over Microservices

**Status**: Accepted

All business logic lives in `packages/` with strict module boundaries. Each module (ingestion, normalization, intelligence, AI) is independently replaceable. This avoids premature distributed systems complexity while retaining the option to extract microservices later.

### ADR-002: Repository Pattern for Data Access

**Status**: Accepted

`packages/storage/repositories.py` implements the repository pattern over SQLAlchemy. Business logic in workers and API endpoints never touches ORM models directly — they work through repositories that return Pydantic schemas.

### ADR-003: Dual Celery Workers with Queue Isolation

**Status**: Accepted

Two separate Celery worker processes:
- **worker** — handles fast tasks (ingestion, normalization, analysis) on the `default` queue with concurrency=4
- **llm-worker** — handles slow Ollama LLM calls on the `llm` queue with concurrency=1

This prevents slow LLM tasks from blocking the fast ingestion pipeline.

### ADR-004: Auto-chained Task Pipeline

**Status**: Accepted

Tasks auto-chain via `.delay()` calls at the end of each step:
```
ingest_source_task → normalize_event_task → llm_categorize_event_task → analyze_event_task
```

This ensures every ingested event is fully enriched without manual intervention or separate orchestration.

### ADR-005: Runtime LLM Configuration via Redis

**Status**: Accepted

LLM settings (endpoint, model, timeout, enabled) are stored in Redis under `worlddash:llm_config:*` keys. The API's `/llm/config` endpoint writes to Redis, and workers read from Redis on every task execution. This allows reconfiguring the LLM without restarting any services.

### ADR-006: PostGIS for Geospatial Data

**Status**: Accepted

PostgreSQL with PostGIS extension provides efficient spatial queries. Events store both a JSONB `location` field (country, region, city, confidence) and a PostGIS `POINT` geometry with SRID 4326 for geospatial indexing.

### ADR-007: Zustand for Frontend State

**Status**: Accepted

Zustand provides lightweight global state management. The `dashboard.ts` store holds events, alerts, selected event, filters, and auto-refresh toggle — accessible by all components without prop drilling.

### ADR-008: SVG-based Network Visualization

**Status**: Accepted

The `EventNetworkMap` component renders an SVG-based force-directed graph rather than using a mapping library. This provides full control over node layout, grouping, interaction (pan/zoom/hover/select), and avoids external API key dependencies.

### ADR-009: Structured Logging with structlog

**Status**: Accepted

All Python services use structlog for JSON-formatted structured logging. This provides consistent, parseable logs with context propagation, compatible with ELK/Loki aggregation.

---

## Data Flow

### Ingestion → Visualization Pipeline

```
1. beat                    schedules ingest_all_sources_task every 5 min
2. worker                  ingest_all_sources_task dispatches per-source tasks
3. worker                  ingest_source_task fetches RSS, deduplicates, stores events
4. worker                  normalize_event_task extracts locations, entities, tags, severity
5. llm-worker              llm_categorize_event_task calls Ollama for categories/actors/themes
6. worker                  analyze_event_task runs intelligence engine, generates alerts
7. api                     frontend polls /events, /alerts, /analysis/summary
8. web                     EventNetworkMap renders enriched events as interactive graph
```

### API → Frontend Data Flow

```
web (Zustand store)
  ├─ polls GET /events          → EventFeed, EventNetworkMap
  ├─ polls GET /alerts          → AlertPanel
  ├─ polls GET /analysis/summary → AnalysisSummary (progress ring)
  ├─ GET /events/{id}/analyze-context → EventNetworkMap (context mode)
  └─ Settings page
       ├─ GET/PUT /llm/config   → Ollama configuration
       ├─ GET /llm/models       → Model selection dropdown
       └─ CRUD /sources         → Feed source management
```

---

## Data Model

### Source (`sources` table)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Primary key |
| name | String | Display name |
| url | String (unique) | RSS/Atom feed URL |
| type | Enum (rss, atom, api) | Source type |
| enabled | Boolean | Whether to poll |
| tags | String[] | Classification tags |
| last_polled_at | DateTime | Last poll timestamp |
| last_success_at | DateTime | Last successful poll |
| last_error | String | Most recent error message |
| error_count | Integer | Consecutive error count |
| total_events | Integer | Lifetime events ingested |

### Event (`events` table)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Primary key |
| source_id | UUID (FK) | Owning source |
| title | String | Event headline |
| description | Text | Event body |
| url | String | Original article URL |
| content_hash | String (unique) | SHA-256 for deduplication |
| raw_content | Text | Original feed content |
| status | Enum | raw, normalized, enriched, processed, failed |
| severity | Enum | low, medium, high, critical |
| risk_score | Float | 0.0–1.0 heuristic score |
| tags | String[] | Auto-assigned tags |
| entities | JSONB | Extracted entities |
| location | JSONB | Country/region/city/confidence |
| location_point | PostGIS POINT | Geospatial coordinates (SRID 4326) |
| **categories** | String[] | LLM-extracted categories |
| **actors** | String[] | LLM-extracted actors |
| **themes** | String[] | LLM-extracted themes |
| **llm_significance** | String | LLM-assessed significance |
| **llm_processed_at** | DateTime | When LLM processing completed |
| published_at | DateTime | Original publication time |
| created_at | DateTime | Ingestion timestamp |

### Alert (`alerts` table)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Primary key |
| event_id | UUID (FK) | Triggering event |
| title | String | Alert headline |
| description | Text | Alert details |
| severity | Enum | low, medium, high, critical |
| acknowledged | Boolean | Whether operator acknowledged |
| created_at | DateTime | Alert creation time |

---

## Frontend Components

| Component | Responsibility |
|-----------|---------------|
| `page.tsx` | 3-column dashboard layout (feed / main / debug) |
| `layout.tsx` | Root layout with navigation bar |
| `settings/page.tsx` | Sources management + Ollama configuration tabs |
| `EventNetworkMap.tsx` | Interactive SVG network graph (overview/context/compare modes, pan/zoom, hover, multi-select) |
| `EventFeed.tsx` | Live event list with auto-refresh, severity indicators, LLM debug logging |
| `AnalysisSummary.tsx` | Top bar with LLM scan progress ring and key insights |
| `FilterBar.tsx` | Severity filter buttons |
| `AlertPanel.tsx` | Alert list with acknowledge action |
| `DebugLog.tsx` | Console-style debug panel with LLM processing pattern detection |

---

## Module Responsibilities

| Package | Responsibility |
|---------|---------------|
| `packages/ai/` | Ollama HTTP client, runtime Redis config, sync+async interfaces |
| `packages/feed_ingestion/` | RSS/Atom parsing, content-hash deduplication |
| `packages/event_normalizer/` | Location/entity/tag extraction, severity/risk scoring |
| `packages/intelligence_engine/` | Rule-based alert triggers, event clustering |
| `packages/storage/` | SQLAlchemy models, repository pattern, session management |
| `packages/shared/` | Pydantic settings, structured logging, common schemas, utilities |

---

## Infrastructure

### Docker Services

All services are defined in `docker/docker-compose.yml` with a local override in `docker/docker-compose.local.yml`. Dockerfiles live at the project root.

| Dockerfile | Service | Base |
|-----------|---------|------|
| `Dockerfile.api` | api | python:3.12-slim |
| `Dockerfile.worker` | worker | python:3.12-slim |
| `Dockerfile.llm-worker` | llm-worker | python:3.12-slim |
| `Dockerfile.beat` | beat | python:3.12-slim |
| `Dockerfile.web` | web | node:20 |
| `Dockerfile.postgres` | postgres | pgvector/pgvector:pg16 + PostGIS |

### Database Migrations

Managed by Alembic with version scripts in `alembic/versions/`:
- `001_initial_schema.py` — Sources, Events, Alerts tables with PostGIS
- `002_add_llm_columns.py` — categories, actors, themes, llm_significance, llm_processed_at
- `003_add_source_auth.py` — auth_header and auth_token on sources
- `004_add_pgvector_embeddings.py` — pgvector extension and embedding columns on events
- `005_add_clusters_and_chat.py` — clusters, cluster_events, chat_messages tables

### Volumes

| Volume | Purpose |
|--------|---------|
| `postgres_data` | Persistent database storage |
| `redis_data` | Redis persistence |

### Network

Single Docker bridge network `worlddash` connecting all services.
