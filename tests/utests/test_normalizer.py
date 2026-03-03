"""
Tests for event normalizer.
"""

from datetime import datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

from packages.event_normalizer.normalizer import EventNormalizer
from packages.shared.schemas import EventRead, EventStatus


def _make_mock_geocoder():
    """Create a mock geocoder that returns predictable results."""
    mock_geocoder = MagicMock()

    def geocode_side_effect(country, timeout=5):
        # Return realistic lat/lon for known countries
        coords = {
            "Russia": (61.524, 105.3188),
            "China": (35.8617, 104.1954),
            "United States": (37.0902, -95.7129),
            "Ukraine": (48.3794, 31.1656),
            "Iran": (32.4279, 53.6880),
            "North Korea": (40.3399, 127.5101),
            "Israel": (31.0461, 34.8516),
        }
        if country in coords:
            loc = MagicMock()
            loc.latitude = coords[country][0]
            loc.longitude = coords[country][1]
            return loc
        return None

    mock_geocoder.geocode = MagicMock(side_effect=geocode_side_effect)
    return mock_geocoder


@patch("packages.event_normalizer.normalizer.Nominatim")
def test_normalize_event_with_military_keywords(mock_nominatim_cls):
    """Test normalization detects military keywords."""
    mock_nominatim_cls.return_value = _make_mock_geocoder()
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


@patch("packages.event_normalizer.normalizer.Nominatim")
def test_normalize_event_with_location(mock_nominatim_cls):
    """Test location extraction."""
    mock_nominatim_cls.return_value = _make_mock_geocoder()
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


@patch("packages.event_normalizer.normalizer.Nominatim")
def test_risk_score_calculation(mock_nominatim_cls):
    """Test risk score calculation."""
    mock_nominatim_cls.return_value = _make_mock_geocoder()
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
