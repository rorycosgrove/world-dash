"""
Feed parser for RSS and Atom feeds.
"""

from datetime import datetime
from typing import List, Optional

import feedparser
import httpx
from dateutil import parser as date_parser

from packages.shared.config import get_settings
from packages.shared.logging import get_logger
from packages.shared.schemas import EventCreate, SourceRead
from packages.shared.utils import generate_content_hash, normalize_url, parse_datetime

logger = get_logger(__name__)


class FeedEntry:
    """Parsed feed entry/item."""

    def __init__(
        self,
        title: str,
        url: str,
        published_at: datetime,
        description: Optional[str] = None,
        content: Optional[str] = None,
    ):
        self.title = title
        self.url = url
        self.published_at = published_at
        self.description = description
        self.content = content

    def to_event_create(self, source_id) -> EventCreate:
        """Convert to EventCreate schema."""
        # Use content if available, otherwise description
        raw_content = self.content or self.description or ""
        content_hash = generate_content_hash(f"{self.url}:{self.title}:{raw_content[:1000]}")

        return EventCreate(
            title=self.title[:500],  # Truncate to model limit
            description=self.description[:5000] if self.description else None,
            url=normalize_url(self.url),
            published_at=self.published_at,
            source_id=source_id,
            raw_content=raw_content[:10000],  # Limit raw content size
            content_hash=content_hash,
        )


class FeedParser:
    """Parser for RSS and Atom feeds."""

    def __init__(self):
        settings = get_settings()
        self.timeout = settings.ingestion.request_timeout_seconds
        self.user_agent = settings.ingestion.user_agent
        self.client = httpx.Client(
            timeout=self.timeout,
            headers={"User-Agent": self.user_agent},
            follow_redirects=True,
        )

    def parse(self, source: SourceRead, auth_header: str = None, auth_token: str = None) -> List[FeedEntry]:
        """
        Parse feed from source.

        Args:
            source: Source configuration
            auth_header: Optional HTTP header name for authentication (e.g. "Authorization")
            auth_token: Optional token value for the auth header (e.g. "Bearer sk-...")

        Returns:
            List of parsed feed entries

        Raises:
            httpx.HTTPError: If request fails
            ValueError: If feed parsing fails
        """
        logger.info("parsing_feed", source_id=str(source.id), url=source.url)

        try:
            # Build request headers, including auth if provided
            headers = {}
            if auth_header and auth_token:
                headers[auth_header] = auth_token

            # Fetch feed
            response = self.client.get(source.url, headers=headers)
            response.raise_for_status()

            # Parse with feedparser
            feed = feedparser.parse(response.content)

            if feed.bozo and not feed.entries:
                raise ValueError(f"Feed parsing error: {feed.get('bozo_exception', 'Unknown error')}")

            entries = []
            for entry in feed.entries:
                parsed_entry = self._parse_entry(entry)
                if parsed_entry:
                    entries.append(parsed_entry)

            logger.info(
                "feed_parsed",
                source_id=str(source.id),
                url=source.url,
                entry_count=len(entries),
            )
            return entries

        except httpx.HTTPError as e:
            logger.error("feed_fetch_error", source_id=str(source.id), url=source.url, error=str(e))
            raise
        except Exception as e:
            logger.error("feed_parse_error", source_id=str(source.id), url=source.url, error=str(e))
            raise ValueError(f"Failed to parse feed: {e}")

    def _parse_entry(self, entry) -> Optional[FeedEntry]:
        """Parse individual feed entry."""
        try:
            # Extract title
            title = entry.get("title", "").strip()
            if not title:
                logger.warning("entry_missing_title", entry=str(entry)[:200])
                return None

            # Extract URL
            url = entry.get("link", "").strip()
            if not url:
                logger.warning("entry_missing_url", title=title)
                return None

            # Extract published date
            published_at = self._extract_date(entry)
            if not published_at:
                # Use current time if no date found
                published_at = datetime.utcnow()

            # Extract description/summary
            description = entry.get("summary", entry.get("description", "")).strip()

            # Extract content (some feeds have full content)
            content = None
            if "content" in entry and entry.content:
                content = entry.content[0].get("value", "").strip()
            elif "description" in entry:
                content = entry.description.strip()

            return FeedEntry(
                title=title,
                url=url,
                published_at=published_at,
                description=description or None,
                content=content or None,
            )

        except Exception as e:
            logger.warning("entry_parse_error", error=str(e), entry=str(entry)[:200])
            return None

    def _extract_date(self, entry) -> Optional[datetime]:
        """Extract and parse published date from entry."""
        # Try multiple date fields
        for field in ["published", "updated", "created", "pubDate"]:
            if field in entry and entry[field]:
                parsed = parse_datetime(entry[field])
                if parsed:
                    return parsed

        # Try parsed date fields (feedparser automatically parses some)
        for field in ["published_parsed", "updated_parsed"]:
            if field in entry and entry[field]:
                try:
                    from time import struct_time
                    import calendar

                    if isinstance(entry[field], struct_time):
                        return datetime.utcfromtimestamp(calendar.timegm(entry[field]))
                except Exception:
                    pass

        return None

    def close(self):
        """Close HTTP client."""
        self.client.close()
