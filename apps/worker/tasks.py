"""
Celery tasks for background processing.
"""

import asyncio
from uuid import UUID

from .celery_app import app
from packages.shared.logging import get_logger
from packages.feed_ingestion.tasks import ingest_all_sources, ingest_source
from packages.storage.database import get_db_manager
from packages.storage.repositories import AlertRepository, EventRepository
from packages.event_normalizer.normalizer import EventNormalizer
from packages.intelligence_engine.engine import IntelligenceEngine
from packages.shared.schemas import EventStatus

logger = get_logger(__name__)


def _run_async(coro):
    """Safely run async code from sync Celery tasks."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


@app.task(name="apps.worker.tasks.ingest_all_sources_task")
def ingest_all_sources_task():
    """Celery task: Ingest all enabled sources."""
    logger.info("task_started", task="ingest_all_sources")
    result = _run_async(ingest_all_sources())
    logger.info("task_completed", task="ingest_all_sources", result=result)
    return result


@app.task(name="apps.worker.tasks.ingest_source_task")
def ingest_source_task(source_id: str):
    """Celery task: Ingest single source."""
    logger.info("task_started", task="ingest_source", source_id=source_id)
    result = _run_async(ingest_source(UUID(source_id)))
    logger.info("task_completed", task="ingest_source", source_id=source_id, result=result)
    return result


@app.task(name="apps.worker.tasks.normalize_event_task")
def normalize_event_task(event_id: str):
    """Celery task: Normalize and enrich event, then trigger LLM categorization."""
    logger.info("task_started", task="normalize_event", event_id=event_id)

    db_manager = get_db_manager()
    normalizer = EventNormalizer()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)

        # Get event
        event = event_repo.get_by_id(UUID(event_id))
        if not event:
            logger.error("event_not_found", event_id=event_id)
            return {"success": False, "error": "Event not found"}

        # Normalize
        try:
            enriched_data = normalizer.normalize(event)

            # Update event
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

            # Chain: LLM categorization -> intelligence analysis
            llm_categorize_event_task.delay(event_id)

            return {"success": True}

        except Exception as e:
            logger.error("normalization_failed", event_id=event_id, error=str(e))
            event_repo.update_status(UUID(event_id), EventStatus.FAILED)
            session.commit()
            return {"success": False, "error": str(e)}


@app.task(name="apps.worker.tasks.llm_categorize_event_task", bind=True, max_retries=2)
def llm_categorize_event_task(self, event_id: str):
    """
    Celery task: Use LLM to extract semantic categories for a single event.
    Persists results to DB, then triggers intelligence analysis.
    """
    logger.info("task_started", task="llm_categorize_event", event_id=event_id)

    from packages.ai.llm_service import get_llama_service

    db_manager = get_db_manager()
    llm = get_llama_service()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)
        event = event_repo.get_by_id(UUID(event_id))

        if not event:
            logger.error("event_not_found", event_id=event_id)
            return {"success": False, "error": "Event not found"}

        try:
            # Use synchronous LLM call (no asyncio.run needed)
            context = llm.extract_event_context_sync(
                title=event.title,
                description=event.description,
            )

            has_data = bool(context["categories"] or context["actors"] or context["themes"])

            # Always persist LLM results (even empty) to mark as processed
            # This prevents infinite re-queuing of events that timeout or fail parsing
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

            # Trigger intelligence analysis regardless
            analyze_event_task.delay(event_id)

            return {
                "success": True,
                "llm_extracted": has_data,
                "categories": context["categories"],
            }

        except Exception as e:
            logger.error("llm_categorize_failed", event_id=event_id, error=str(e))
            # Still trigger intelligence analysis even if LLM fails
            analyze_event_task.delay(event_id)
            return {"success": False, "error": str(e)}


@app.task(name="apps.worker.tasks.llm_categorize_events_task")
def llm_categorize_events_task():
    """
    Celery task (periodic): Find events that haven't been LLM-processed yet
    and queue them for categorization.
    """
    logger.info("task_started", task="llm_categorize_events_batch")

    db_manager = get_db_manager()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)
        unprocessed = event_repo.list_unprocessed_by_llm(limit=5)

    logger.info("llm_batch_queued", count=len(unprocessed))

    # Stagger tasks so Ollama processes one at a time (~30s each)
    for i, event in enumerate(unprocessed):
        llm_categorize_event_task.apply_async(
            args=[str(event.id)],
            countdown=i * 35,  # 35s stagger per event
        )

    return {"success": True, "queued": len(unprocessed)}


@app.task(name="apps.worker.tasks.analyze_event_task")
def analyze_event_task(event_id: str):
    """Celery task: Analyze event and generate alerts."""
    logger.info("task_started", task="analyze_event", event_id=event_id)

    db_manager = get_db_manager()
    engine = IntelligenceEngine()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)
        alert_repo = AlertRepository(session)

        # Get event
        event = event_repo.get_by_id(UUID(event_id))
        if not event:
            logger.error("event_not_found", event_id=event_id)
            return {"success": False, "error": "Event not found"}

        # Analyze
        try:
            alerts = engine.analyze(event)

            # Create alerts
            created_count = 0
            for alert_create in alerts:
                alert_repo.create(alert_create)
                created_count += 1

            # Mark as processed
            event_repo.update_status(UUID(event_id), EventStatus.PROCESSED)
            session.commit()

            logger.info("event_analyzed", event_id=event_id, alerts_created=created_count)

            return {"success": True, "alerts_created": created_count}

        except Exception as e:
            logger.error("analysis_failed", event_id=event_id, error=str(e))
            return {"success": False, "error": str(e)}


@app.task(name="apps.worker.tasks.process_new_events")
def process_new_events():
    """Celery task (periodic): Process all raw events through normalization pipeline."""
    logger.info("task_started", task="process_new_events")

    db_manager = get_db_manager()

    with db_manager.get_session() as session:
        event_repo = EventRepository(session)

        # Get raw events
        raw_events = event_repo.list_recent(
            limit=100,
            status=EventStatus.RAW,
        )

        logger.info("processing_raw_events", count=len(raw_events))

        # Queue normalization tasks
        for event in raw_events:
            normalize_event_task.delay(str(event.id))

    return {"success": True, "queued": len(raw_events)}
