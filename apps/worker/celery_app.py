"""
Celery application configuration.
"""

from celery import Celery

from packages.shared.config import get_settings
from packages.shared.logging import configure_logging, get_logger

settings = get_settings()
configure_logging("worker", "INFO")
logger = get_logger(__name__)

# Create Celery app
app = Celery("worlddash", include=["apps.worker.tasks"])
app.conf.broker_url = settings.celery.broker_url
app.conf.result_backend = settings.celery.result_backend
app.conf.task_serializer = "json"
app.conf.result_serializer = "json"
app.conf.accept_content = ["json"]
app.conf.timezone = "UTC"
app.conf.enable_utc = True

# Periodic tasks schedule
app.conf.beat_schedule = {
    "ingest-all-sources": {
        "task": "apps.worker.tasks.ingest_all_sources_task",
        "schedule": settings.ingestion.poll_interval_seconds,
    },
    "process-new-events": {
        "task": "apps.worker.tasks.process_new_events",
        "schedule": 60,  # Every 60 seconds
    },
    "llm-categorize-events": {
        "task": "apps.worker.tasks.llm_categorize_events_task",
        "schedule": 200,  # Every ~3.3 minutes (enough time for 5 events × 35s stagger)
    },
}

logger.info("celery_app_configured", broker=settings.celery.broker_url.split("@")[-1])

# Ensure tasks module is imported so tasks are registered
import apps.worker.tasks  # noqa: F401,E402
