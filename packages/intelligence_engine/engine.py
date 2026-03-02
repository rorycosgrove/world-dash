"""
Intelligence analysis engine.
"""

from typing import List, Optional
from uuid import UUID

from packages.shared.logging import get_logger
from packages.shared.schemas import AlertCreate, EventRead, EventSeverity

logger = get_logger(__name__)


class IntelligenceEngine:
    """Analyzes events and generates alerts based on rules."""

    def __init__(self):
        self.alert_rules = self._load_alert_rules()

    def analyze(self, event: EventRead) -> List[AlertCreate]:
        """
        Analyze event and generate alerts if rules match.

        Args:
            event: Event to analyze

        Returns:
            List of alerts to create
        """
        logger.info("analyzing_event", event_id=str(event.id))

        alerts = []

        # Check each rule
        for rule in self.alert_rules:
            if self._check_rule(event, rule):
                alert = self._create_alert_from_rule(event, rule)
                alerts.append(alert)
                logger.info(
                    "alert_triggered",
                    event_id=str(event.id),
                    rule_name=rule["name"],
                    severity=alert.severity,
                )

        return alerts

    def _check_rule(self, event: EventRead, rule: dict) -> bool:
        """Check if event matches alert rule."""
        # Check severity threshold
        if rule.get("min_severity"):
            severity_order = [EventSeverity.LOW, EventSeverity.MEDIUM, EventSeverity.HIGH, EventSeverity.CRITICAL]
            min_severity_idx = severity_order.index(rule["min_severity"])
            event_severity_idx = severity_order.index(event.severity) if event.severity else 0

            if event_severity_idx < min_severity_idx:
                return False

        # Check risk score threshold
        if rule.get("min_risk_score"):
            if not event.risk_score or event.risk_score < rule["min_risk_score"]:
                return False

        # Check required tags
        if rule.get("required_tags"):
            event_tags = set(event.tags or [])
            required_tags = set(rule["required_tags"])
            if not required_tags.issubset(event_tags):
                return False

        # Check keyword matches
        if rule.get("keywords"):
            text = f"{event.title} {event.description or ''}".lower()
            if not any(kw.lower() in text for kw in rule["keywords"]):
                return False

        # Check location requirements
        if rule.get("requires_location"):
            if not event.location:
                return False

        return True

    def _create_alert_from_rule(self, event: EventRead, rule: dict) -> AlertCreate:
        """Create alert from matched rule."""
        title = rule.get("alert_title", f"Alert: {rule['name']}")
        description = rule.get("alert_description", f"Event matched rule: {rule['name']}")

        # Replace placeholders
        title = title.replace("{event_title}", event.title[:100])
        description = description.replace("{event_title}", event.title)

        severity = rule.get("alert_severity", event.severity or EventSeverity.MEDIUM)

        return AlertCreate(
            event_id=event.id,
            title=title,
            description=description,
            severity=severity,
        )

    def _load_alert_rules(self) -> List[dict]:
        """
        Load alert rules configuration.
        In production, this would load from database or config file.
        """
        return [
            {
                "name": "Critical Risk Event",
                "min_risk_score": 0.8,
                "alert_severity": EventSeverity.CRITICAL,
                "alert_title": "🚨 Critical Risk Event Detected",
                "alert_description": "High-risk event detected: {event_title}",
            },
            {
                "name": "Nuclear/WMD Mention",
                "required_tags": ["wmd"],
                "alert_severity": EventSeverity.CRITICAL,
                "alert_title": "☢️ WMD-related Event",
                "alert_description": "Event mentions nuclear or WMD content: {event_title}",
            },
            {
                "name": "Active Conflict",
                "required_tags": ["kinetic_event"],
                "min_severity": EventSeverity.HIGH,
                "alert_severity": EventSeverity.HIGH,
                "alert_title": "⚔️ Active Conflict Event",
                "alert_description": "Kinetic military event detected: {event_title}",
            },
            {
                "name": "Major Force Movement",
                "required_tags": ["force_movement"],
                "min_severity": EventSeverity.MEDIUM,
                "alert_severity": EventSeverity.MEDIUM,
                "alert_title": "🚢 Force Movement Detected",
                "alert_description": "Military force movement: {event_title}",
            },
            {
                "name": "High Severity Event",
                "min_severity": EventSeverity.HIGH,
                "alert_severity": EventSeverity.HIGH,
                "alert_title": "⚠️ High Severity Event",
                "alert_description": "High severity event: {event_title}",
            },
        ]

    def cluster_related_events(self, events: List[EventRead]) -> List[List[UUID]]:
        """
        Cluster related events together.
        Simple implementation based on tag similarity.
        Can be enhanced with ML clustering later.
        """
        if not events:
            return []

        clusters = []
        processed = set()

        for event in events:
            if event.id in processed:
                continue

            cluster = [event.id]
            processed.add(event.id)

            event_tags = set(event.tags or [])

            # Find similar events
            for other in events:
                if other.id in processed or other.id == event.id:
                    continue

                other_tags = set(other.tags or [])

                # Calculate Jaccard similarity
                if event_tags and other_tags:
                    intersection = len(event_tags & other_tags)
                    union = len(event_tags | other_tags)
                    similarity = intersection / union if union > 0 else 0

                    # Cluster if similarity > 0.5
                    if similarity > 0.5:
                        cluster.append(other.id)
                        processed.add(other.id)

            if len(cluster) >= 2:  # Only include clusters with multiple events
                clusters.append(cluster)

        logger.info("event_clustering_complete", cluster_count=len(clusters))
        return clusters
