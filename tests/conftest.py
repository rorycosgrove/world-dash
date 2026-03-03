"""
Test configuration and fixtures.
"""

import json
import sqlite3

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from packages.storage.models import Base
from packages.storage.database import DatabaseManager


# ---------------------------------------------------------------------------
# SQLite compatibility shims for PostgreSQL-specific column types
# ---------------------------------------------------------------------------
# The production models use ARRAY, JSONB, Geometry (PostGIS), UUID and Vector
# types that are not natively supported by SQLite.  We register:
#   1. compile-time hooks so DDL emits valid SQLite types
#   2. stub functions for SpatiaLite calls that GeoAlchemy2 fires at table
#      creation time (RecoverGeometryColumn, AddGeometryColumn, etc.)
#   3. sqlite3 adapters so Python lists/dicts bind correctly as JSON text
# ---------------------------------------------------------------------------

from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from geoalchemy2 import Geometry
from pgvector.sqlalchemy import Vector

# --- SQLite adapters: allow list and dict to bind as TEXT (JSON) -------------
sqlite3.register_adapter(list, lambda val: json.dumps(val))
sqlite3.register_adapter(dict, lambda val: json.dumps(val))


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


@compiles(Vector, "sqlite")
def compile_vector_sqlite(type_, compiler, **kw):
    """Store pgvector Vector as TEXT on SQLite."""
    return "TEXT"


# ---------------------------------------------------------------------------
# Register stub SpatiaLite functions so GeoAlchemy2's after_create listener
# does not crash on plain SQLite (no SpatiaLite extension loaded).
# Use -1 for nargs to accept any number of arguments.
# ---------------------------------------------------------------------------
_SPATIALITE_STUBS = [
    "RecoverGeometryColumn",
    "AddGeometryColumn",
    "DiscardGeometryColumn",
    "CreateSpatialIndex",
    "RecoverSpatialIndex",
    "DisableSpatialIndex",
    "CheckSpatialIndex",
    "InitSpatialMetaData",
    "UpdateLayerStatistics",
]

# Geometry conversion functions — must return None so GeoAlchemy2's result
# processors skip NULL values instead of trying to parse integer 1 as WKB.
_GEOMETRY_STUBS = [
    "GeomFromEWKT",
    "ST_GeomFromEWKT",
    "ST_GeomFromText",
    "GeomFromText",
    "AsEWKB",
    "ST_AsEWKB",
    "ST_AsText",
    "AsText",
    "ST_AsBinary",
    "AsBinary",
]


def _register_spatialite_stubs(dbapi_conn, connection_record):
    """Register no-op stubs for SpatiaLite functions on plain SQLite."""
    if isinstance(dbapi_conn, sqlite3.Connection):
        # DDL / management stubs — return truthy so GeoAlchemy2 is satisfied
        for fn_name in _SPATIALITE_STUBS:
            dbapi_conn.create_function(fn_name, -1, lambda *a: 1)
        # Geometry conversion stubs — return None so result processors skip them
        for fn_name in _GEOMETRY_STUBS:
            dbapi_conn.create_function(fn_name, -1, lambda *a: None)


@pytest.fixture(scope="session")
def test_db_engine():
    """Create test database engine."""
    # Use in-memory SQLite for fast tests
    engine = create_engine("sqlite:///:memory:", echo=False)

    # Register SpatiaLite stubs before any table creation
    event.listen(engine, "connect", _register_spatialite_stubs)

    # Force a new connection so the listener fires before create_all
    with engine.connect():
        pass

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
