"""
Main FastAPI application.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from prometheus_client import Counter, Histogram, generate_latest
from sqlalchemy.orm import Session
from starlette.responses import Response
import httpx

from packages.shared.config import get_settings
from packages.shared.logging import configure_logging, get_logger
from packages.shared.schemas import (
    AlertRead,
    EventRead,
    EventSeverity,
    EventStatus,
    HealthCheck,
    SourceCreate,
    SourceRead,
)
from packages.storage.database import get_db_session

__version__ = "0.1.0"

# Metrics
REQUEST_COUNT = Counter("api_requests_total", "Total API requests", ["method", "endpoint", "status"])
REQUEST_DURATION = Histogram("api_request_duration_seconds", "Request duration", ["method", "endpoint"])

settings = get_settings()
configure_logging("api", settings.api.log_level)
logger = get_logger(__name__)


class SourceUpdate(BaseModel):
    """Schema for partially updating a source."""

    name: Optional[str] = None
    url: Optional[str] = None
    type: Optional[str] = None
    enabled: Optional[bool] = None
    tags: Optional[List[str]] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown."""
    logger.info("api_starting", version=__version__)
    yield
    logger.info("api_shutting_down")


app = FastAPI(
    title="World Dash API",
    description="Geopolitical Intelligence Dashboard API",
    version=__version__,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health endpoint
@app.get("/health", response_model=HealthCheck)
async def health_check():
    """Health check endpoint."""
    from packages.storage.database import get_db_manager

    dependencies = {}

    # Check database
    try:
        db_manager = get_db_manager()
        with db_manager.get_session() as session:
            from sqlalchemy import text
            session.execute(text("SELECT 1"))
        dependencies["database"] = "healthy"
    except Exception as e:
        logger.error("health_check_db_failed", error=str(e))
        dependencies["database"] = "unhealthy"

    # Check Redis
    try:
        import redis
        r = redis.Redis(host=settings.redis.host, port=settings.redis.port, db=settings.redis.db)
        r.ping()
        dependencies["redis"] = "healthy"
    except Exception as e:
        logger.error("health_check_redis_failed", error=str(e))
        dependencies["redis"] = "unhealthy"

    overall_status = "healthy" if all(v == "healthy" for v in dependencies.values()) else "degraded"

    return HealthCheck(
        status=overall_status,
        service="api",
        version=__version__,
        dependencies=dependencies,
    )


# Metrics endpoint
@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint."""
    return Response(generate_latest(), media_type="text/plain")


# LLM/Ollama endpoints
class OllamaHealthResponse(BaseModel):
    """Response for Ollama health check."""
    status: str
    endpoint: str
    model: str
    message: str
    enabled: bool = True


class OllamaConfigResponse(BaseModel):
    """Response for Ollama configuration."""
    endpoint: str
    model: str
    timeout_seconds: int
    enabled: bool


class OllamaConfigUpdate(BaseModel):
    """Request to update Ollama configuration."""
    endpoint: Optional[str] = None
    model: Optional[str] = None
    timeout_seconds: Optional[int] = None
    enabled: Optional[bool] = None


@app.get("/llm/health", response_model=OllamaHealthResponse)
async def llm_health():
    """Check Ollama/LLM service status."""
    from packages.ai.llm_service import get_llama_service

    llama = get_llama_service()
    health = await llama.check_health()

    model_found = health.get("model_found", False)
    available = health.get("available_models", [])
    error = health.get("error")

    if error:
        message = f"✗ Connection failed: {error}"
    elif model_found:
        message = f"✓ Connected. Models: {', '.join(available[:3])}"
    else:
        message = f"✗ Connected but '{llama.model}' not found. Available: {', '.join(available[:3])}"

    return OllamaHealthResponse(
        status=health["status"],
        endpoint=health["endpoint"],
        model=health["model"],
        message=message,
        enabled=health.get("enabled", True),
    )


@app.get("/llm/config", response_model=OllamaConfigResponse)
async def get_llm_config():
    """Get current Ollama/LLM configuration (runtime overrides from Redis > env)."""
    from packages.ai.llm_service import get_runtime_llm_config

    cfg = get_runtime_llm_config()
    return OllamaConfigResponse(
        endpoint=cfg["endpoint"],
        model=cfg["model"],
        timeout_seconds=cfg["timeout_seconds"],
        enabled=cfg["enabled"],
    )


@app.put("/llm/config", response_model=OllamaConfigResponse)
async def update_llm_config(body: OllamaConfigUpdate):
    """
    Update Ollama/LLM configuration at runtime.
    Changes are stored in Redis and take effect on the next task/request
    — no container restart needed.
    """
    from packages.ai.llm_service import set_runtime_llm_config

    cfg = set_runtime_llm_config(
        endpoint=body.endpoint,
        model=body.model,
        timeout_seconds=body.timeout_seconds,
        enabled=body.enabled,
    )
    logger.info(
        "llm_config_updated",
        model=cfg["model"],
        endpoint=cfg["endpoint"],
        enabled=cfg["enabled"],
    )
    return OllamaConfigResponse(**cfg)


class OllamaModelInfo(BaseModel):
    name: str
    size: Optional[str] = None
    modified_at: Optional[str] = None


class OllamaModelsResponse(BaseModel):
    models: List[OllamaModelInfo]
    endpoint: str


@app.get("/llm/models", response_model=OllamaModelsResponse)
async def list_llm_models():
    """
    List all models available on the Ollama server.
    Proxied through the API so the browser never needs direct Ollama access.
    """
    from packages.ai.llm_service import get_runtime_llm_config

    cfg = get_runtime_llm_config()
    endpoint = cfg["endpoint"]

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{endpoint}/api/tags")
            response.raise_for_status()
            data = response.json()
            models = [
                OllamaModelInfo(
                    name=m.get("name", "unknown"),
                    size=_format_bytes(m.get("size", 0)),
                    modified_at=m.get("modified_at"),
                )
                for m in data.get("models", [])
            ]
            return OllamaModelsResponse(models=models, endpoint=endpoint)
    except Exception as e:
        logger.warning("list_models_failed", error=str(e))
        return OllamaModelsResponse(models=[], endpoint=endpoint)


def _format_bytes(n: int) -> str:
    """Human-readable byte size."""
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


# Sources endpoints
@app.post("/sources", response_model=SourceRead, status_code=201)
async def create_source(
    source: SourceCreate,
    session: Session = Depends(get_db_session),
):
    """Create a new feed source."""
    from packages.storage.repositories import SourceRepository

    repo = SourceRepository(session)

    # Check for duplicate URL
    existing = repo.get_by_url(source.url)
    if existing:
        raise HTTPException(status_code=409, detail="Source with this URL already exists")

    created = repo.create(source)
    logger.info("source_created_via_api", source_id=str(created.id), name=created.name)
    return created


@app.get("/sources", response_model=List[SourceRead])
async def list_sources(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    enabled_only: bool = Query(default=False),
    session: Session = Depends(get_db_session),
):
    """List feed sources."""
    from packages.storage.repositories import SourceRepository

    repo = SourceRepository(session)

    if enabled_only:
        sources = repo.list_enabled()
    else:
        sources = repo.list_all(limit=limit, offset=offset)

    return sources


@app.get("/sources/{source_id}", response_model=SourceRead)
async def get_source(
    source_id: UUID,
    session: Session = Depends(get_db_session),
):
    """Get source by ID."""
    from packages.storage.repositories import SourceRepository

    repo = SourceRepository(session)
    source = repo.get_by_id(source_id)

    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    return source


# Events endpoints
@app.get("/events", response_model=List[EventRead])
async def list_events(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    status: Optional[EventStatus] = Query(default=None),
    severity: Optional[EventSeverity] = Query(default=None),
    since_hours: Optional[int] = Query(default=None, description="Events from last N hours"),
    session: Session = Depends(get_db_session),
):
    """List events with filters."""
    from packages.storage.repositories import EventRepository

    repo = EventRepository(session)

    since = None
    if since_hours:
        since = datetime.utcnow() - timedelta(hours=since_hours)

    events = repo.list_recent(
        limit=limit,
        offset=offset,
        status=status,
        severity=severity,
        since=since,
    )

    return events


@app.get("/events/{event_id}", response_model=EventRead)
async def get_event(
    event_id: UUID,
    session: Session = Depends(get_db_session),
):
    """Get event by ID."""
    from packages.storage.repositories import EventRepository

    repo = EventRepository(session)
    event = repo.get_by_id(event_id)

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    return event


@app.get("/events/stats/by-status")
async def get_event_stats(
    session: Session = Depends(get_db_session),
):
    """Get event statistics by status."""
    from packages.storage.repositories import EventRepository

    repo = EventRepository(session)
    stats = repo.count_by_status()

    return {status.value: count for status, count in stats.items()}


@app.get("/analysis/summary")
async def get_analysis_summary(
    session: Session = Depends(get_db_session),
):
    """Return a summary of LLM analysis progress and top insights."""
    from sqlalchemy import func, text
    from packages.storage.models import Event as EventModel

    total = session.query(func.count(EventModel.id)).scalar() or 0
    llm_done = session.query(func.count(EventModel.llm_processed_at)).filter(
        EventModel.llm_processed_at.isnot(None)
    ).scalar() or 0
    with_data = session.execute(text(
        "SELECT COUNT(*) FROM events WHERE array_length(categories, 1) > 0"
    )).scalar() or 0

    # Top categories
    top_categories = session.execute(text(
        "SELECT unnest(categories) AS name, COUNT(*) AS count "
        "FROM events WHERE array_length(categories, 1) > 0 "
        "GROUP BY name ORDER BY count DESC LIMIT 10"
    )).fetchall()

    # Top actors
    top_actors = session.execute(text(
        "SELECT unnest(actors) AS name, COUNT(*) AS count "
        "FROM events WHERE array_length(actors, 1) > 0 "
        "GROUP BY name ORDER BY count DESC LIMIT 10"
    )).fetchall()

    # Significance distribution
    sig_dist = session.execute(text(
        "SELECT llm_significance AS level, COUNT(*) AS count "
        "FROM events WHERE llm_significance IS NOT NULL "
        "GROUP BY llm_significance ORDER BY count DESC"
    )).fetchall()

    # Top themes
    top_themes = session.execute(text(
        "SELECT unnest(themes) AS name, COUNT(*) AS count "
        "FROM events WHERE array_length(themes, 1) > 0 "
        "GROUP BY name ORDER BY count DESC LIMIT 8"
    )).fetchall()

    return {
        "total_events": total,
        "llm_processed": llm_done,
        "with_enrichment": with_data,
        "top_categories": [{"name": r[0], "count": r[1]} for r in top_categories],
        "top_actors": [{"name": r[0], "count": r[1]} for r in top_actors],
        "top_themes": [{"name": r[0], "count": r[1]} for r in top_themes],
        "significance_distribution": [{"level": r[0], "count": r[1]} for r in sig_dist],
    }


# Event context analysis endpoint
class EventContextResponse(BaseModel):
    """Response model for event context analysis."""

    event_id: UUID
    categories: List[str]
    actors: List[str]
    locations: List[str]
    themes: List[str]
    significance: str
    related_event_ids: List[str]


@app.post("/events/{event_id}/analyze-context", response_model=EventContextResponse)
async def analyze_event_context(
    event_id: UUID,
    session: Session = Depends(get_db_session),
):
    """
    Analyze an event's context. Uses stored LLM data if available (RAG approach),
    otherwise falls back to on-demand LLM analysis or tag-based extraction.
    
    Finds related events by querying shared categories/actors in the DB
    instead of loading all events.
    """
    try:
        from packages.storage.repositories import EventRepository
        from packages.ai.llm_service import get_llama_service

        repo = EventRepository(session)
        event = repo.get_by_id(event_id)

        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        # Step 1: Get semantic context (prefer stored LLM data)
        has_stored_llm = bool(event.categories or event.actors or event.themes)

        if has_stored_llm:
            # RAG: Use pre-computed LLM data
            context = {
                "categories": event.categories,
                "actors": event.actors,
                "locations": [event.location.country] if event.location and event.location.country else [],
                "themes": event.themes,
                "significance": event.llm_significance or event.severity or "medium",
            }
            logger.info("using_stored_llm_context", event_id=str(event_id))
        else:
            # Fallback: Try on-demand LLM analysis
            llama = get_llama_service()
            context = await llama.extract_event_context(
                title=event.title,
                description=event.description,
            )

            # If LLM returned data, persist it for future use
            if context["categories"]:
                repo.update_llm_data(
                    event_id=event_id,
                    categories=context["categories"],
                    actors=context["actors"],
                    themes=context["themes"],
                    llm_significance=context["significance"],
                )
                session.commit()
                logger.info("llm_context_computed_and_stored", event_id=str(event_id))
            else:
                # Final fallback: generate from event tags/entities
                context = {
                    "categories": event.tags[:3] if event.tags else ["analysis"],
                    "actors": [e.text for e in event.entities if e.type in ["PERSON", "ORG", "GPE"]][:2] or ["Unknown"],
                    "locations": [event.location.country] if event.location and event.location.country else ["Global"],
                    "themes": event.tags[:2] if event.tags else ["Geopolitical"],
                    "significance": event.severity or "medium",
                }
                logger.info("using_fallback_context", event_id=str(event_id))

        # Step 2: Find related events via DB queries (RAG - not 1000-event load)
        related_ids = []

        # Query by shared categories
        if context["categories"]:
            cat_related = repo.list_by_categories(
                categories=context["categories"],
                limit=10,
                exclude_id=event_id,
            )
            related_ids.extend([str(e.id) for e in cat_related])

        # Query by shared actors
        if context["actors"] and context["actors"] != ["Unknown"]:
            actor_related = repo.list_by_actors(
                actors=context["actors"],
                limit=10,
                exclude_id=event_id,
            )
            related_ids.extend([str(e.id) for e in actor_related])

        # Deduplicate
        related_ids = list(dict.fromkeys(related_ids))[:15]

        # If no DB matches found, fallback to tag/location similarity
        if not related_ids:
            all_recent = repo.list_recent(limit=50)
            event_tags = set(t.lower() for t in event.tags)
            for other in all_recent:
                if other.id == event_id:
                    continue
                other_tags = set(t.lower() for t in other.tags)
                if event_tags & other_tags or (
                    event.location and other.location and
                    event.location.country == other.location.country
                ):
                    related_ids.append(str(other.id))
                if len(related_ids) >= 10:
                    break

        logger.info(
            "event_context_analyzed",
            event_id=str(event_id),
            categories_count=len(context["categories"]),
            related_count=len(related_ids),
            source="stored" if has_stored_llm else "computed",
        )

        return EventContextResponse(
            event_id=event_id,
            categories=context["categories"],
            actors=context["actors"],
            locations=context["locations"],
            themes=context["themes"],
            significance=context["significance"],
            related_event_ids=related_ids,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("event_context_analysis_failed", error=str(e), event_id=str(event_id))
        raise HTTPException(status_code=500, detail=f"Failed to analyze event: {str(e)}")


# Alerts endpoints
@app.get("/alerts", response_model=List[AlertRead])
async def list_alerts(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    acknowledged: Optional[bool] = Query(default=None),
    severity: Optional[EventSeverity] = Query(default=None),
    session: Session = Depends(get_db_session),
):
    """List alerts with filters."""
    from packages.storage.repositories import AlertRepository

    repo = AlertRepository(session)
    alerts = repo.list_recent(
        limit=limit,
        offset=offset,
        acknowledged=acknowledged,
        severity=severity,
    )

    return alerts


@app.patch("/sources/{source_id}", response_model=SourceRead)
async def update_source(
    source_id: UUID,
    source_update: SourceUpdate,
    session: Session = Depends(get_db_session),
):
    """Update an existing source."""
    from packages.storage.models import Source

    existing_source = session.query(Source).filter(Source.id == source_id).first()

    if not existing_source:
        raise HTTPException(status_code=404, detail="Source not found")

    # Update fields
    for field, value in source_update.model_dump(exclude_unset=True).items():
        setattr(existing_source, field, value)

    session.commit()
    session.refresh(existing_source)

    logger.info("source_updated", source_id=str(source_id))
    return SourceRead.model_validate(existing_source)


@app.delete("/sources/{source_id}", status_code=204)
async def delete_source(
    source_id: UUID,
    session: Session = Depends(get_db_session),
):
    """Delete a source and its events."""
    from packages.storage.models import Source

    existing_source = session.query(Source).filter(Source.id == source_id).first()

    if not existing_source:
        raise HTTPException(status_code=404, detail="Source not found")

    session.delete(existing_source)
    session.commit()

    logger.info("source_deleted", source_id=str(source_id))


@app.post("/sources/ingest-all")
async def ingest_all_sources(
    session: Session = Depends(get_db_session),
):
    """Trigger ingestion for all active sources."""
    from celery import Celery
    from packages.storage.repositories import SourceRepository

    repo = SourceRepository(session)
    sources = repo.list_enabled()

    celery_client = Celery(
        "worlddash-api-dispatcher",
        broker=settings.celery.broker_url,
        backend=settings.celery.result_backend,
    )

    task_ids = []
    for source in sources:
        result = celery_client.send_task(
            "apps.worker.tasks.ingest_source_task",
            args=[str(source.id)],
        )
        task_ids.append(result.id)

    logger.info("triggered_all_ingestion", source_count=len(sources))
    return {"message": f"Triggered ingestion for {len(sources)} sources", "task_ids": task_ids}


@app.get("/alerts/{alert_id}", response_model=AlertRead)
async def get_alert(
    alert_id: UUID,
    session: Session = Depends(get_db_session),
):
    """Get alert by ID."""
    from packages.storage.repositories import AlertRepository

    repo = AlertRepository(session)
    alert = repo.get_by_id(alert_id)

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    return alert


@app.post("/alerts/{alert_id}/acknowledge", response_model=AlertRead)
async def acknowledge_alert(
    alert_id: UUID,
    session: Session = Depends(get_db_session),
):
    """Mark alert as acknowledged."""
    from packages.storage.repositories import AlertRepository

    repo = AlertRepository(session)
    alert = repo.get_by_id(alert_id)

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    repo.acknowledge(alert_id)
    session.commit()

    logger.info("alert_acknowledged", alert_id=str(alert_id))
    return repo.get_by_id(alert_id)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.api.host,
        port=settings.api.port,
        reload=settings.api.reload,
        log_level=settings.api.log_level.lower(),
    )
