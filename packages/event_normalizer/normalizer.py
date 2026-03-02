"""
Event normalization and enrichment logic.
"""

import re
from typing import List, Optional, Tuple

from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

from packages.shared.logging import get_logger
from packages.shared.schemas import EntitySchema, EventRead, EventSeverity, LocationSchema

logger = get_logger(__name__)


class EventNormalizer:
    """Normalizes and enriches events with extracted data."""

    def __init__(self):
        self.geocoder = Nominatim(user_agent="worlddash/1.0")
        self.military_keywords = self._load_military_keywords()
        self.country_patterns = self._compile_country_patterns()

    def normalize(self, event: EventRead) -> dict:
        """
        Normalize and enrich an event.

        Args:
            event: Event to normalize

        Returns:
            Dict with enriched data: {location, entities, tags, severity, risk_score}
        """
        logger.info("normalizing_event", event_id=str(event.id))

        text = self._get_event_text(event)

        # Extract components
        location = self._extract_location(text)
        entities = self._extract_entities(text)
        tags = self._generate_tags(text, event)
        severity = self._calculate_severity(text, tags)
        risk_score = self._calculate_risk_score(text, tags, severity)

        result = {
            "location": location,
            "entities": entities,
            "tags": tags,
            "severity": severity,
            "risk_score": risk_score,
        }

        logger.info(
            "event_normalized",
            event_id=str(event.id),
            has_location=location is not None,
            entity_count=len(entities),
            tag_count=len(tags),
            severity=severity.value if severity else None,
            risk_score=risk_score,
        )

        return result

    def _get_event_text(self, event: EventRead) -> str:
        """Combine event fields into searchable text."""
        parts = [event.title]
        if event.description:
            parts.append(event.description)
        return " ".join(parts)

    def _extract_location(self, text: str) -> Optional[LocationSchema]:
        """
        Extract geographic location from text.
        Uses pattern matching and geocoding.
        """
        # Try to find country mentions
        for pattern, country in self.country_patterns:
            if pattern.search(text):
                try:
                    location = self.geocoder.geocode(country, timeout=5)
                    if location:
                        return LocationSchema(
                            latitude=location.latitude,
                            longitude=location.longitude,
                            country=country,
                            confidence=0.6,  # Pattern-based extraction is medium confidence
                        )
                except (GeocoderTimedOut, GeocoderServiceError) as e:
                    logger.warning("geocoding_error", country=country, error=str(e))
                    continue

        return None

    def _extract_entities(self, text: str) -> List[EntitySchema]:
        """
        Extract named entities from text.
        Uses simple pattern-based extraction (can be replaced with NER later).
        """
        entities = []

        # Extract military units (simple pattern)
        military_unit_pattern = r'\b(?:[\d]+(?:st|nd|rd|th)?\s+(?:Brigade|Battalion|Regiment|Division|Corps|Fleet))\b'
        for match in re.finditer(military_unit_pattern, text, re.IGNORECASE):
            entities.append(
                EntitySchema(
                    text=match.group(0),
                    type="MILITARY_UNIT",
                    confidence=0.7,
                )
            )

        # Extract weapon systems (simple pattern)
        weapon_pattern = r'\b(?:F-\d+|MiG-\d+|Su-\d+|T-\d+|M1\s+Abrams|Javelin|HIMARS|Patriot)\b'
        for match in re.finditer(weapon_pattern, text, re.IGNORECASE):
            entities.append(
                EntitySchema(
                    text=match.group(0),
                    type="WEAPON_SYSTEM",
                    confidence=0.8,
                )
            )

        return entities

    def _generate_tags(self, text: str, event: EventRead) -> List[str]:
        """Generate tags based on content and keywords."""
        tags = set()

        text_lower = text.lower()

        # Military-related tags
        if any(kw in text_lower for kw in ["military", "army", "navy", "air force", "troops", "forces"]):
            tags.add("military")

        if any(kw in text_lower for kw in ["exercise", "drill", "training"]):
            tags.add("military_exercise")

        if any(kw in text_lower for kw in ["conflict", "combat", "battle", "fighting", "war"]):
            tags.add("conflict")

        if any(kw in text_lower for kw in ["strike", "attack", "bombing", "missile", "rocket"]):
            tags.add("kinetic_event")

        # Political tags
        if any(kw in text_lower for kw in ["sanction", "embargo", "diplomatic"]):
            tags.add("political")

        if any(kw in text_lower for kw in ["summit", "meeting", "conference", "talks"]):
            tags.add("diplomacy")

        # Security tags
        if any(kw in text_lower for kw in ["nuclear", "chemical", "biological"]):
            tags.add("wmd")

        if any(kw in text_lower for kw in ["cyber", "hacking", "malware"]):
            tags.add("cyber")

        # Movement tags
        if any(kw in text_lower for kw in ["deployment", "mobilization", "stationed"]):
            tags.add("force_movement")

        if any(kw in text_lower for kw in ["ship", "vessel", "fleet", "carrier"]):
            tags.add("naval")

        if any(kw in text_lower for kw in ["aircraft", "jet", "fighter", "bomber"]):
            tags.add("air")

        # Inherit tags from source
        if event.tags:
            tags.update(event.tags)

        return sorted(list(tags))

    def _calculate_severity(self, text: str, tags: List[str]) -> Optional[EventSeverity]:
        """Calculate event severity based on content."""
        text_lower = text.lower()

        # Critical indicators
        if any(kw in text_lower for kw in ["nuclear strike", "nuclear attack", "wmd attack"]):
            return EventSeverity.CRITICAL

        if any(kw in text_lower for kw in ["declaration of war", "invasion", "full-scale"]):
            return EventSeverity.CRITICAL

        # High severity indicators
        if any(kw in text_lower for kw in ["casualties", "killed", "dead", "destroyed"]):
            return EventSeverity.HIGH

        if "kinetic_event" in tags or "conflict" in tags:
            return EventSeverity.HIGH

        # Medium severity
        if "military_exercise" in tags or "force_movement" in tags:
            return EventSeverity.MEDIUM

        if "political" in tags or "diplomacy" in tags:
            return EventSeverity.MEDIUM

        # Default to low
        return EventSeverity.LOW

    def _calculate_risk_score(
        self,
        text: str,
        tags: List[str],
        severity: Optional[EventSeverity],
    ) -> float:
        """
        Calculate risk score 0.0 to 1.0.
        Simple heuristic scoring (can be replaced with ML model later).
        """
        score = 0.0

        # Base score from severity
        severity_scores = {
            EventSeverity.LOW: 0.2,
            EventSeverity.MEDIUM: 0.4,
            EventSeverity.HIGH: 0.7,
            EventSeverity.CRITICAL: 0.95,
        }
        if severity:
            score = severity_scores.get(severity, 0.2)

        # Adjust based on tags
        high_risk_tags = {"conflict", "kinetic_event", "wmd", "nuclear"}
        medium_risk_tags = {"military_exercise", "force_movement", "cyber"}

        high_risk_count = len(set(tags) & high_risk_tags)
        medium_risk_count = len(set(tags) & medium_risk_tags)

        score += high_risk_count * 0.1
        score += medium_risk_count * 0.05

        # Cap at 1.0
        return min(score, 1.0)

    def _load_military_keywords(self) -> List[str]:
        """Load military-related keywords."""
        return [
            "military",
            "army",
            "navy",
            "air force",
            "troops",
            "deployment",
            "exercise",
            "conflict",
            "war",
            "strike",
            "attack",
            "missile",
            "nuclear",
        ]

    def _compile_country_patterns(self) -> List[Tuple[re.Pattern, str]]:
        """Compile regex patterns for country detection."""
        countries = [
            "Russia",
            "China",
            "United States",
            "Ukraine",
            "Iran",
            "North Korea",
            "Israel",
            "Syria",
            "Taiwan",
            "Japan",
            "India",
            "Pakistan",
            "Turkey",
            "Saudi Arabia",
            "Yemen",
        ]

        return [(re.compile(rf'\b{re.escape(country)}\b', re.IGNORECASE), country) for country in countries]
