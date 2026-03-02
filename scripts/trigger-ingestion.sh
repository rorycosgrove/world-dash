#!/bin/bash
# Quick ingestion trigger script

echo "🔄 Triggering manual feed ingestion..."

docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml exec -T api python -c "from apps.worker.tasks import ingest_all_sources_task; ingest_all_sources_task(); print('Ingestion task queued!')"

echo "✓ Ingestion triggered. Check worker logs:"
echo "  docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs -f worker"
