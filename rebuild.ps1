#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Rebuild and restart World Dash services

.DESCRIPTION
    This script rebuilds specified services and ensures they are properly restarted
    to pick up all code changes. Use this after making code changes to ensure
    updates are applied.

.PARAMETER Services
    Services to rebuild (api, web, worker, beat). Defaults to all if not specified.

.PARAMETER NoCache
    Force rebuild without using Docker cache

.EXAMPLE
    .\rebuild.ps1
    Rebuilds all services

.EXAMPLE
    .\rebuild.ps1 -Services web,api
    Rebuilds only web and api services

.EXAMPLE
    .\rebuild.ps1 -Services web -NoCache
    Rebuilds web service without cache
#>

param(
    [string[]]$Services = @(),
    [switch]$NoCache
)

$ErrorActionPreference = "Stop"

# Compose command with file paths
$ComposeCmd = "docker"
$ComposeBase = @("compose", "-f", "docker/docker-compose.yml", "-f", "docker/docker-compose.local.yml")

Write-Host "`n=== World Dash Service Rebuild ===" -ForegroundColor Cyan
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n" -ForegroundColor Gray

# Determine which services to rebuild
$allServices = @("api", "web", "worker", "llm-worker", "beat")
if ($Services.Count -eq 0) {
    $servicesToRebuild = $allServices
    Write-Host "Rebuilding ALL services..." -ForegroundColor Yellow
} else {
    $servicesToRebuild = $Services
    Write-Host "Rebuilding services: $($servicesToRebuild -join ', ')" -ForegroundColor Yellow
}

# Build command
$buildArgs = $ComposeBase + @("build")
if ($NoCache) {
    $buildArgs += "--no-cache"
    Write-Host "Using --no-cache flag" -ForegroundColor Gray
}
$buildArgs += $servicesToRebuild

Write-Host "`n[Step 1/3] Building containers..." -ForegroundColor Cyan
Write-Host "Command: $ComposeCmd $($buildArgs -join ' ')" -ForegroundColor Gray
& $ComposeCmd @buildArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n✅ Build completed successfully" -ForegroundColor Green

# Stop the services
Write-Host "`n[Step 2/3] Stopping services..." -ForegroundColor Cyan
$stopArgs = $ComposeBase + @("stop") + $servicesToRebuild
& $ComposeCmd @stopArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Warning: Stop command returned exit code $LASTEXITCODE" -ForegroundColor Yellow
}

# Start the services
Write-Host "`n[Step 3/3] Starting services..." -ForegroundColor Cyan
$upArgs = $ComposeBase + @("up", "-d") + $servicesToRebuild
& $ComposeCmd @upArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Failed to start services with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n✅ Services started successfully" -ForegroundColor Green

# Wait a moment for services to initialize
Write-Host "`nWaiting for services to initialize..." -ForegroundColor Gray
Start-Sleep -Seconds 3

# Show status
Write-Host "`n[Status Check]" -ForegroundColor Cyan
$psArgs = $ComposeBase + @("ps")
& $ComposeCmd @psArgs

# Show recent logs
Write-Host "`n[Recent Logs]" -ForegroundColor Cyan
foreach ($service in $servicesToRebuild) {
    Write-Host "`n--- $service ---" -ForegroundColor Yellow
    $logArgs = $ComposeBase + @("logs", "--tail=5", $service)
    & $ComposeCmd @logArgs
}

Write-Host "`n=== Rebuild Complete ===" -ForegroundColor Green
Write-Host "Services are now running with latest code changes.`n" -ForegroundColor Gray

# Service URLs
if ($servicesToRebuild -contains "web") {
    Write-Host "🌐 Web UI:      http://localhost:3000" -ForegroundColor Cyan
    Write-Host "⚙️  Settings:    http://localhost:3000/settings" -ForegroundColor Cyan
}
if ($servicesToRebuild -contains "api") {
    Write-Host "🔌 API:         http://localhost:8000" -ForegroundColor Cyan
    Write-Host "📚 API Docs:    http://localhost:8000/docs" -ForegroundColor Cyan
    
    # Quick API health check
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:8000/health" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
        Write-Host "✅ API Health:  OK" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  API Health:  Not responding yet (may still be starting)" -ForegroundColor Yellow
    }
}
Write-Host ""
