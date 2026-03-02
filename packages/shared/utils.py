"""
Common utilities and helper functions.
"""

import hashlib
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse


def generate_content_hash(content: str) -> str:
    """
    Generate SHA-256 hash of content for deduplication.

    Args:
        content: Text content to hash

    Returns:
        Hexadecimal hash string
    """
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def normalize_url(url: str) -> str:
    """
    Normalize URL for consistent comparison.

    Args:
        url: Raw URL string

    Returns:
        Normalized URL
    """
    parsed = urlparse(url)
    # Remove trailing slashes, convert to lowercase
    normalized = f"{parsed.scheme}://{parsed.netloc.lower()}{parsed.path.rstrip('/')}"
    if parsed.query:
        normalized += f"?{parsed.query}"
    return normalized


def parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    """
    Parse datetime string with multiple format support.

    Args:
        dt_str: Datetime string

    Returns:
        Parsed datetime or None
    """
    if not dt_str:
        return None

    from dateutil import parser

    try:
        return parser.parse(dt_str)
    except (ValueError, TypeError):
        return None


def truncate_text(text: str, max_length: int = 500, suffix: str = "...") -> str:
    """
    Truncate text to maximum length.

    Args:
        text: Input text
        max_length: Maximum length
        suffix: Suffix to add when truncated

    Returns:
        Truncated text
    """
    if len(text) <= max_length:
        return text
    return text[: max_length - len(suffix)] + suffix


def extract_domain(url: str) -> str:
    """
    Extract domain from URL.

    Args:
        url: Full URL

    Returns:
        Domain name
    """
    parsed = urlparse(url)
    return parsed.netloc.lower()


def safe_get(data: dict[str, Any], key: str, default: Any = None) -> Any:
    """
    Safely get value from dictionary with nested key support.

    Args:
        data: Dictionary to search
        key: Key path (supports dot notation like 'a.b.c')
        default: Default value if not found

    Returns:
        Value or default
    """
    keys = key.split(".")
    value = data

    for k in keys:
        if isinstance(value, dict):
            value = value.get(k)
        else:
            return default
        if value is None:
            return default

    return value if value is not None else default
