"""
Database session management.
"""

from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from packages.shared.config import get_settings
from packages.shared.logging import get_logger

logger = get_logger(__name__)


class DatabaseManager:
    """Manages database connections and sessions."""

    def __init__(self):
        settings = get_settings()
        self.engine = create_engine(
            settings.database.url,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            echo=False,
        )
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        logger.info("database_manager_initialized", url=settings.database.url.split("@")[-1])

    @contextmanager
    def get_session(self) -> Generator[Session, None, None]:
        """
        Context manager for database sessions.

        Yields:
            SQLAlchemy session

        Example:
            with db_manager.get_session() as session:
                session.query(Event).all()
        """
        session = self.SessionLocal()
        try:
            yield session
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error("database_session_error", error=str(e))
            raise
        finally:
            session.close()

    def create_all(self):
        """Create all tables (for development only)."""
        from .models import Base

        Base.metadata.create_all(bind=self.engine)
        logger.info("database_tables_created")

    def drop_all(self):
        """Drop all tables (for testing only)."""
        from .models import Base

        Base.metadata.drop_all(bind=self.engine)
        logger.info("database_tables_dropped")


# Global instance
_db_manager: DatabaseManager | None = None


def get_db_manager() -> DatabaseManager:
    """Get or create global database manager instance."""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager


def get_db_session() -> Generator[Session, None, None]:
    """
    Dependency for FastAPI to inject database sessions.

    Yields:
        SQLAlchemy session
    """
    db_manager = get_db_manager()
    with db_manager.get_session() as session:
        yield session
