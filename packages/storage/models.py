"""
SQLAlchemy database models.
"""

import uuid
from datetime import datetime
from typing import Optional

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Enum as SQLEnum,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from packages.shared.schemas import EventSeverity, EventStatus, SourceType

Base = declarative_base()


class Source(Base):
    """RSS/Feed source."""

    __tablename__ = "sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False, index=True)
    url = Column(String(2048), nullable=False, unique=True)
    type = Column(SQLEnum(SourceType, values_callable=lambda obj: [e.value for e in obj]), nullable=False, default=SourceType.RSS)
    enabled = Column(Boolean, nullable=False, default=True, index=True)
    tags = Column(ARRAY(String), nullable=False, default=list)

    # Polling metadata
    last_polled_at = Column(DateTime(timezone=True), nullable=True)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    error_count = Column(Integer, nullable=False, default=0)
    total_events = Column(Integer, nullable=False, default=0)

    # Authentication (optional, for feeds requiring API keys)
    auth_header = Column(String(200), nullable=True)  # e.g. "Authorization", "X-API-Key"
    auth_token = Column(Text, nullable=True)           # e.g. "Bearer sk-..."

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    events = relationship("Event", back_populates="source", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Source {self.name}>"


class Event(Base):
    """Normalized event from feeds."""

    __tablename__ = "events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(UUID(as_uuid=True), ForeignKey("sources.id"), nullable=False, index=True)

    # Core fields
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    url = Column(String(2048), nullable=False, index=True)
    content_hash = Column(String(64), nullable=False, unique=True, index=True)
    raw_content = Column(Text, nullable=True)

    # Processing metadata
    status = Column(
        SQLEnum(EventStatus, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=EventStatus.RAW,
        index=True,
    )
    severity = Column(SQLEnum(EventSeverity, values_callable=lambda obj: [e.value for e in obj]), nullable=True, index=True)
    risk_score = Column(Float, nullable=True, index=True)

    # Extracted data
    tags = Column(ARRAY(String), nullable=False, default=list)
    entities = Column(JSONB, nullable=True)  # Stores EntitySchema list as JSON
    location = Column(JSONB, nullable=True)  # Stores LocationSchema as JSON
    location_point = Column(Geometry("POINT", srid=4326), nullable=True, index=True)

    # LLM-extracted semantic data
    categories = Column(ARRAY(String), nullable=False, default=list)  # e.g. military, diplomatic
    actors = Column(ARRAY(String), nullable=False, default=list)      # key actors/entities
    themes = Column(ARRAY(String), nullable=False, default=list)      # overarching themes
    llm_significance = Column(String(20), nullable=True)              # low/medium/high/critical
    llm_processed_at = Column(DateTime(timezone=True), nullable=True) # when LLM last ran

    # Timestamps
    published_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    source = relationship("Source", back_populates="events")
    alerts = relationship("Alert", back_populates="event", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Event {self.title[:50]}>"


class Alert(Base):
    """Alerts triggered by intelligence engine."""

    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)

    # Alert details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(SQLEnum(EventSeverity, values_callable=lambda obj: [e.value for e in obj]), nullable=False, index=True)
    acknowledged = Column(Boolean, nullable=False, default=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    event = relationship("Event", back_populates="alerts")

    def __repr__(self) -> str:
        return f"<Alert {self.title}>"
