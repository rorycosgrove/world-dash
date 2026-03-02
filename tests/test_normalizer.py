"""
Tests for event normalizer.
"""

import pytest
from datetime import datetime
from uuid import uuid4

from packages.event_normalizer.normalizer import EventNormalizer
from packages.shared.schemas import EventRead, EventStatus


def test_normalize_event_with_military_keywords():
    """Test normalization detects military keywords."""
    normalizer = EventNormalizer()

    event = EventRead(
        id=uuid4(),
        source_id=uuid4(),
        title="Military Exercise in the Baltic Sea",
        description="NATO conducts large-scale military exercise involving 10,000 troops",
        url="https://example.com/news/1",
        published_at=datetime.utcnow(),
        status=EventStatus.RAW,
        tags=[],
        entities=[],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    result = normalizer.normalize(event)

    assert "military" in result["tags"]
    assert "military_exercise" in result["tags"]
    assert result["severity"] is not None


def test_normalize_event_with_location():
    """Test location extraction."""
    normalizer = EventNormalizer()

    event = EventRead(
        id=uuid4(),
        source_id=uuid4(),
        title="Incident in Russia",
        description="Military activity reported near the border",
        url="https://example.com/news/2",
        published_at=datetime.utcnow(),
        status=EventStatus.RAW,
        tags=[],
        entities=[],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    result = normalizer.normalize(event)

    assert result["location"] is not None
    assert result["location"].country == "Russia"


def test_risk_score_calculation():
    """Test risk score calculation."""
    normalizer = EventNormalizer()

    event = EventRead(
        id=uuid4(),
        source_id=uuid4(),
        title="Nuclear weapons test",
        description="Country conducts nuclear missile test",
        url="https://example.com/news/3",
        published_at=datetime.utcnow(),
        status=EventStatus.RAW,
        tags=[],
        entities=[],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    result = normalizer.normalize(event)

    # Nuclear-related events should have high risk score
    assert result["risk_score"] > 0.7
    assert "wmd" in result["tags"]
