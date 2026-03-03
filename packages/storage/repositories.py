"""
Repository pattern implementation for data access.
Provides clean abstraction over SQLAlchemy queries.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy import and_, desc, func, text
from sqlalchemy.orm import Session

from packages.shared.logging import get_logger
from packages.shared.schemas import (
    AlertCreate,
    AlertRead,
    ChatMessageRead,
    ChatSessionRead,
    ClusterCreate,
    ClusterDetail,
    ClusterRead,
    EventCreate,
    EventRead,
    EventSeverity,
    EventStatus,
    LocationSchema,
    SourceCreate,
    SourceRead,
)

from .models import Alert, ChatMessage, Cluster, ClusterEvent, Event, Source

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

    def list_unembedded(self, limit: int = 50) -> List[EventRead]:
        """Find events that have LLM data but no embeddings yet."""
        events = (
            self.session.query(Event)
            .filter(Event.llm_processed_at.isnot(None))
            .filter(Event.embedded_at.is_(None))
            .filter(Event.status != EventStatus.FAILED)
            .order_by(desc(Event.published_at))
            .limit(limit)
            .all()
        )
        return [self._to_schema(e) for e in events]

    def store_embedding(
        self, event_id: UUID, embedding: list[float]
    ) -> None:
        """Store a vector embedding for an event."""
        self.session.query(Event).filter(Event.id == event_id).update({
            "embedding": embedding,
            "embedded_at": datetime.utcnow(),
        })

    def find_similar(
        self,
        embedding: list[float],
        limit: int = 20,
        exclude_id: Optional[UUID] = None,
        min_similarity: float = 0.5,
    ) -> List[dict]:
        """Find events similar to a given embedding vector using cosine distance.

        Returns list of dicts with event + similarity score.
        """
        # pgvector cosine distance: 1 - cosine_similarity
        # So lower distance = more similar. We want similarity > min_similarity
        # which means distance < (1 - min_similarity).
        max_distance = 1.0 - min_similarity

        query = (
            self.session.query(
                Event,
                Event.embedding.cosine_distance(embedding).label("distance"),
            )
            .filter(Event.embedding.isnot(None))
        )

        if exclude_id:
            query = query.filter(Event.id != exclude_id)

        query = query.filter(
            Event.embedding.cosine_distance(embedding) < max_distance
        )

        results = (
            query
            .order_by("distance")
            .limit(limit)
            .all()
        )

        return [
            {
                "event": self._to_schema(event),
                "similarity": round(1.0 - distance, 4),
            }
            for event, distance in results
        ]

    def find_similar_to_event(
        self,
        event_id: UUID,
        limit: int = 20,
        min_similarity: float = 0.5,
    ) -> List[dict]:
        """Find events similar to an existing event by its stored embedding."""
        event = self.session.query(Event).filter(Event.id == event_id).first()
        if not event or event.embedding is None:
            return []

        return self.find_similar(
            embedding=list(event.embedding),
            limit=limit,
            exclude_id=event_id,
            min_similarity=min_similarity,
        )

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


class ClusterRepository:
    """Repository for Cluster operations."""

    def __init__(self, session: Session):
        self.session = session

    def create(self, cluster: ClusterCreate, event_ids: Optional[List[UUID]] = None) -> ClusterRead:
        """Create a new cluster, optionally with initial events."""
        db_cluster = Cluster(
            label=cluster.label,
            summary=cluster.summary,
            keywords=cluster.keywords,
            auto_generated=cluster.auto_generated,
            pinned=cluster.pinned,
        )
        self.session.add(db_cluster)
        self.session.flush()

        if event_ids:
            for eid in event_ids:
                ce = ClusterEvent(cluster_id=db_cluster.id, event_id=eid)
                self.session.add(ce)
            self.session.flush()

        logger.info("cluster_created", cluster_id=str(db_cluster.id), label=cluster.label)
        return self._to_schema(db_cluster)

    def get_by_id(self, cluster_id: UUID) -> Optional[ClusterRead]:
        """Get cluster by ID."""
        db = self.session.query(Cluster).filter(Cluster.id == cluster_id).first()
        return self._to_schema(db) if db else None

    def get_detail(self, cluster_id: UUID) -> Optional[ClusterDetail]:
        """Get cluster with its events."""
        db = self.session.query(Cluster).filter(Cluster.id == cluster_id).first()
        if not db:
            return None

        event_repo = EventRepository(self.session)
        events = []
        for ce in db.cluster_events:
            event = event_repo.get_by_id(ce.event_id)
            if event:
                events.append(event)

        return ClusterDetail(
            id=db.id,
            label=db.label,
            summary=db.summary,
            keywords=db.keywords or [],
            auto_generated=db.auto_generated,
            pinned=db.pinned,
            event_count=len(events),
            events=events,
            created_at=db.created_at,
            updated_at=db.updated_at,
        )

    def list_all(self, limit: int = 50, offset: int = 0, pinned_only: bool = False) -> List[ClusterRead]:
        """List clusters."""
        query = self.session.query(Cluster)
        if pinned_only:
            query = query.filter(Cluster.pinned == True)
        clusters = query.order_by(desc(Cluster.updated_at)).limit(limit).offset(offset).all()
        return [self._to_schema(c) for c in clusters]

    def add_events(self, cluster_id: UUID, event_ids: List[UUID], similarities: Optional[List[float]] = None) -> int:
        """Add events to a cluster. Returns count added."""
        added = 0
        for i, eid in enumerate(event_ids):
            existing = (
                self.session.query(ClusterEvent)
                .filter(ClusterEvent.cluster_id == cluster_id, ClusterEvent.event_id == eid)
                .first()
            )
            if not existing:
                sim = similarities[i] if similarities and i < len(similarities) else None
                ce = ClusterEvent(cluster_id=cluster_id, event_id=eid, similarity=sim)
                self.session.add(ce)
                added += 1
        if added:
            self.session.flush()
        return added

    def remove_event(self, cluster_id: UUID, event_id: UUID) -> bool:
        """Remove an event from a cluster."""
        deleted = (
            self.session.query(ClusterEvent)
            .filter(ClusterEvent.cluster_id == cluster_id, ClusterEvent.event_id == event_id)
            .delete()
        )
        return deleted > 0

    def update(self, cluster_id: UUID, label: Optional[str] = None,
               summary: Optional[str] = None, pinned: Optional[bool] = None) -> Optional[ClusterRead]:
        """Update cluster metadata."""
        updates = {}
        if label is not None:
            updates["label"] = label
        if summary is not None:
            updates["summary"] = summary
        if pinned is not None:
            updates["pinned"] = pinned
        if updates:
            self.session.query(Cluster).filter(Cluster.id == cluster_id).update(updates)
            self.session.flush()
        return self.get_by_id(cluster_id)

    def update_centroid(self, cluster_id: UUID, centroid: List[float]) -> None:
        """Update the cluster centroid embedding."""
        self.session.query(Cluster).filter(Cluster.id == cluster_id).update({"centroid": centroid})

    def delete(self, cluster_id: UUID) -> bool:
        """Delete a cluster and its associations."""
        deleted = self.session.query(Cluster).filter(Cluster.id == cluster_id).delete()
        return deleted > 0

    def delete_auto_generated(self) -> int:
        """Delete all auto-generated (non-pinned) clusters."""
        deleted = (
            self.session.query(Cluster)
            .filter(Cluster.auto_generated == True, Cluster.pinned == False)
            .delete()
        )
        return deleted

    def _to_schema(self, cluster: Cluster) -> ClusterRead:
        """Convert SQLAlchemy model to Pydantic schema."""
        event_count = len(cluster.cluster_events) if cluster.cluster_events else 0
        return ClusterRead(
            id=cluster.id,
            label=cluster.label,
            summary=cluster.summary,
            keywords=cluster.keywords or [],
            auto_generated=cluster.auto_generated,
            pinned=cluster.pinned,
            event_count=event_count,
            created_at=cluster.created_at,
            updated_at=cluster.updated_at,
        )


class ChatMessageRepository:
    """Repository for ChatMessage operations."""

    def __init__(self, session: Session):
        self.session = session

    def create(self, session_id: str, role: str, content: str,
               context_event_id: Optional[UUID] = None,
               context_cluster_id: Optional[UUID] = None,
               metadata_json: Optional[dict] = None,
               embedding: Optional[list] = None) -> ChatMessageRead:
        """Create a new chat message."""
        db_msg = ChatMessage(
            session_id=session_id,
            role=role,
            content=content,
            context_event_id=context_event_id,
            context_cluster_id=context_cluster_id,
            metadata_json=metadata_json,
            embedding=embedding,
        )
        self.session.add(db_msg)
        self.session.flush()
        return self._to_schema(db_msg)

    def list_by_session(self, session_id: str, limit: int = 100) -> List[ChatMessageRead]:
        """Get all messages in a chat session, ordered by creation time."""
        msgs = (
            self.session.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at)
            .limit(limit)
            .all()
        )
        return [self._to_schema(m) for m in msgs]

    def list_sessions(self, limit: int = 50) -> List[ChatSessionRead]:
        """List chat sessions with message counts."""
        results = (
            self.session.query(
                ChatMessage.session_id,
                func.count(ChatMessage.id).label("message_count"),
                func.min(ChatMessage.created_at).label("first_message_at"),
                func.max(ChatMessage.created_at).label("last_message_at"),
            )
            .group_by(ChatMessage.session_id)
            .order_by(desc("last_message_at"))
            .limit(limit)
            .all()
        )
        return [
            ChatSessionRead(
                session_id=r.session_id,
                message_count=r.message_count,
                first_message_at=r.first_message_at,
                last_message_at=r.last_message_at,
            )
            for r in results
        ]

    def delete_session(self, session_id: str) -> int:
        """Delete all messages in a session."""
        return self.session.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()

    def store_embedding(self, message_id: UUID, embedding: List[float]) -> None:
        """Store an embedding vector for a chat message."""
        self.session.query(ChatMessage).filter(ChatMessage.id == message_id).update(
            {"embedding": embedding}
        )

    def find_similar_messages(
        self,
        embedding: List[float],
        limit: int = 5,
        min_similarity: float = 0.5,
        session_id: Optional[str] = None,
        role: str = "assistant",
    ) -> List[dict]:
        """Find chat messages similar to an embedding (cosine similarity)."""
        max_distance = 1.0 - min_similarity
        query = (
            self.session.query(
                ChatMessage,
                (1.0 - ChatMessage.embedding.cosine_distance(embedding)).label("similarity"),
            )
            .filter(
                ChatMessage.embedding.isnot(None),
                ChatMessage.embedding.cosine_distance(embedding) <= max_distance,
                ChatMessage.role == role,
            )
        )
        if session_id:
            query = query.filter(ChatMessage.session_id == session_id)
        results = query.order_by(text("similarity DESC")).limit(limit).all()
        return [
            {"message": self._to_schema(r[0]), "similarity": float(r[1])}
            for r in results
        ]

    def list_unembedded(self, limit: int = 50, role: str = "assistant") -> List[ChatMessageRead]:
        """List messages without embeddings."""
        msgs = (
            self.session.query(ChatMessage)
            .filter(ChatMessage.embedding.is_(None), ChatMessage.role == role)
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
            .all()
        )
        return [self._to_schema(m) for m in msgs]

    def _to_schema(self, msg: ChatMessage) -> ChatMessageRead:
        """Convert SQLAlchemy model to Pydantic schema."""
        return ChatMessageRead(
            id=msg.id,
            session_id=msg.session_id,
            role=msg.role,
            content=msg.content,
            context_event_id=msg.context_event_id,
            context_cluster_id=msg.context_cluster_id,
            metadata_json=msg.metadata_json,
            created_at=msg.created_at,
        )
