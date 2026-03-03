"""Celery tasks for background processing."""

import asyncio
from uuid import UUID

import redis as _redis

from .celery_app import app
from packages.shared.config import get_settings
from packages.shared.logging import get_logger
from packages.feed_ingestion.tasks import ingest_all_sources, ingest_source
from packages.storage.database import get_db_manager
from packages.storage.repositories import AlertRepository, EventRepository
from packages.event_normalizer.normalizer import EventNormalizer
from packages.intelligence_engine.engine import IntelligenceEngine
from packages.shared.schemas import EventStatus

logger = get_logger(__name__)

_settings = get_settings()
_redis_client = _redis.Redis(
    host=_settings.redis.host, port=_settings.redis.port, db=_settings.redis.db,
    decode_responses=True,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_async(coro):
    """Run async code from sync Celery tasks."""
    return asyncio.run(coro)


def _get_llm_service():
    """Create LlamaService using runtime config from Redis (falls back to env)."""
    from packages.ai.llm_service import get_llama_service
    return get_llama_service()  # reads Redis inside


# ---------------------------------------------------------------------------
# Ingestion tasks  (queue: default)
# ---------------------------------------------------------------------------

@app.task(
    name="apps.worker.tasks.ingest_all_sources_task",
    soft_time_limit=120,
    time_limit=180,
)
def ingest_all_sources_task():
    """Celery task: Ingest all enabled sources, each auto-enriching its events."""
    logger.info("task_started", task="ingest_all_sources")

    # Dispatch per-source Celery tasks so each one chains into
    # normalization → LLM → analysis automatically.
    db_manager = get_db_manager()
    with db_manager.get_session() as session:
        from packages.storage.repositories import SourceRepository
        repo = SourceRepository(session)
        sources = repo.list_enabled()

    dispatched = 0
    for source in sources:
        ingest_source_task.delay(str(source.id))
        dispatched += 1

    logger.info("task_completed", task="ingest_all_sources", dispatched=dispatched)
    return {"success": True, "dispatched": dispatched}


@app.task(
    name="apps.worker.tasks.ingest_source_task",
    soft_time_limit=60,
    time_limit=90,
)
def ingest_source_task(source_id: str):
    """Celery task: Ingest single source, then auto-enrich new events."""
    logger.info("task_started", task="ingest_source", source_id=source_id)
    result = ingest_source(UUID(source_id))

    # Immediately chain new events into the enrichment pipeline
    # (ingestion → normalization → LLM categorization → analysis)
    new_ids = result.get("new_event_ids", [])
    for eid in new_ids:
        normalize_event_task.delay(eid)

    logger.info(
        "task_completed",
        task="ingest_source",
        source_id=source_id,
        new_events=len(new_ids),
        auto_enrich=len(new_ids),
    )
    return result


# ---------------------------------------------------------------------------
# Normalization  (queue: default)
# ---------------------------------------------------------------------------

@app.task(
    name="apps.worker.tasks.normalize_event_task",
    soft_time_limit=30,
    time_limit=60,
)
def normalize_event_task(event_id: str):
    """Celery task: Normalize and enrich event, then trigger LLM categorization."""
    logger.info("task_started", task="normalize_event", event_id=event_id)

    db_manager = get_db_manager()
    normalizer = EventNormalizer()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)

        event = event_repo.get_by_id(UUID(event_id))
        if not event:
            logger.error("event_not_found", event_id=event_id)
            return {"success": False, "error": "Event not found"}

        try:
            enriched_data = normalizer.normalize(event)
            event_repo.update_enrichment(
                event_id=UUID(event_id),
                location=enriched_data.get("location"),
                entities=enriched_data.get("entities"),
                tags=enriched_data.get("tags"),
                severity=enriched_data.get("severity"),
                risk_score=enriched_data.get("risk_score"),
            )
            session.commit()
            logger.info("event_normalized", event_id=event_id)

            # Queue LLM categorization (goes to 'llm' queue automatically)
            llm_categorize_event_task.delay(event_id)

            return {"success": True}

        except Exception as e:
            logger.error("normalization_failed", event_id=event_id, error=str(e))
            event_repo.update_status(UUID(event_id), EventStatus.FAILED)
            session.commit()
            return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# LLM tasks  (queue: llm — consumed by llm-worker with concurrency=1)
# ---------------------------------------------------------------------------

@app.task(
    name="apps.worker.tasks.llm_categorize_event_task",
    bind=True,
    max_retries=2,
    soft_time_limit=150,
    time_limit=180,
    # No rate_limit — the llm-worker already runs concurrency=1, which
    # naturally serialises Ollama requests.  A rate limit on top of that
    # only adds artificial delay when a burst of new events arrives.
)
def llm_categorize_event_task(self, event_id: str):
    """
    Celery task: Use LLM to extract semantic categories for a single event.
    Runs on the 'llm' queue (concurrency=1) so Ollama gets one request at a time.
    """
    logger.info("task_started", task="llm_categorize_event", event_id=event_id)

    db_manager = get_db_manager()
    llm = _get_llm_service()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)
        event = event_repo.get_by_id(UUID(event_id))

        if not event:
            logger.error("event_not_found", event_id=event_id)
            return {"success": False, "error": "Event not found"}

        try:
            context = llm.extract_event_context_sync(
                title=event.title,
                description=event.description,
            )

            has_data = bool(context["categories"] or context["actors"] or context["themes"])

            # Always mark as processed (even empty) to prevent re-queuing
            event_repo.update_llm_data(
                event_id=UUID(event_id),
                categories=context["categories"],
                actors=context["actors"],
                themes=context["themes"],
                llm_significance=context["significance"],
            )
            session.commit()

            if has_data:
                logger.info(
                    "event_llm_categorized",
                    event_id=event_id,
                    categories=context["categories"],
                    actors=context["actors"],
                    significance=context["significance"],
                )
            else:
                logger.warning(
                    "llm_returned_empty",
                    event_id=event_id,
                    reason="LLM returned no categories/actors/themes",
                )

            # Chain: LLM categorize → embed → analyze
            embed_event_task.delay(event_id)

            return {
                "success": True,
                "llm_extracted": has_data,
                "categories": context["categories"],
            }

        except Exception as e:
            logger.error("llm_categorize_failed", event_id=event_id, error=str(e))
            # Retry on transient errors (connection, timeout); after max
            # retries, fall through to analysis without LLM data.
            try:
                raise self.retry(exc=e, countdown=15 * (self.request.retries + 1))
            except self.MaxRetriesExceededError:
                logger.warning("llm_max_retries_exceeded", event_id=event_id)
                embed_event_task.delay(event_id)
                return {"success": False, "error": str(e)}


@app.task(
    name="apps.worker.tasks.llm_categorize_events_task",
    soft_time_limit=30,
    time_limit=60,
)
def llm_categorize_events_task():
    """
    Periodic batch: Find unprocessed events and queue them for LLM.
    Uses a Redis lock to prevent overlapping batches.
    """
    LOCK_KEY = "worlddash:llm_batch_lock"
    LOCK_TTL = 280  # just under beat interval (300s)
    BATCH_SIZE = 5

    # Distributed lock — skip if a previous batch is still running
    if not _redis_client.set(LOCK_KEY, "1", nx=True, ex=LOCK_TTL):
        logger.info("llm_batch_skipped", reason="previous batch still running")
        return {"success": True, "queued": 0, "skipped": True}

    try:
        logger.info("task_started", task="llm_categorize_events_batch")

        db_manager = get_db_manager()
        with db_manager.get_session() as session:
            event_repo = EventRepository(session)
            unprocessed = event_repo.list_unprocessed_by_llm(limit=BATCH_SIZE)

        logger.info("llm_batch_queued", count=len(unprocessed))

        # No stagger needed — llm-worker has concurrency=1 so tasks
        # naturally execute one-at-a-time in FIFO order.
        for event in unprocessed:
            llm_categorize_event_task.delay(str(event.id))

        return {"success": True, "queued": len(unprocessed)}
    finally:
        # Release lock if we finish quickly (otherwise TTL handles it)
        _redis_client.delete(LOCK_KEY)


# ---------------------------------------------------------------------------
# Embedding tasks  (queue: llm — uses Ollama embedding model)
# ---------------------------------------------------------------------------

@app.task(
    name="apps.worker.tasks.embed_event_task",
    bind=True,
    max_retries=2,
    soft_time_limit=60,
    time_limit=90,
)
def embed_event_task(self, event_id: str):
    """
    Generate and store a vector embedding for a single event.
    Chains into analyze_event_task after completion.
    Runs on the 'llm' queue (concurrency=1) so Ollama gets one request at a time.
    """
    logger.info("task_started", task="embed_event", event_id=event_id)

    db_manager = get_db_manager()
    llm = _get_llm_service()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)
        event = event_repo.get_by_id(UUID(event_id))

        if not event:
            logger.error("event_not_found", event_id=event_id)
            return {"success": False, "error": "Event not found"}

        try:
            embed_text = llm.build_event_embed_text(
                title=event.title,
                description=event.description,
                categories=event.categories,
                actors=event.actors,
                themes=event.themes,
            )

            embedding = llm.embed_text_sync(embed_text)

            if embedding:
                event_repo.store_embedding(UUID(event_id), embedding)
                session.commit()
                logger.info("event_embedded", event_id=event_id, dims=len(embedding))
            else:
                logger.warning("embed_returned_none", event_id=event_id)

            # Always chain to analysis regardless of embedding success
            analyze_event_task.delay(event_id)

            return {"success": True, "embedded": embedding is not None}

        except Exception as e:
            logger.error("embed_failed", event_id=event_id, error=str(e))
            try:
                raise self.retry(exc=e, countdown=10 * (self.request.retries + 1))
            except self.MaxRetriesExceededError:
                logger.warning("embed_max_retries_exceeded", event_id=event_id)
                analyze_event_task.delay(event_id)
                return {"success": False, "error": str(e)}


@app.task(
    name="apps.worker.tasks.backfill_embeddings_task",
    soft_time_limit=300,
    time_limit=360,
)
def backfill_embeddings_task():
    """
    Periodic batch: Find LLM-processed events without embeddings and queue them.
    Uses a Redis lock to prevent overlapping batches.
    """
    LOCK_KEY = "worlddash:embed_batch_lock"
    LOCK_TTL = 280
    BATCH_SIZE = 10

    if not _redis_client.set(LOCK_KEY, "1", nx=True, ex=LOCK_TTL):
        logger.info("embed_batch_skipped", reason="previous batch still running")
        return {"success": True, "queued": 0, "skipped": True}

    try:
        logger.info("task_started", task="backfill_embeddings")

        db_manager = get_db_manager()
        with db_manager.get_session() as session:
            event_repo = EventRepository(session)
            unembedded = event_repo.list_unembedded(limit=BATCH_SIZE)

        logger.info("embed_batch_queued", count=len(unembedded))

        for event in unembedded:
            embed_event_standalone_task.delay(str(event.id))

        return {"success": True, "queued": len(unembedded)}
    finally:
        _redis_client.delete(LOCK_KEY)


@app.task(
    name="apps.worker.tasks.embed_event_standalone_task",
    bind=True,
    max_retries=2,
    soft_time_limit=60,
    time_limit=90,
)
def embed_event_standalone_task(self, event_id: str):
    """Embed an event without chaining to analysis (for backfill use)."""
    logger.info("task_started", task="embed_event_standalone", event_id=event_id)

    db_manager = get_db_manager()
    llm = _get_llm_service()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)
        event = event_repo.get_by_id(UUID(event_id))

        if not event:
            return {"success": False, "error": "Event not found"}

        try:
            embed_text = llm.build_event_embed_text(
                title=event.title,
                description=event.description,
                categories=event.categories,
                actors=event.actors,
                themes=event.themes,
            )

            embedding = llm.embed_text_sync(embed_text)

            if embedding:
                event_repo.store_embedding(UUID(event_id), embedding)
                session.commit()
                logger.info("event_embedded_standalone", event_id=event_id)
                return {"success": True, "embedded": True}
            else:
                logger.warning("embed_returned_none_standalone", event_id=event_id)
                return {"success": True, "embedded": False}

        except Exception as e:
            logger.error("embed_standalone_failed", event_id=event_id, error=str(e))
            try:
                raise self.retry(exc=e, countdown=10 * (self.request.retries + 1))
            except self.MaxRetriesExceededError:
                return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Analysis tasks  (queue: default)
# ---------------------------------------------------------------------------

@app.task(
    name="apps.worker.tasks.analyze_event_task",
    soft_time_limit=30,
    time_limit=60,
)
def analyze_event_task(event_id: str):
    """Celery task: Analyze event and generate alerts."""
    logger.info("task_started", task="analyze_event", event_id=event_id)

    db_manager = get_db_manager()
    engine = IntelligenceEngine()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)
        alert_repo = AlertRepository(session)

        event = event_repo.get_by_id(UUID(event_id))
        if not event:
            logger.error("event_not_found", event_id=event_id)
            return {"success": False, "error": "Event not found"}

        try:
            alerts = engine.analyze(event)
            created_count = 0
            for alert_create in alerts:
                alert_repo.create(alert_create)
                created_count += 1

            event_repo.update_status(UUID(event_id), EventStatus.PROCESSED)
            session.commit()

            logger.info("event_analyzed", event_id=event_id, alerts_created=created_count)
            return {"success": True, "alerts_created": created_count}

        except Exception as e:
            logger.error("analysis_failed", event_id=event_id, error=str(e))
            return {"success": False, "error": str(e)}


@app.task(
    name="apps.worker.tasks.process_new_events",
    soft_time_limit=30,
    time_limit=60,
)
def process_new_events():
    """Celery task (periodic): Safety-net for any RAW events that missed auto-enrichment."""
    logger.info("task_started", task="process_new_events")

    db_manager = get_db_manager()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)
        raw_events = event_repo.list_recent(
            limit=50,  # cap per cycle to avoid flooding
            status=EventStatus.RAW,
        )

        if not raw_events:
            logger.info("no_raw_events_found")
            return {"success": True, "queued": 0}

        logger.info("processing_raw_events", count=len(raw_events))

        for event in raw_events:
            normalize_event_task.delay(str(event.id))

    return {"success": True, "queued": len(raw_events)}


# ---------------------------------------------------------------------------
# Vector feedback loop  (queue: llm)
# ---------------------------------------------------------------------------

@app.task(
    name="apps.worker.tasks.embed_chat_message_task",
    bind=True,
    max_retries=2,
    soft_time_limit=60,
    time_limit=90,
)
def embed_chat_message_task(self, message_id: str):
    """Embed a chat message and store the vector for future retrieval."""
    logger.info("embed_chat_message_started", message_id=message_id)

    try:
        llm = _get_llm_service()
        db_manager = get_db_manager()

        with db_manager.get_session() as session:
            from packages.storage.repositories import ChatMessageRepository
            chat_repo = ChatMessageRepository(session)

            # Load message
            from packages.storage.models import ChatMessage as ChatMessageModel
            msg = session.query(ChatMessageModel).filter(
                ChatMessageModel.id == UUID(message_id)
            ).first()

            if not msg:
                logger.warning("chat_message_not_found", message_id=message_id)
                return {"success": False, "error": "not_found"}

            if msg.embedding is not None:
                logger.info("chat_message_already_embedded", message_id=message_id)
                return {"success": True, "already_embedded": True}

            embedding = llm.embed_text_sync(msg.content)
            if embedding:
                chat_repo.store_embedding(UUID(message_id), embedding)
                session.commit()
                logger.info("chat_message_embedded", message_id=message_id)
                return {"success": True}
            else:
                logger.warning("embed_chat_empty_result", message_id=message_id)
                return {"success": False, "error": "empty_embedding"}

    except Exception as e:
        logger.error("embed_chat_message_failed", message_id=message_id, error=str(e))
        raise self.retry(exc=e, countdown=15)


@app.task(
    name="apps.worker.tasks.embed_cluster_summary_task",
    bind=True,
    max_retries=2,
    soft_time_limit=60,
    time_limit=90,
)
def embed_cluster_summary_task(self, cluster_id: str):
    """Embed a cluster summary/label and store as the cluster centroid."""
    logger.info("embed_cluster_summary_started", cluster_id=cluster_id)

    try:
        llm = _get_llm_service()
        db_manager = get_db_manager()

        with db_manager.get_session() as session:
            from packages.storage.repositories import ClusterRepository
            cluster_repo = ClusterRepository(session)

            cluster = cluster_repo.get_by_id(UUID(cluster_id))
            if not cluster:
                logger.warning("cluster_not_found", cluster_id=cluster_id)
                return {"success": False, "error": "not_found"}

            # Build text from label + summary + keywords
            parts = [cluster.label]
            if cluster.summary:
                parts.append(cluster.summary)
            if cluster.keywords:
                parts.append("Keywords: " + ", ".join(cluster.keywords))

            text = " | ".join(parts)
            embedding = llm.embed_text_sync(text)

            if embedding:
                cluster_repo.update_centroid(UUID(cluster_id), embedding)
                session.commit()
                logger.info("cluster_summary_embedded", cluster_id=cluster_id)
                return {"success": True}
            else:
                logger.warning("embed_cluster_empty_result", cluster_id=cluster_id)
                return {"success": False, "error": "empty_embedding"}

    except Exception as e:
        logger.error("embed_cluster_summary_failed", cluster_id=cluster_id, error=str(e))
        raise self.retry(exc=e, countdown=15)


@app.task(
    name="apps.worker.tasks.backfill_chat_embeddings_task",
    soft_time_limit=120,
    time_limit=180,
)
def backfill_chat_embeddings_task():
    """Periodically embed any unembedded chat messages."""
    lock_key = "lock:backfill_chat_embeddings"
    if not _redis_client.set(lock_key, "1", nx=True, ex=300):
        logger.info("backfill_chat_embeddings_skipped_lock")
        return {"success": True, "skipped": "lock_held"}

    try:
        db_manager = get_db_manager()
        with db_manager.get_session() as session:
            from packages.storage.repositories import ChatMessageRepository
            chat_repo = ChatMessageRepository(session)
            unembedded = chat_repo.list_unembedded(limit=30)

        queued = 0
        for msg in unembedded:
            embed_chat_message_task.delay(str(msg.id))
            queued += 1

        logger.info("backfill_chat_embeddings_done", queued=queued)
        return {"success": True, "queued": queued}

    finally:
        _redis_client.delete(lock_key)
