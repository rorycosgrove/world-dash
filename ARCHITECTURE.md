# World Dash - Architecture Decision Records

## ADR-001: Modular Monolith over Microservices

**Date**: 2026-03-01  
**Status**: Accepted

### Context
Need to build a scalable system but want to avoid premature microservices complexity.

### Decision
Use modular monolith with clear package boundaries. Each module (ingestion, normalization, intelligence) is independently replaceable.

### Consequences
- Faster initial development
- Easier debugging and testing
- Can extract to microservices later when needed
- Must maintain strict module boundaries

---

## ADR-002: Repository Pattern for Data Access

**Date**: 2026-03-01  
**Status**: Accepted

### Context
Need clean abstraction over SQLAlchemy to enable testing and future database changes.

### Decision
Implement repository pattern with dedicated repository classes per entity type.

### Consequences
- Business logic decoupled from database
- Easy to mock for testing
- Can swap database implementations
- Slight overhead of additional layer

---

## ADR-003: Celery for Task Queue

**Date**: 2026-03-01  
**Status**: Accepted

### Context
Need async task processing for feed ingestion and event processing.

### Decision
Use Celery with Redis broker (can migrate to Kafka later).

### Consequences
- Well-established Python task queue
- Supports scheduling (Celery Beat)
- Easy to scale workers
- Redis dependency (acceptable for MVP)

---

## ADR-004: Pydantic for Validation

**Date**: 2026-03-01  
**Status**: Accepted

### Context
Need data validation and serialization across API and internal modules.

### Decision
Use Pydantic v2 for all schemas and validation.

### Consequences
- Type-safe validation
- Auto-generated OpenAPI docs
- Excellent performance
- Standard in FastAPI ecosystem

---

## ADR-005: PostGIS for Geospatial Data

**Date**: 2026-03-01  
**Status**: Accepted

### Context
Need efficient geospatial queries for location-based event filtering.

### Decision
Use PostgreSQL with PostGIS extension.

### Consequences
- Powerful spatial queries
- Standard geospatial data types
- Excellent performance with spatial indexes
- Mature ecosystem

---

## ADR-006: Next.js for Frontend

**Date**: 2026-03-01  
**Status**: Accepted

### Context
Need modern, fast frontend with SSR capabilities.

### Decision
Use Next.js 14 with TypeScript and Tailwind CSS.

### Consequences
- Great developer experience
- SSR/SSG options for performance
- Built-in routing
- Large ecosystem

---

## ADR-007: Mapbox GL for Mapping

**Date**: 2026-03-01  
**Status**: Accepted

### Context
Need high-performance interactive maps with custom styling.

### Decision
Use Mapbox GL JS (with Leaflet as potential alternative).

### Consequences
- Beautiful, customizable maps
- WebGL-based performance
- Requires API key (free tier available)
- Can swap for Leaflet if needed

---

## ADR-008: Structured Logging with structlog

**Date**: 2026-03-01  
**Status**: Accepted

### Context
Need consistent, parseable logs for observability.

### Decision
Use structlog for JSON-formatted structured logging.

### Consequences
- Easy to parse and query logs
- Consistent format across services
- Context propagation
- ELK/Loki compatible

---

## Future Decisions to Make

- ADR-009: ML Framework Selection (Phase 3)
- ADR-010: Event Streaming Platform (Phase 5 - Kafka)
- ADR-011: Search Engine (Phase 5 - OpenSearch)
- ADR-012: Authentication Strategy (Phase 2)
- ADR-013: Caching Strategy (Phase 2)
