"""Celery application configuration."""

from kombu import Queue
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

# ---------- Queue & Routing ----------
# Two queues: 'default' for fast I/O tasks, 'llm' for slow Ollama tasks.
# A dedicated llm-worker container consumes 'llm' with concurrency=1 so
# Ollama only ever gets one request at a time.
app.conf.task_queues = (
    Queue("default"),
    Queue("llm"),
)
app.conf.task_default_queue = "default"
app.conf.task_routes = {
    "apps.worker.tasks.llm_categorize_event_task": {"queue": "llm"},
    # The batch scheduler runs on default queue but dispatches individual
    # tasks to the llm queue.
    "apps.worker.tasks.llm_categorize_events_task": {"queue": "default"},
}

# ---------- Concurrency / Prefetch ----------
# prefetch_multiplier=1 -> each worker child fetches one task at a time,
# preventing a single worker from hogging all queued LLM tasks.
app.conf.worker_prefetch_multiplier = 1

# ---------- Reliability ----------
app.conf.task_acks_late = True              # re-deliver if worker crashes mid-task
app.conf.task_reject_on_worker_lost = True
app.conf.task_soft_time_limit = 180         # default soft limit 3 min
app.conf.task_time_limit = 240              # hard kill at 4 min

# ---------- Periodic tasks (beat) ----------
app.conf.beat_schedule = {
    "ingest-all-sources": {
        "task": "apps.worker.tasks.ingest_all_sources_task",
        "schedule": settings.ingestion.poll_interval_seconds,
    },
    "process-new-events": {
        "task": "apps.worker.tasks.process_new_events",
        "schedule": 60,
    },
    "llm-categorize-events": {
        "task": "apps.worker.tasks.llm_categorize_events_task",
        "schedule": 300,  # 5 min — one batch at a time
    },
}

logger.info(
    "celery_app_configured",
    broker=settings.celery.broker_url.split("@")[-1],
    queues=["default", "llm"],
)

# Ensure tasks module is imported so tasks are registered
import apps.worker.tasks  # noqa: F401,E402
