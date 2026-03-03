"""
Intelligence analysis engine.
"""

from typing import List, Optional
from uuid import UUID

import numpy as np

from packages.shared.logging import get_logger
from packages.shared.schemas import AlertCreate, ClusterCreate, EventRead, EventSeverity

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
        Cluster related events using tag-based Jaccard similarity.
        Legacy fallback — prefer auto_generate_clusters for embedding-based clustering.
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

    def auto_generate_clusters(
        self,
        embeddings: List[tuple[UUID, list[float]]],
        min_cluster_size: int = 3,
        similarity_threshold: float = 0.65,
    ) -> List[dict]:
        """
        Generate topic clusters from event embeddings using agglomerative
        greedy clustering (no scipy/sklearn dependency).

        Args:
            embeddings: List of (event_id, embedding_vector) tuples
            min_cluster_size: Minimum events for a cluster to be kept
            similarity_threshold: Cosine similarity threshold for grouping

        Returns:
            List of dicts with 'event_ids' and 'centroid'
        """
        if len(embeddings) < min_cluster_size:
            return []

        ids = [eid for eid, _ in embeddings]
        vecs = np.array([emb for _, emb in embeddings], dtype=np.float32)

        # Normalize
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms[norms == 0] = 1
        vecs = vecs / norms

        # Compute pairwise cosine similarity
        sim_matrix = vecs @ vecs.T

        # Greedy agglomerative clustering
        assigned = [False] * len(ids)
        clusters = []

        # Sort events by how many neighbors they have (high-connectivity first)
        neighbor_counts = [(i, (sim_matrix[i] >= similarity_threshold).sum()) for i in range(len(ids))]
        neighbor_counts.sort(key=lambda x: x[1], reverse=True)

        for idx, _ in neighbor_counts:
            if assigned[idx]:
                continue

            cluster_indices = [idx]
            assigned[idx] = True

            for other_idx in range(len(ids)):
                if assigned[other_idx]:
                    continue
                if sim_matrix[idx][other_idx] >= similarity_threshold:
                    cluster_indices.append(other_idx)
                    assigned[other_idx] = True

            if len(cluster_indices) >= min_cluster_size:
                cluster_vecs = vecs[cluster_indices]
                centroid = cluster_vecs.mean(axis=0)
                centroid_norm = np.linalg.norm(centroid)
                if centroid_norm > 0:
                    centroid = centroid / centroid_norm

                clusters.append({
                    "event_ids": [ids[i] for i in cluster_indices],
                    "centroid": centroid.tolist(),
                })

        logger.info("auto_clusters_generated", count=len(clusters), total_events=len(ids))
        return clusters

    def generate_cluster_label(self, events: List[EventRead]) -> str:
        """Generate a label for a cluster based on its events' metadata."""
        from collections import Counter
        all_categories = []
        all_actors = []
        all_themes = []
        for e in events:
            all_categories.extend(e.categories or [])
            all_actors.extend(e.actors or [])
            all_themes.extend(e.themes or [])

        top_categories = [w for w, _ in Counter(all_categories).most_common(2)]
        top_actors = [w for w, _ in Counter(all_actors).most_common(2)]
        top_themes = [w for w, _ in Counter(all_themes).most_common(1)]

        parts = []
        if top_actors:
            parts.append(" & ".join(top_actors[:2]))
        if top_categories:
            parts.append(", ".join(top_categories[:2]))
        if top_themes:
            parts.append(top_themes[0])

        label = " — ".join(parts) if parts else f"Cluster ({len(events)} events)"
        return label[:200]

    def generate_cluster_keywords(self, events: List[EventRead]) -> List[str]:
        """Extract top keywords from cluster events."""
        from collections import Counter
        words = []
        for e in events:
            words.extend(e.categories or [])
            words.extend(e.actors or [])
            words.extend(e.themes or [])
            words.extend(e.tags or [])

        return [w for w, _ in Counter(words).most_common(10)]
