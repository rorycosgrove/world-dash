#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Quick ingestion trigger script
.DESCRIPTION
    Manually triggers feed ingestion without waiting for scheduled poll
#>

Write-Host "🔄 Triggering manual feed ingestion..." -ForegroundColor Cyan

docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml exec -T api python -c @"
from apps.worker.tasks import ingest_all_sources_task
result = ingest_all_sources_task()
print('Ingestion task queued!')
"@

Write-Host "✓ Ingestion triggered. Check worker logs:" -ForegroundColor Green
Write-Host "  docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs -f worker" -ForegroundColor Cyan
