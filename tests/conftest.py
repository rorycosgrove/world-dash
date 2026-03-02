"""
Test configuration and fixtures.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from packages.storage.models import Base
from packages.storage.database import DatabaseManager


# ---------------------------------------------------------------------------
# SQLite compatibility shims for PostgreSQL-specific column types
# ---------------------------------------------------------------------------
# The production models use ARRAY, JSONB, Geometry (PostGIS), and UUID types
# that are not natively supported by SQLite.  We register compile-time hooks
# so that table creation and basic queries work during tests.
# ---------------------------------------------------------------------------

from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from geoalchemy2 import Geometry


@compiles(PG_UUID, "sqlite")
def compile_uuid_sqlite(type_, compiler, **kw):
    """Store UUIDs as CHAR(36) on SQLite."""
    return "CHAR(36)"


@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    """Store ARRAY columns as JSON text on SQLite."""
    return "TEXT"


@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    """Store JSONB as TEXT on SQLite."""
    return "TEXT"


@compiles(Geometry, "sqlite")
def compile_geometry_sqlite(type_, compiler, **kw):
    """Store Geometry as TEXT on SQLite (WKT representation)."""
    return "TEXT"


@pytest.fixture(scope="session")
def test_db_engine():
    """Create test database engine."""
    # Use in-memory SQLite for fast tests
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)


@pytest.fixture
def test_db_session(test_db_engine):
    """Create test database session."""
    Session = sessionmaker(bind=test_db_engine)
    session = Session()
    yield session
    session.rollback()
    session.close()


@pytest.fixture
def sample_source_data():
    """Sample source data for testing."""
    return {
        "name": "Test News Source",
        "url": "https://example.com/feed.xml",
        "type": "rss",
        "enabled": True,
        "tags": ["test", "news"],
    }


@pytest.fixture
def sample_event_data():
    """Sample event data for testing."""
    from datetime import datetime
    from uuid import uuid4

    return {
        "source_id": uuid4(),
        "title": "Test Military Exercise",
        "description": "Annual military exercise in the region",
        "url": "https://example.com/news/123",
        "content_hash": "abc123def456",
        "raw_content": "Full article content here",
        "published_at": datetime.utcnow(),
    }
