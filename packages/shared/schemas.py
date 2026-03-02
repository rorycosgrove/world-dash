"""
Base Pydantic models and common schemas used across the application.
"""

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class EventStatus(str, Enum):
    """Event processing status."""

    RAW = "raw"
    NORMALIZED = "normalized"
    ENRICHED = "enriched"
    PROCESSED = "processed"
    FAILED = "failed"


class EventSeverity(str, Enum):
    """Event severity levels."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SourceType(str, Enum):
    """Feed source types."""

    RSS = "rss"
    ATOM = "atom"
    API = "api"
    MANUAL = "manual"


class BaseSchema(BaseModel):
    """Base schema with common fields."""

    class Config:
        from_attributes = True
        use_enum_values = True


class LocationSchema(BaseSchema):
    """Geographic location."""

    latitude: float = Field(..., ge=-90, le=90, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180, le=180, description="Longitude in decimal degrees")
    country: Optional[str] = Field(None, description="Country name")
    region: Optional[str] = Field(None, description="Region or state")
    city: Optional[str] = Field(None, description="City name")
    confidence: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Confidence in location extraction"
    )


class EntitySchema(BaseSchema):
    """Named entity extracted from event."""

    text: str = Field(..., description="Entity text")
    type: str = Field(..., description="Entity type (PERSON, ORG, GPE, etc.)")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0, description="Extraction confidence")


class EventBase(BaseSchema):
    """Base event schema."""

    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = Field(None, max_length=5000)
    url: str = Field(..., description="Original event URL")
    published_at: datetime = Field(..., description="Original publication timestamp")
    source_id: UUID = Field(..., description="Reference to source feed")


class EventCreate(EventBase):
    """Schema for creating new events."""

    raw_content: Optional[str] = Field(None, description="Original raw content")
    content_hash: str = Field(..., description="Hash for deduplication")


class EventRead(EventBase):
    """Schema for reading events."""

    id: UUID = Field(default_factory=uuid4)
    status: EventStatus = Field(default=EventStatus.RAW)
    severity: Optional[EventSeverity] = None
    location: Optional[LocationSchema] = None
    entities: list[EntitySchema] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    risk_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    # LLM-extracted semantic data
    categories: list[str] = Field(default_factory=list)
    actors: list[str] = Field(default_factory=list)
    themes: list[str] = Field(default_factory=list)
    llm_significance: Optional[str] = Field(None, description="LLM-assessed significance")
    llm_processed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SourceBase(BaseSchema):
    """Base source feed schema."""

    name: str = Field(..., min_length=1, max_length=200)
    url: str = Field(..., description="Feed URL")
    type: SourceType = Field(default=SourceType.RSS)
    enabled: bool = Field(default=True)
    tags: list[str] = Field(default_factory=list)


class SourceCreate(SourceBase):
    """Schema for creating new sources."""

    pass


class SourceRead(SourceBase):
    """Schema for reading sources."""

    id: UUID = Field(default_factory=uuid4)
    last_polled_at: Optional[datetime] = None
    last_success_at: Optional[datetime] = None
    last_error: Optional[str] = None
    error_count: int = Field(default=0)
    total_events: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AlertBase(BaseSchema):
    """Base alert schema."""

    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    severity: EventSeverity = Field(default=EventSeverity.MEDIUM)
    event_id: UUID = Field(..., description="Related event ID")


class AlertCreate(AlertBase):
    """Schema for creating alerts."""

    pass


class AlertRead(AlertBase):
    """Schema for reading alerts."""

    id: UUID = Field(default_factory=uuid4)
    acknowledged: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class HealthCheck(BaseSchema):
    """Health check response."""

    status: str = Field(default="healthy")
    service: str
    version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    dependencies: dict[str, str] = Field(default_factory=dict)
