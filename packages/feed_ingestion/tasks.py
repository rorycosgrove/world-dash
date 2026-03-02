"""
Celery tasks for feed ingestion.
"""

from uuid import UUID

from packages.shared.logging import get_logger
from packages.storage.database import get_db_manager
from packages.storage.repositories import EventRepository, SourceRepository

from .parser import FeedParser

logger = get_logger(__name__)


def ingest_source(source_id: UUID) -> dict:
    """
    Ingest events from a single source.

    Args:
        source_id: UUID of source to poll

    Returns:
        Dict with ingestion statistics
    """
    db_manager = get_db_manager()
    parser = FeedParser()

    try:
        with db_manager.get_session() as session:
            source_repo = SourceRepository(session)
            event_repo = EventRepository(session)

            # Get source
            source = source_repo.get_by_id(source_id)
            if not source:
                logger.error("source_not_found", source_id=str(source_id))
                return {"success": False, "error": "Source not found"}

            if not source.enabled:
                logger.info("source_disabled", source_id=str(source_id))
                return {"success": True, "new_events": 0, "duplicates": 0, "skipped": True}

            # Parse feed
            try:
                entries = parser.parse(source)
            except Exception as e:
                error_msg = str(e)
                logger.error("source_parse_failed", source_id=str(source_id), error=error_msg)
                source_repo.update_poll_status(source_id, success=False, error=error_msg)
                session.commit()
                return {"success": False, "error": error_msg}

            # Process entries
            new_events = 0
            new_event_ids = []
            duplicates = 0

            for entry in entries:
                try:
                    event_create = entry.to_event_create(source_id)

                    # Check for duplicates
                    existing = event_repo.get_by_content_hash(event_create.content_hash)
                    if existing:
                        duplicates += 1
                        logger.debug(
                            "duplicate_event_skipped",
                            source_id=str(source_id),
                            url=event_create.url,
                        )
                        continue

                    # Create event
                    created = event_repo.create(event_create)
                    new_events += 1
                    new_event_ids.append(str(created.id))

                except Exception as e:
                    logger.error(
                        "event_create_failed",
                        source_id=str(source_id),
                        error=str(e),
                        entry_title=entry.title,
                    )
                    session.rollback()
                    continue

            # Update source status
            source_repo.update_poll_status(
                source_id,
                success=True,
                event_count=new_events,
            )
            session.commit()

            logger.info(
                "source_ingestion_complete",
                source_id=str(source_id),
                new_events=new_events,
                duplicates=duplicates,
                total_entries=len(entries),
            )

            return {
                "success": True,
                "new_events": new_events,
                "new_event_ids": new_event_ids,
                "duplicates": duplicates,
                "total_entries": len(entries),
            }

    except Exception as e:
        logger.error("ingestion_error", source_id=str(source_id), error=str(e))
        return {"success": False, "error": str(e)}
    finally:
        parser.close()


def ingest_all_sources() -> dict:
    """
    Ingest events from all enabled sources.

    Returns:
        Dict with aggregated statistics
    """
    db_manager = get_db_manager()

    with db_manager.get_session() as session:
        source_repo = SourceRepository(session)
        sources = source_repo.list_enabled()

    logger.info("ingesting_all_sources", source_count=len(sources))

    total_new = 0
    total_duplicates = 0
    total_errors = 0

    for source in sources:
        result = ingest_source(source.id)
        if result["success"]:
            total_new += result.get("new_events", 0)
            total_duplicates += result.get("duplicates", 0)
        else:
            total_errors += 1

    logger.info(
        "all_sources_ingestion_complete",
        total_new_events=total_new,
        total_duplicates=total_duplicates,
        total_errors=total_errors,
        sources_processed=len(sources),
    )

    return {
        "sources_processed": len(sources),
        "total_new_events": total_new,
        "total_duplicates": total_duplicates,
        "total_errors": total_errors,
    }
