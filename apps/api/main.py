"""
Main FastAPI application.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Request
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
    ChatMessageCreate,
    ChatMessageRead,
    ChatSessionRead,
    ClusterCreate,
    ClusterDetail,
    ClusterRead,
    EventRead,
    EventSeverity,
    EventStatus,
    HealthCheck,
    SourceCreate,
    SourceRead,
)
from packages.storage.database import get_db_session

__version__ = "0.1.0"


# ---------------------------------------------------------------------------
# Encryption helpers for Redis-stored secrets
# ---------------------------------------------------------------------------

def _get_fernet():
    """Return a Fernet instance if ENCRYPTION_KEY is set, else None."""
    key = settings.api.encryption_key
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception:
        return None


def _encrypt(value: str) -> str:
    """Encrypt a value with Fernet if available, else return as-is."""
    f = _get_fernet()
    if f and value:
        return f.encrypt(value.encode()).decode()
    return value


def _decrypt(value: str) -> str:
    """Decrypt a value with Fernet if available, else return as-is."""
    f = _get_fernet()
    if f and value:
        try:
            return f.decrypt(value.encode()).decode()
        except Exception:
            return value  # not encrypted or wrong key — return as-is
    return value


# ---------------------------------------------------------------------------
# API Key authentication
# ---------------------------------------------------------------------------

async def verify_api_key(
    request: "Request",  # noqa: F821 — imported at module level via Starlette
):
    """
    Optional API-key gate.  If API_SECRET_KEY is empty the check is skipped
    (development mode).  Health and metrics endpoints are always public.
    """
    secret = settings.api.secret_key
    if not secret:
        return  # auth disabled

    # Always allow health/metrics without auth
    if request.url.path in ("/health", "/metrics", "/docs", "/openapi.json", "/redoc"):
        return

    provided = request.headers.get("X-API-Key", "")
    if provided != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

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
    auth_header: Optional[str] = None
    auth_token: Optional[str] = None


class CloudAIConfigResponse(BaseModel):
    """Response for cloud AI configuration."""
    provider: str = "openai"
    api_key: str = ""
    model: str = "gpt-4o-mini"
    endpoint: str = ""
    enabled: bool = False


class CloudAIConfigUpdate(BaseModel):
    """Request to update cloud AI configuration."""
    provider: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    endpoint: Optional[str] = None
    enabled: Optional[bool] = None


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
    dependencies=[Depends(verify_api_key)],
)

# CORS — use ALLOWED_ORIGINS from env (comma-separated), default to localhost:3000
_allowed_origins = [
    o.strip()
    for o in settings.api.allowed_origins.split(",")
    if o.strip()
] or ["http://localhost:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
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
    search: Optional[str] = Query(default=None, description="Text search in title and description"),
    category: Optional[str] = Query(default=None, description="Filter by category (server-side)"),
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
        search=search,
        category=category,
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
    llm_done = session.query(func.count(EventModel.id)).filter(
        EventModel.llm_processed_at.isnot(None)
    ).scalar() or 0
    with_data = session.execute(text(
        "SELECT COUNT(*) FROM events "
        "WHERE array_length(categories, 1) > 0 "
        "   OR array_length(actors, 1) > 0 "
        "   OR array_length(themes, 1) > 0"
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


# ---- Semantic Search ----

class SemanticSearchRequest(BaseModel):
    """Request for semantic search."""
    query: str
    limit: int = 20
    min_similarity: float = 0.5


class SemanticSearchResult(BaseModel):
    """A single semantic search result."""
    event: EventRead
    similarity: float


@app.post("/search/semantic", response_model=List[SemanticSearchResult])
async def semantic_search(
    body: SemanticSearchRequest,
    session: Session = Depends(get_db_session),
):
    """
    Semantic search over events using vector similarity.
    Embeds the query text and finds the most similar events.
    """
    from packages.ai.llm_service import get_llama_service
    from packages.storage.repositories import EventRepository

    llm = get_llama_service()
    embedding = await llm.embed_text(body.query)

    if not embedding:
        raise HTTPException(status_code=503, detail="Embedding service unavailable")

    repo = EventRepository(session)
    results = repo.find_similar(
        embedding=embedding,
        limit=body.limit,
        min_similarity=body.min_similarity,
    )

    return [
        SemanticSearchResult(event=r["event"], similarity=r["similarity"])
        for r in results
    ]


@app.get("/events/{event_id}/similar", response_model=List[SemanticSearchResult])
async def get_similar_events(
    event_id: UUID,
    limit: int = Query(default=10, le=50),
    min_similarity: float = Query(default=0.5, ge=0.0, le=1.0),
    session: Session = Depends(get_db_session),
):
    """Find events semantically similar to a given event."""
    from packages.storage.repositories import EventRepository

    repo = EventRepository(session)
    event = repo.get_by_id(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    results = repo.find_similar_to_event(
        event_id=event_id,
        limit=limit,
        min_similarity=min_similarity,
    )

    return [
        SemanticSearchResult(event=r["event"], similarity=r["similarity"])
        for r in results
    ]


# ---- Clusters ----

class ClusterUpdate(BaseModel):
    """Request to update a cluster."""
    label: Optional[str] = None
    summary: Optional[str] = None
    pinned: Optional[bool] = None


class ClusterAddEvents(BaseModel):
    """Request to add events to a cluster."""
    event_ids: List[UUID]


@app.get("/clusters", response_model=List[ClusterRead])
async def list_clusters(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    pinned_only: bool = Query(default=False),
    session: Session = Depends(get_db_session),
):
    """List topic clusters."""
    from packages.storage.repositories import ClusterRepository

    repo = ClusterRepository(session)
    return repo.list_all(limit=limit, offset=offset, pinned_only=pinned_only)


@app.get("/clusters/{cluster_id}", response_model=ClusterDetail)
async def get_cluster(
    cluster_id: UUID,
    session: Session = Depends(get_db_session),
):
    """Get cluster with its events."""
    from packages.storage.repositories import ClusterRepository

    repo = ClusterRepository(session)
    detail = repo.get_detail(cluster_id)

    if not detail:
        raise HTTPException(status_code=404, detail="Cluster not found")

    return detail


@app.post("/clusters", response_model=ClusterRead, status_code=201)
async def create_cluster(
    cluster: ClusterCreate,
    session: Session = Depends(get_db_session),
):
    """Create a new cluster manually."""
    from packages.storage.repositories import ClusterRepository

    repo = ClusterRepository(session)
    created = repo.create(cluster)
    session.commit()

    # Dispatch embedding of cluster summary for semantic search
    try:
        from apps.worker.tasks import embed_cluster_summary_task
        embed_cluster_summary_task.delay(str(created.id))
    except Exception:
        logger.warning("failed_to_dispatch_cluster_embedding", cluster_id=str(created.id))

    return created


@app.patch("/clusters/{cluster_id}", response_model=ClusterRead)
async def update_cluster(
    cluster_id: UUID,
    body: ClusterUpdate,
    session: Session = Depends(get_db_session),
):
    """Update cluster metadata (label, summary, pinned)."""
    from packages.storage.repositories import ClusterRepository

    repo = ClusterRepository(session)
    updated = repo.update(
        cluster_id=cluster_id,
        label=body.label,
        summary=body.summary,
        pinned=body.pinned,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Cluster not found")

    session.commit()
    return updated


@app.post("/clusters/{cluster_id}/events")
async def add_events_to_cluster(
    cluster_id: UUID,
    body: ClusterAddEvents,
    session: Session = Depends(get_db_session),
):
    """Add events to an existing cluster."""
    from packages.storage.repositories import ClusterRepository

    repo = ClusterRepository(session)
    cluster = repo.get_by_id(cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    added = repo.add_events(cluster_id, body.event_ids)
    session.commit()
    return {"added": added}


@app.delete("/clusters/{cluster_id}/events/{event_id}")
async def remove_event_from_cluster(
    cluster_id: UUID,
    event_id: UUID,
    session: Session = Depends(get_db_session),
):
    """Remove an event from a cluster."""
    from packages.storage.repositories import ClusterRepository

    repo = ClusterRepository(session)
    removed = repo.remove_event(cluster_id, event_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Event not in cluster")

    session.commit()
    return {"removed": True}


@app.delete("/clusters/{cluster_id}", status_code=204)
async def delete_cluster(
    cluster_id: UUID,
    session: Session = Depends(get_db_session),
):
    """Delete a cluster."""
    from packages.storage.repositories import ClusterRepository

    repo = ClusterRepository(session)
    deleted = repo.delete(cluster_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cluster not found")
    session.commit()


@app.post("/clusters/auto-generate")
async def auto_generate_clusters(
    min_cluster_size: int = Query(default=3, ge=2, le=20),
    similarity_threshold: float = Query(default=0.65, ge=0.3, le=0.95),
    session: Session = Depends(get_db_session),
):
    """
    Auto-generate topic clusters from embedded events.
    Replaces existing auto-generated (non-pinned) clusters.
    """
    from packages.storage.models import Event as EventModel
    from packages.storage.repositories import ClusterRepository, EventRepository
    from packages.intelligence_engine.engine import IntelligenceEngine

    # Get all events with embeddings
    events_with_embeddings = (
        session.query(EventModel)
        .filter(EventModel.embedding.isnot(None))
        .all()
    )

    if not events_with_embeddings:
        return {"clusters_created": 0, "message": "No embedded events found"}

    embeddings = [(e.id, list(e.embedding)) for e in events_with_embeddings]

    engine = IntelligenceEngine()
    raw_clusters = engine.auto_generate_clusters(
        embeddings=embeddings,
        min_cluster_size=min_cluster_size,
        similarity_threshold=similarity_threshold,
    )

    if not raw_clusters:
        return {"clusters_created": 0, "message": "No clusters formed at this threshold"}

    # Remove old auto-generated clusters (keep pinned ones)
    cluster_repo = ClusterRepository(session)
    removed = cluster_repo.delete_auto_generated()
    logger.info("old_auto_clusters_removed", count=removed)

    # Create new clusters
    event_repo = EventRepository(session)
    created_clusters = []

    for rc in raw_clusters:
        # Get events for label generation
        events = [event_repo.get_by_id(eid) for eid in rc["event_ids"]]
        events = [e for e in events if e]

        label = engine.generate_cluster_label(events)
        keywords = engine.generate_cluster_keywords(events)

        cluster_create = ClusterCreate(
            label=label,
            keywords=keywords,
            auto_generated=True,
            pinned=False,
        )

        cluster = cluster_repo.create(cluster_create, event_ids=rc["event_ids"])
        cluster_repo.update_centroid(cluster.id, rc["centroid"])
        created_clusters.append(cluster)

    session.commit()

    logger.info("auto_clusters_created", count=len(created_clusters))
    return {
        "clusters_created": len(created_clusters),
        "clusters": [{"id": str(c.id), "label": c.label, "event_count": c.event_count} for c in created_clusters],
    }


# ---- Chat ----

class ChatRequest(BaseModel):
    """Chat request from user."""
    message: str
    session_id: Optional[str] = None
    context_event_id: Optional[UUID] = None
    context_cluster_id: Optional[UUID] = None


class ChatResponse(BaseModel):
    """Chat response."""
    session_id: str
    message: ChatMessageRead
    context_events: List[EventRead] = []
    visualization: Optional[dict] = None


@app.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    session: Session = Depends(get_db_session),
):
    """
    Send a message to the LLM with RAG context, tool calling, and chart generation.

    Supports two backends:
    1. **Cloud AI** (OpenAI / Anthropic / Azure / OpenRouter) — uses native
       function-calling when available.
    2. **Ollama** (local) — uses fenced ``tool-call`` blocks parsed from text.

    The endpoint runs a multi-turn loop (max 3 iterations) so the LLM can
    invoke database tools, receive results, and then produce a final answer
    that may include a ``viz-command`` block with an optional ``chart_spec``.
    """
    import uuid as _uuid
    import re as _re
    import json as _json
    from packages.ai.llm_service import get_llama_service
    from packages.ai.cloud_llm import is_cloud_ai_enabled, cloud_generate
    from packages.ai.tools import (
        get_tool_definitions,
        get_tool_prompt_block,
        execute_tool,
    )
    from packages.storage.repositories import ChatMessageRepository, EventRepository

    chat_repo = ChatMessageRepository(session)
    event_repo = EventRepository(session)
    llm = get_llama_service()
    use_cloud = is_cloud_ai_enabled()

    # Generate or reuse session ID
    session_id = body.session_id or f"chat-{_uuid.uuid4().hex[:12]}"

    # Store user message
    chat_repo.create(
        session_id=session_id,
        role="user",
        content=body.message,
        context_event_id=body.context_event_id,
        context_cluster_id=body.context_cluster_id,
    )

    # -- Gather RAG context ------------------------------------------------
    context_events = []
    context_text = ""

    if body.context_event_id:
        event = event_repo.get_by_id(body.context_event_id)
        if event:
            context_events.append(event)
            context_text += f"\nReference Event: {event.title}\n{event.description or ''}\n"
            context_text += f"Categories: {', '.join(event.categories)}\n"
            context_text += f"Actors: {', '.join(event.actors)}\n"

    query_embedding = await llm.embed_text(body.message)
    if query_embedding:
        similar = event_repo.find_similar(embedding=query_embedding, limit=8, min_similarity=0.35)
        for r in similar:
            evt = r["event"]
            if evt.id not in {e.id for e in context_events}:
                context_events.append(evt)
                context_text += f"\nRelated Event ({r['similarity']:.0%} match): {evt.title}\n"
                context_text += f"  {evt.description[:200] if evt.description else ''}\n"
                context_text += f"  Severity={evt.severity} | Categories={', '.join(evt.categories or [])} | Actors={', '.join(evt.actors or [])}\n"

        similar_msgs = chat_repo.find_similar_messages(
            embedding=query_embedding, limit=3, min_similarity=0.55, role="assistant",
        )
        if similar_msgs:
            context_text += "\nRELEVANT PRIOR ANALYSIS:\n"
            for sm in similar_msgs:
                context_text += f"  - ({sm['similarity']:.0%} match) {sm['message'].content[:300]}\n"

    if body.context_cluster_id:
        from packages.storage.repositories import ClusterRepository
        cluster_repo = ClusterRepository(session)
        cluster_detail = cluster_repo.get_detail(body.context_cluster_id)
        if cluster_detail:
            context_text += f"\nCluster: {cluster_detail.label}\n"
            context_text += f"Keywords: {', '.join(cluster_detail.keywords)}\n"
            for evt in cluster_detail.events[:5]:
                context_text += f"  - {evt.title}\n"

    history = chat_repo.list_by_session(session_id, limit=20)
    history_text = ""
    for msg in history[-10:]:
        history_text += f"\n{msg.role.upper()}: {msg.content}\n"

    known_event_ids = [str(e.id) for e in context_events[:20]]
    events_list_text = "\n".join(f"  - ID={eid}" for eid in known_event_ids) if known_event_ids else "  (none)"

    # -- Build system prompt -----------------------------------------------
    tool_prompt = get_tool_prompt_block() if not use_cloud else ""

    system_prompt = f"""You are an intelligence analyst assistant for a geopolitical monitoring dashboard (World Dash).
You help users analyze world events, identify patterns, and build context around developing situations.

Your responses should be:
- Factual and grounded in the provided event data
- Analytical, identifying connections and patterns
- Concise but thorough
- Professional in tone

{tool_prompt}
VISUALIZATION CAPABILITY:
When the user asks you to visualize, compare, chart, filter, show on map, or create any kind of visual display,
include a JSON block fenced with ```viz-command and ``` containing a structured command.

The viz-command JSON object fields:
  "type": one of "network", "timeline", "chart", "filter", "map", "compare"
  "event_ids": list of event ID strings (use REAL event IDs from the context or tool results)
  "title": short descriptive title for the visualization
  "description": brief explanation
  "filter_spec": optional — {{"severity": "...", "category": "...", "date_range": "..."}}
  "chart_spec": optional — used for inline chart rendering in the chat panel. Structure:
    {{
      "chart_type": "bar" | "line" | "area" | "pie" | "radar",
      "title": "Chart title",
      "x_axis": {{"field": "field_name", "label": "X Label"}},
      "y_axis": {{"field": "field_name", "label": "Y Label"}},
      "series": [
        {{
          "name": "Series name",
          "data": [{{"x": "label or value", "y": numeric_value, "label": "optional tooltip"}}]
        }}
      ]
    }}

CHART EXAMPLES:

Severity comparison bar chart:
```viz-command
{{"type": "chart", "event_ids": ["id1", "id2", "id3"], "title": "Severity Comparison", "description": "Comparing severity across events", "chart_spec": {{"chart_type": "bar", "title": "Event Severity", "x_axis": {{"field": "event", "label": "Event"}}, "y_axis": {{"field": "risk_score", "label": "Risk Score"}}, "series": [{{"name": "Risk Score", "data": [{{"x": "Event Title 1", "y": 7.5}}, {{"x": "Event Title 2", "y": 5.0}}]}}]}}}}
```

Category distribution pie chart:
```viz-command
{{"type": "chart", "event_ids": [], "title": "Category Distribution", "description": "Breakdown of event categories", "chart_spec": {{"chart_type": "pie", "title": "Categories", "x_axis": {{"field": "category", "label": "Category"}}, "y_axis": {{"field": "count", "label": "Count"}}, "series": [{{"name": "Categories", "data": [{{"x": "military", "y": 12}}, {{"x": "economic", "y": 8}}]}}]}}}}
```

Compare events on a timeline:
```viz-command
{{"type": "compare", "event_ids": ["id1", "id2"], "title": "Event Timeline", "description": "Events over time", "chart_spec": {{"chart_type": "line", "title": "Event Timeline", "x_axis": {{"field": "date", "label": "Date"}}, "y_axis": {{"field": "risk_score", "label": "Risk Score"}}, "series": [{{"name": "Events", "data": [{{"x": "2026-01-15", "y": 6.5, "label": "Title 1"}}, {{"x": "2026-02-01", "y": 8.0, "label": "Title 2"}}]}}]}}}}
```

IMPORTANT RULES:
- Always provide viz-command IN ADDITION to your text analysis, never instead of it.
- Only include viz-command when the user explicitly or implicitly requests visual output.
- When comparing events, ALWAYS include a chart_spec so the user sees an inline chart.
- Use real data values from the events (risk_score, severity, categories, published dates) when building chart_spec.
- For comparisons, prefer bar charts for categorical data and line charts for temporal data.

AVAILABLE EVENT IDS (from context):
{events_list_text}

CONTEXT FROM INTELLIGENCE DATABASE:
{context_text if context_text else "No specific event context available."}

CONVERSATION HISTORY:
{history_text}

USER QUESTION: {body.message}

Respond as the intelligence analyst assistant. Reference specific events and data when available."""

    # -- LLM generation with tool-calling loop -----------------------------
    visualization = None
    assistant_content = ""
    max_tool_iterations = 3

    try:
        if use_cloud:
            # ---- Cloud AI path (native function calling) ----
            tool_defs = get_tool_definitions()
            cloud_messages_extra = ""  # accumulate tool results for re-prompting

            for iteration in range(max_tool_iterations + 1):
                user_text = body.message if iteration == 0 else f"Tool results:\n{cloud_messages_extra}\n\nNow produce your final answer."
                result = await cloud_generate(
                    system_prompt=system_prompt,
                    user_message=user_text,
                    tools=tool_defs if iteration < max_tool_iterations else None,
                    temperature=0.5,
                    timeout=float(llm.timeout),
                )

                # Check for tool calls
                if result.get("tool_calls") and iteration < max_tool_iterations:
                    tool_results_parts = []
                    for tc in result["tool_calls"]:
                        logger.info("cloud_tool_call", tool=tc["name"], args=tc.get("arguments"))
                        try:
                            tr = await execute_tool(tc["name"], tc.get("arguments", {}), session, llm)
                        except Exception as tool_err:
                            logger.error("cloud_tool_call_failed", tool=tc["name"], error=str(tool_err))
                            tr = {"success": False, "error": f"Tool '{tc['name']}' failed: {tool_err}"}
                        # Collect events from tool results for context_events
                        if tr.get("success") and tr.get("data"):
                            data = tr["data"]
                            events_list = data.get("events", [data] if "id" in (data if isinstance(data, dict) else {}) else [])
                            for ed in events_list:
                                if isinstance(ed, dict) and ed.get("id"):
                                    eid_str = ed["id"]
                                    if eid_str not in {str(e.id) for e in context_events}:
                                        full_evt = event_repo.get_by_id(UUID(eid_str))
                                        if full_evt:
                                            context_events.append(full_evt)

                        tool_results_parts.append(
                            f"Tool '{tc['name']}' result:\n{_json.dumps(tr, default=str)[:3000]}"
                        )
                    cloud_messages_extra = "\n\n".join(tool_results_parts)
                    # Update known event IDs for the next iteration
                    known_event_ids = [str(e.id) for e in context_events[:30]]
                    continue
                else:
                    assistant_content = result.get("text", "").strip()
                    break

        else:
            # ---- Ollama path (fenced tool-call blocks) ----
            current_prompt = system_prompt

            for iteration in range(max_tool_iterations + 1):
                async with httpx.AsyncClient(timeout=float(llm.timeout)) as client:
                    response = await client.post(
                        f"{llm.endpoint}/api/generate",
                        json={
                            "model": llm.model,
                            "prompt": current_prompt,
                            "stream": False,
                            "temperature": 0.5,
                        },
                    )
                    response.raise_for_status()
                    result = response.json()
                    raw_content = result.get("response", "").strip()

                # Check for tool-call blocks
                tool_match = _re.search(r'```tool-call\s*\n?(.*?)\n?```', raw_content, _re.DOTALL)
                if tool_match and iteration < max_tool_iterations:
                    try:
                        tool_data = _json.loads(tool_match.group(1).strip())
                        tool_name = tool_data.get("tool", "")
                        tool_args = tool_data.get("args", {})
                        logger.info("ollama_tool_call", tool=tool_name, args=tool_args)

                        try:
                            tr = await execute_tool(tool_name, tool_args, session, llm)
                        except Exception as tool_err:
                            logger.error("ollama_tool_call_failed", tool=tool_name, error=str(tool_err))
                            tr = {"success": False, "error": f"Tool '{tool_name}' failed: {tool_err}"}

                        # Collect events
                        if tr.get("success") and tr.get("data"):
                            data = tr["data"]
                            events_list = data.get("events", [data] if "id" in (data if isinstance(data, dict) else {}) else [])
                            for ed in events_list:
                                if isinstance(ed, dict) and ed.get("id"):
                                    eid_str = ed["id"]
                                    if eid_str not in {str(e.id) for e in context_events}:
                                        full_evt = event_repo.get_by_id(UUID(eid_str))
                                        if full_evt:
                                            context_events.append(full_evt)

                        # Re-prompt with tool results
                        tool_result_text = _json.dumps(tr, default=str)[:3000]
                        current_prompt = f"""{system_prompt}

TOOL RESULT for {tool_name}:
{tool_result_text}

Now provide your final answer to the user using these tool results. Include a viz-command block if the user requested visualization."""
                        continue

                    except (_json.JSONDecodeError, ValueError) as e:
                        logger.warning("ollama_tool_call_parse_failed", error=str(e))
                        assistant_content = raw_content
                        break
                else:
                    # No tool call — this is the final answer
                    # Strip any residual tool-call blocks from displayed text
                    assistant_content = _re.sub(r'```tool-call\s*\n?.*?\n?```', '', raw_content, flags=_re.DOTALL).strip()
                    break

        if not assistant_content:
            assistant_content = "I wasn't able to generate a response. Please try rephrasing your question."

        # Parse viz-command blocks from response
        viz_match = _re.search(r'```viz-command\s*\n?(.*?)\n?```', assistant_content, _re.DOTALL)
        if viz_match:
            try:
                viz_data = _json.loads(viz_match.group(1).strip())
                if isinstance(viz_data, dict) and "type" in viz_data:
                    visualization = viz_data
                    logger.info("chat_viz_command_parsed", viz_type=viz_data.get("type"))
            except (_json.JSONDecodeError, ValueError) as ve:
                logger.warning("chat_viz_command_parse_failed", error=str(ve))

            assistant_content = _re.sub(r'```viz-command\s*\n?.*?\n?```', '', assistant_content, flags=_re.DOTALL).strip()

    except Exception as e:
        logger.error("chat_llm_error", error=str(e))
        assistant_content = f"I'm having trouble connecting to the analysis engine. Error: {str(e)}"

    # -- Store assistant response ------------------------------------------
    metadata = {"context_event_count": len(context_events)}
    if visualization:
        metadata["visualization"] = visualization

    assistant_msg = chat_repo.create(
        session_id=session_id,
        role="assistant",
        content=assistant_content,
        context_event_id=body.context_event_id,
        context_cluster_id=body.context_cluster_id,
        metadata_json=metadata,
    )

    session.commit()

    try:
        from apps.worker.tasks import embed_chat_message_task
        embed_chat_message_task.delay(str(assistant_msg.id))
    except Exception:
        logger.warning("failed_to_dispatch_chat_embedding", message_id=str(assistant_msg.id))

    return ChatResponse(
        session_id=session_id,
        message=assistant_msg,
        context_events=context_events[:10],
        visualization=visualization,
    )


@app.get("/chat/sessions", response_model=List[ChatSessionRead])
async def list_chat_sessions(
    limit: int = Query(default=50, le=200),
    session: Session = Depends(get_db_session),
):
    """List chat sessions."""
    from packages.storage.repositories import ChatMessageRepository

    repo = ChatMessageRepository(session)
    return repo.list_sessions(limit=limit)


@app.get("/chat/sessions/{session_id}", response_model=List[ChatMessageRead])
async def get_chat_session(
    session_id: str,
    limit: int = Query(default=100, le=500),
    session: Session = Depends(get_db_session),
):
    """Get all messages in a chat session."""
    from packages.storage.repositories import ChatMessageRepository

    repo = ChatMessageRepository(session)
    messages = repo.list_by_session(session_id, limit=limit)
    if not messages:
        raise HTTPException(status_code=404, detail="Session not found")
    return messages


@app.delete("/chat/sessions/{session_id}", status_code=204)
async def delete_chat_session(
    session_id: str,
    session: Session = Depends(get_db_session),
):
    """Delete a chat session and all its messages."""
    from packages.storage.repositories import ChatMessageRepository

    repo = ChatMessageRepository(session)
    deleted = repo.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    session.commit()


# ---- Cloud AI Config (Redis-backed) ----

_CLOUD_AI_REDIS_KEY = "worlddash:cloud_ai_config"


def _get_redis():
    import redis
    return redis.Redis(
        host=settings.redis.host,
        port=settings.redis.port,
        db=settings.redis.db,
        decode_responses=True,
    )


@app.get("/cloud-ai/config", response_model=CloudAIConfigResponse)
async def get_cloud_ai_config():
    """Get cloud AI provider configuration from Redis."""
    import json

    try:
        r = _get_redis()
        raw = r.get(_CLOUD_AI_REDIS_KEY)
        if raw:
            data = json.loads(raw)
            # Mask the API key for security
            if data.get("api_key"):
                data["api_key"] = data["api_key"][:8] + "..." + data["api_key"][-4:] if len(data["api_key"]) > 12 else "••••••••"
            return CloudAIConfigResponse(**data)
    except Exception as e:
        logger.warning("cloud_ai_config_read_failed", error=str(e))

    return CloudAIConfigResponse()


@app.put("/cloud-ai/config", response_model=CloudAIConfigResponse)
async def update_cloud_ai_config(body: CloudAIConfigUpdate):
    """Update cloud AI provider configuration. Stored in Redis."""
    import json

    try:
        r = _get_redis()

        # Load existing config
        existing = {}
        raw = r.get(_CLOUD_AI_REDIS_KEY)
        if raw:
            existing = json.loads(raw)

        # Merge updates
        updates = body.model_dump(exclude_unset=True)

        # Encrypt the API key before storing
        if "api_key" in updates and updates["api_key"]:
            updates["api_key"] = _encrypt(updates["api_key"])

        existing.update(updates)

        r.set(_CLOUD_AI_REDIS_KEY, json.dumps(existing))
        logger.info("cloud_ai_config_updated", provider=existing.get("provider"))

        # Return with masked key
        resp = dict(existing)
        if resp.get("api_key") and len(resp["api_key"]) > 12:
            resp["api_key"] = resp["api_key"][:8] + "..." + resp["api_key"][-4:]
        elif resp.get("api_key"):
            resp["api_key"] = "••••••••"

        return CloudAIConfigResponse(**resp)

    except Exception as e:
        logger.error("cloud_ai_config_update_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to save config: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.api.host,
        port=settings.api.port,
        reload=settings.api.reload,
        log_level=settings.api.log_level.lower(),
    )
