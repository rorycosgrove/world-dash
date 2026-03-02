"""
Seed script to populate database with sample sources and data.
"""

import asyncio
from uuid import uuid4

from packages.shared.config import get_settings
from packages.shared.logging import configure_logging, get_logger
from packages.shared.schemas import SourceCreate, SourceType
from packages.storage.database import get_db_manager
from packages.storage.repositories import SourceRepository

configure_logging("seed", "INFO")
logger = get_logger(__name__)


# Sample RSS feed sources for geopolitical/military intelligence
SAMPLE_SOURCES = [
    {
        "name": "Defense News",
        "url": "https://www.defensenews.com/arc/outboundfeeds/rss/",
        "type": "rss",
        "tags": ["military", "defense"],
    },
    {
        "name": "Jane's Defence Weekly",
        "url": "https://www.janes.com/feeds/defence-industry",
        "type": "rss",
        "tags": ["military", "intelligence"],
    },
    {
        "name": "Military Times",
        "url": "https://www.militarytimes.com/arc/outboundfeeds/rss/",
        "type": "rss",
        "tags": ["military", "news"],
    },
    {
        "name": "The Diplomat - Security",
        "url": "https://thediplomat.com/feed/",
        "type": "rss",
        "tags": ["geopolitics", "security", "asia"],
    },
    {
        "name": "Breaking Defense",
        "url": "https://breakingdefense.com/feed/",
        "type": "rss",
        "tags": ["defense", "technology"],
    },
    {
        "name": "War on the Rocks",
        "url": "https://warontherocks.com/feed/",
        "type": "rss",
        "tags": ["analysis", "strategy", "military"],
    },
    {
        "name": "CSIS - Security",
        "url": "https://www.csis.org/analysis/feed",
        "type": "rss",
        "tags": ["analysis", "policy", "security"],
    },
    {
        "name": "ISW - Russia Updates",
        "url": "https://www.understandingwar.org/rss.xml",
        "type": "rss",
        "tags": ["conflict", "russia", "ukraine"],
    },
    {
        "name": "Reuters - World News",
        "url": "https://www.reutersagency.com/feed/",
        "type": "rss",
        "tags": ["news", "global"],
    },
    {
        "name": "BBC News - World",
        "url": "http://feeds.bbci.co.uk/news/world/rss.xml",
        "type": "rss",
        "tags": ["news", "global"],
    },
    {
        "name": "Al Jazeera - News",
        "url": "https://www.aljazeera.com/xml/rss/all.xml",
        "type": "rss",
        "tags": ["news", "middle-east"],
    },
    {
        "name": "South China Morning Post - China",
        "url": "https://www.scmp.com/rss/91/feed",
        "type": "rss",
        "tags": ["china", "asia", "geopolitics"],
    },
    {
        "name": "Jamestown Foundation",
        "url": "https://jamestown.org/feed/",
        "type": "rss",
        "tags": ["analysis", "terrorism", "security"],
    },
    {
        "name": "IISS - Analysis",
        "url": "https://www.iiss.org/blogs/analysis/feed/",
        "type": "rss",
        "tags": ["analysis", "strategic", "military"],
    },
    {
        "name": "Foreign Policy - Security",
        "url": "https://foreignpolicy.com/feed/",
        "type": "rss",
        "tags": ["policy", "geopolitics", "analysis"],
    },
]


async def seed_sources():
    """Seed database with sample sources."""
    logger.info("starting_seed", source_count=len(SAMPLE_SOURCES))

    db_manager = get_db_manager()

    with db_manager.get_session() as session:
        repo = SourceRepository(session)

        created_count = 0
        skipped_count = 0

        for source_data in SAMPLE_SOURCES:
            # Check if source already exists
            existing = repo.get_by_url(source_data["url"])
            if existing:
                logger.info("source_exists", name=source_data["name"])
                skipped_count += 1
                continue

            # Create source
            source = SourceCreate(**source_data)
            repo.create(source)
            created_count += 1
            logger.info("source_created", name=source_data["name"])

        session.commit()

    logger.info(
        "seed_complete",
        created=created_count,
        skipped=skipped_count,
        total=len(SAMPLE_SOURCES),
    )


def main():
    """Main entry point."""
    # Ensure database is created
    db_manager = get_db_manager()
    
    logger.info("Running database migrations...")
    import subprocess
    subprocess.run(["alembic", "upgrade", "head"], check=True)

    # Seed sources
    asyncio.run(seed_sources())
    logger.info("Seed complete!")


if __name__ == "__main__":
    main()
