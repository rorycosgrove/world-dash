"""
Repository pattern implementation for data access.
Provides clean abstraction over SQLAlchemy queries.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy import and_, desc, func
from sqlalchemy.orm import Session

from packages.shared.logging import get_logger
from packages.shared.schemas import (
    AlertCreate,
    AlertRead,
    EventCreate,
    EventRead,
    EventSeverity,
    EventStatus,
    LocationSchema,
    SourceCreate,
    SourceRead,
)

from .models import Alert, Event, Source

logger = get_logger(__name__)


class SourceRepository:
    """Repository for Source operations."""

    def __init__(self, session: Session):
        self.session = session

    def create(self, source: SourceCreate) -> SourceRead:
        """Create new source."""
        db_source = Source(
            name=source.name,
            url=source.url,
            type=source.type,
            enabled=source.enabled,
            tags=source.tags,
        )
        self.session.add(db_source)
        self.session.flush()
        logger.info("source_created", source_id=str(db_source.id), name=source.name)
        return self._to_schema(db_source)

    def get_by_id(self, source_id: UUID) -> Optional[SourceRead]:
        """Get source by ID."""
        db_source = self.session.query(Source).filter(Source.id == source_id).first()
        return self._to_schema(db_source) if db_source else None

    def get_by_url(self, url: str) -> Optional[SourceRead]:
        """Get source by URL."""
        db_source = self.session.query(Source).filter(Source.url == url).first()
        return self._to_schema(db_source) if db_source else None

    def list_enabled(self) -> List[SourceRead]:
        """List all enabled sources."""
        sources = self.session.query(Source).filter(Source.enabled == True).all()
        return [self._to_schema(s) for s in sources]

    def list_all(self, limit: int = 100, offset: int = 0) -> List[SourceRead]:
        """List all sources with pagination."""
        sources = self.session.query(Source).limit(limit).offset(offset).all()
        return [self._to_schema(s) for s in sources]

    def update_poll_status(
        self,
        source_id: UUID,
        success: bool,
        error: Optional[str] = None,
        event_count: int = 0,
    ) -> None:
        """Update source polling status."""
        updates = {"last_polled_at": datetime.utcnow()}

        if success:
            updates["last_success_at"] = datetime.utcnow()
            updates["error_count"] = 0
            updates["total_events"] = Source.total_events + event_count
        else:
            updates["error_count"] = Source.error_count + 1
            updates["last_error"] = error

        self.session.query(Source).filter(Source.id == source_id).update(updates)

    def _to_schema(self, source: Source) -> SourceRead:
        """Convert SQLAlchemy model to Pydantic schema."""
        return SourceRead(
            id=source.id,
            name=source.name,
            url=source.url,
            type=source.type,
            enabled=source.enabled,
            tags=source.tags,
            last_polled_at=source.last_polled_at,
            last_success_at=source.last_success_at,
            last_error=source.last_error,
            error_count=source.error_count,
            total_events=source.total_events,
            created_at=source.created_at,
            updated_at=source.updated_at,
        )


class EventRepository:
    """Repository for Event operations."""

    def __init__(self, session: Session):
        self.session = session

    def create(self, event: EventCreate) -> EventRead:
        """Create new event."""
        db_event = Event(
            source_id=event.source_id,
            title=event.title,
            description=event.description,
            url=event.url,
            content_hash=event.content_hash,
            raw_content=event.raw_content,
            published_at=event.published_at,
        )
        self.session.add(db_event)
        self.session.flush()
        logger.info("event_created", event_id=str(db_event.id), title=event.title)
        return self._to_schema(db_event)

    def get_by_id(self, event_id: UUID) -> Optional[EventRead]:
        """Get event by ID."""
        db_event = self.session.query(Event).filter(Event.id == event_id).first()
        return self._to_schema(db_event) if db_event else None

    def get_by_content_hash(self, content_hash: str) -> Optional[EventRead]:
        """Get event by content hash (for deduplication)."""
        db_event = self.session.query(Event).filter(Event.content_hash == content_hash).first()
        return self._to_schema(db_event) if db_event else None

    def list_recent(
        self,
        limit: int = 100,
        offset: int = 0,
        status: Optional[EventStatus] = None,
        severity: Optional[EventSeverity] = None,
        since: Optional[datetime] = None,
        search: Optional[str] = None,
    ) -> List[EventRead]:
        """List recent events with filters."""
        query = self.session.query(Event)

        if status:
            query = query.filter(Event.status == status)
        if severity:
            query = query.filter(Event.severity == severity)
        if since:
            query = query.filter(Event.published_at >= since)
        if search:
            term = f"%{search}%"
            query = query.filter(
                Event.title.ilike(term) | Event.description.ilike(term)
            )

        events = query.order_by(desc(Event.published_at)).limit(limit).offset(offset).all()
        return [self._to_schema(e) for e in events]

    def update_status(self, event_id: UUID, status: EventStatus) -> None:
        """Update event processing status."""
        self.session.query(Event).filter(Event.id == event_id).update({"status": status})

    def update_enrichment(
        self,
        event_id: UUID,
        location: Optional[LocationSchema] = None,
        entities: Optional[list] = None,
        tags: Optional[List[str]] = None,
        severity: Optional[EventSeverity] = None,
        risk_score: Optional[float] = None,
        categories: Optional[List[str]] = None,
        actors: Optional[List[str]] = None,
        themes: Optional[List[str]] = None,
        llm_significance: Optional[str] = None,
    ) -> None:
        """Update event with enriched data."""
        updates = {"status": EventStatus.ENRICHED}

        if location:
            updates["location"] = location.model_dump()
            # Create PostGIS point
            updates["location_point"] = f"SRID=4326;POINT({location.longitude} {location.latitude})"

        if entities:
            updates["entities"] = [e.model_dump() if hasattr(e, "model_dump") else e for e in entities]

        if tags:
            updates["tags"] = tags

        if severity:
            updates["severity"] = severity

        if risk_score is not None:
            updates["risk_score"] = risk_score

        if categories is not None:
            updates["categories"] = categories

        if actors is not None:
            updates["actors"] = actors

        if themes is not None:
            updates["themes"] = themes

        if llm_significance is not None:
            updates["llm_significance"] = llm_significance

        self.session.query(Event).filter(Event.id == event_id).update(updates)

    def update_llm_data(
        self,
        event_id: UUID,
        categories: List[str],
        actors: List[str],
        themes: List[str],
        llm_significance: str,
    ) -> None:
        """Update event with LLM-extracted semantic data."""
        from datetime import datetime
        self.session.query(Event).filter(Event.id == event_id).update({
            "categories": categories,
            "actors": actors,
            "themes": themes,
            "llm_significance": llm_significance,
            "llm_processed_at": datetime.utcnow(),
        })

    def list_by_categories(
        self,
        categories: List[str],
        limit: int = 50,
        exclude_id: Optional[UUID] = None,
    ) -> List[EventRead]:
        """Find events sharing any of the given categories."""
        query = self.session.query(Event).filter(
            Event.categories.overlap(categories)
        )
        if exclude_id:
            query = query.filter(Event.id != exclude_id)
        events = query.order_by(desc(Event.published_at)).limit(limit).all()
        return [self._to_schema(e) for e in events]

    def list_by_actors(
        self,
        actors: List[str],
        limit: int = 50,
        exclude_id: Optional[UUID] = None,
    ) -> List[EventRead]:
        """Find events sharing any of the given actors."""
        query = self.session.query(Event).filter(
            Event.actors.overlap(actors)
        )
        if exclude_id:
            query = query.filter(Event.id != exclude_id)
        events = query.order_by(desc(Event.published_at)).limit(limit).all()
        return [self._to_schema(e) for e in events]

    def list_unprocessed_by_llm(
        self, limit: int = 50
    ) -> List[EventRead]:
        """Find events that haven't been processed by the LLM yet."""
        events = (
            self.session.query(Event)
            .filter(Event.llm_processed_at.is_(None))
            .filter(Event.status != EventStatus.FAILED)
            .order_by(desc(Event.published_at))
            .limit(limit)
            .all()
        )
        return [self._to_schema(e) for e in events]

    def count_by_status(self) -> dict[EventStatus, int]:
        """Count events grouped by status."""
        results = (
            self.session.query(Event.status, func.count(Event.id))
            .group_by(Event.status)
            .all()
        )
        return {status: count for status, count in results}

    def _to_schema(self, event: Event) -> EventRead:
        """Convert SQLAlchemy model to Pydantic schema."""
        location = None
        if event.location:
            location = LocationSchema(**event.location)

        entities = []
        if event.entities:
            from packages.shared.schemas import EntitySchema
            entities = [EntitySchema(**e) for e in event.entities]

        return EventRead(
            id=event.id,
            source_id=event.source_id,
            title=event.title,
            description=event.description,
            url=event.url,
            published_at=event.published_at,
            content_hash=event.content_hash,
            status=event.status,
            severity=event.severity,
            location=location,
            entities=entities,
            tags=event.tags or [],
            risk_score=event.risk_score,
            categories=event.categories or [],
            actors=event.actors or [],
            themes=event.themes or [],
            llm_significance=event.llm_significance,
            llm_processed_at=event.llm_processed_at,
            created_at=event.created_at,
            updated_at=event.updated_at,
        )


class AlertRepository:
    """Repository for Alert operations."""

    def __init__(self, session: Session):
        self.session = session

    def create(self, alert: AlertCreate) -> AlertRead:
        """Create new alert."""
        db_alert = Alert(
            event_id=alert.event_id,
            title=alert.title,
            description=alert.description,
            severity=alert.severity,
        )
        self.session.add(db_alert)
        self.session.flush()
        logger.info("alert_created", alert_id=str(db_alert.id), title=alert.title)
        return self._to_schema(db_alert)

    def get_by_id(self, alert_id: UUID) -> Optional[AlertRead]:
        """Get alert by ID."""
        db_alert = self.session.query(Alert).filter(Alert.id == alert_id).first()
        return self._to_schema(db_alert) if db_alert else None

    def list_recent(
        self,
        limit: int = 100,
        offset: int = 0,
        acknowledged: Optional[bool] = None,
        severity: Optional[EventSeverity] = None,
    ) -> List[AlertRead]:
        """List recent alerts with filters."""
        query = self.session.query(Alert)

        if acknowledged is not None:
            query = query.filter(Alert.acknowledged == acknowledged)
        if severity:
            query = query.filter(Alert.severity == severity)

        alerts = query.order_by(desc(Alert.created_at)).limit(limit).offset(offset).all()
        return [self._to_schema(a) for a in alerts]

    def acknowledge(self, alert_id: UUID) -> None:
        """Mark alert as acknowledged."""
        self.session.query(Alert).filter(Alert.id == alert_id).update({"acknowledged": True})

    def _to_schema(self, alert: Alert) -> AlertRead:
        """Convert SQLAlchemy model to Pydantic schema."""
        return AlertRead(
            id=alert.id,
            event_id=alert.event_id,
            title=alert.title,
            description=alert.description,
            severity=alert.severity,
            acknowledged=alert.acknowledged,
            created_at=alert.created_at,
        )
