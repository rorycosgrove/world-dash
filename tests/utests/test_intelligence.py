"""
Tests for intelligence engine.
"""

from datetime import datetime
from uuid import uuid4

from packages.intelligence_engine.engine import IntelligenceEngine
from packages.shared.schemas import EventRead, EventStatus, EventSeverity


def test_analyze_critical_event():
    """Test that critical events trigger alerts."""
    engine = IntelligenceEngine()

    event = EventRead(
        id=uuid4(),
        source_id=uuid4(),
        title="Nuclear Strike Warning",
        description="Emergency alert issued",
        url="https://example.com/alert/1",
        published_at=datetime.utcnow(),
        status=EventStatus.ENRICHED,
        severity=EventSeverity.CRITICAL,
        risk_score=0.95,
        tags=["wmd", "nuclear"],
        entities=[],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    alerts = engine.analyze(event)

    assert len(alerts) > 0
    # Should trigger both critical risk and WMD alerts
    assert any(a.severity == EventSeverity.CRITICAL for a in alerts)


def test_analyze_low_risk_event():
    """Test that low-risk events don't trigger alerts."""
    engine = IntelligenceEngine()

    event = EventRead(
        id=uuid4(),
        source_id=uuid4(),
        title="Routine diplomatic meeting",
        description="Standard bilateral talks",
        url="https://example.com/news/1",
        published_at=datetime.utcnow(),
        status=EventStatus.ENRICHED,
        severity=EventSeverity.LOW,
        risk_score=0.2,
        tags=["diplomacy"],
        entities=[],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    alerts = engine.analyze(event)

    # Low-risk diplomatic events shouldn't trigger alerts
    assert len(alerts) == 0


def test_cluster_related_events():
    """Test event clustering by tag similarity."""
    engine = IntelligenceEngine()

    events = [
        EventRead(
            id=uuid4(),
            source_id=uuid4(),
            title="Event 1",
            description="Test",
            url="https://example.com/1",
            published_at=datetime.utcnow(),
            status=EventStatus.ENRICHED,
            tags=["military", "naval", "china"],
            entities=[],
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
        EventRead(
            id=uuid4(),
            source_id=uuid4(),
            title="Event 2",
            description="Test",
            url="https://example.com/2",
            published_at=datetime.utcnow(),
            status=EventStatus.ENRICHED,
            tags=["military", "naval", "china"],  # Same tags
            entities=[],
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
        EventRead(
            id=uuid4(),
            source_id=uuid4(),
            title="Event 3",
            description="Test",
            url="https://example.com/3",
            published_at=datetime.utcnow(),
            status=EventStatus.ENRICHED,
            tags=["diplomacy", "politics"],  # Different tags
            entities=[],
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
    ]

    clusters = engine.cluster_related_events(events)

    # Events 1 and 2 should be clustered together
    assert len(clusters) >= 1
    assert any(len(cluster) == 2 for cluster in clusters)
