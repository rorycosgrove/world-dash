"""
Tests for storage repositories.
"""

import pytest
from uuid import uuid4

from packages.shared.schemas import SourceCreate, EventCreate, EventStatus
from packages.storage.repositories import SourceRepository, EventRepository


class TestSourceRepository:
    """Tests for SourceRepository."""

    def test_create_source(self, test_db_session, sample_source_data):
        """Test creating a new source."""
        repo = SourceRepository(test_db_session)
        source = SourceCreate(**sample_source_data)

        created = repo.create(source)

        assert created.id is not None
        assert created.name == sample_source_data["name"]
        assert created.url == sample_source_data["url"]
        assert created.enabled is True

    def test_get_source_by_id(self, test_db_session, sample_source_data):
        """Test retrieving source by ID."""
        repo = SourceRepository(test_db_session)
        source = SourceCreate(**sample_source_data)
        created = repo.create(source)

        retrieved = repo.get_by_id(created.id)

        assert retrieved is not None
        assert retrieved.id == created.id
        assert retrieved.name == created.name

    def test_get_source_by_url(self, test_db_session, sample_source_data):
        """Test retrieving source by URL."""
        repo = SourceRepository(test_db_session)
        source = SourceCreate(**sample_source_data)
        repo.create(source)

        retrieved = repo.get_by_url(sample_source_data["url"])

        assert retrieved is not None
        assert retrieved.url == sample_source_data["url"]

    def test_list_enabled_sources(self, test_db_session, sample_source_data):
        """Test listing only enabled sources."""
        repo = SourceRepository(test_db_session)

        # Create enabled source
        enabled_source = SourceCreate(**sample_source_data)
        repo.create(enabled_source)

        # Create disabled source
        disabled_data = sample_source_data.copy()
        disabled_data["url"] = "https://example.com/disabled.xml"
        disabled_data["enabled"] = False
        disabled_source = SourceCreate(**disabled_data)
        repo.create(disabled_source)

        enabled_list = repo.list_enabled()

        assert len(enabled_list) == 1
        assert enabled_list[0].enabled is True


class TestEventRepository:
    """Tests for EventRepository."""

    def test_create_event(self, test_db_session, sample_source_data, sample_event_data):
        """Test creating a new event."""
        # Create source first
        source_repo = SourceRepository(test_db_session)
        source = source_repo.create(SourceCreate(**sample_source_data))

        # Create event
        sample_event_data["source_id"] = source.id
        event_repo = EventRepository(test_db_session)
        event = EventCreate(**sample_event_data)
        created = event_repo.create(event)

        assert created.id is not None
        assert created.title == sample_event_data["title"]
        assert created.status == EventStatus.RAW

    def test_get_by_content_hash(self, test_db_session, sample_source_data, sample_event_data):
        """Test retrieving event by content hash (deduplication)."""
        source_repo = SourceRepository(test_db_session)
        source = source_repo.create(SourceCreate(**sample_source_data))

        sample_event_data["source_id"] = source.id
        event_repo = EventRepository(test_db_session)
        event = EventCreate(**sample_event_data)
        created = event_repo.create(event)

        retrieved = event_repo.get_by_content_hash(sample_event_data["content_hash"])

        assert retrieved is not None
        assert retrieved.id == created.id
        assert retrieved.content_hash == sample_event_data["content_hash"]

    def test_list_recent_events(self, test_db_session, sample_source_data, sample_event_data):
        """Test listing recent events."""
        source_repo = SourceRepository(test_db_session)
        source = source_repo.create(SourceCreate(**sample_source_data))

        sample_event_data["source_id"] = source.id
        event_repo = EventRepository(test_db_session)

        # Create multiple events
        for i in range(3):
            data = sample_event_data.copy()
            data["content_hash"] = f"hash_{i}"
            data["title"] = f"Event {i}"
            event_repo.create(EventCreate(**data))

        events = event_repo.list_recent(limit=10)

        assert len(events) == 3
