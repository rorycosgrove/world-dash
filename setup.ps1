#!/usr/bin/env pwsh
<#
.SYNOPSIS
    World Dash - Automated Setup Script
.DESCRIPTION
    Automates the complete setup of the World Dash geopolitical intelligence dashboard.
    Checks prerequisites, configures environment, starts services, and initializes the database.
.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -SkipMapbox
#>

[CmdletBinding()]
param(
    [switch]$SkipMapbox,
    [string]$PostgresPassword,
    [string]$MapboxToken
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Error { Write-Host $args -ForegroundColor Red }

Write-Host "`n🌍 World Dash - Automated Setup`n" -ForegroundColor Magenta

# Step 1: Check prerequisites
Write-Info "📋 Step 1/7: Checking prerequisites..."

# Check Docker
try {
    $dockerVersion = docker --version
    Write-Success "  ✓ Docker installed: $dockerVersion"
} catch {
    Write-Error "  ✗ Docker not found. Please install Docker Desktop from https://docker.com/products/docker-desktop"
    exit 1
}

# Check Docker Compose (V2 plugin)
try {
    $composeVersion = docker compose version
    Write-Success "  ✓ Docker Compose available: $composeVersion"
} catch {
    Write-Error "  ✗ Docker Compose not found. Please install Docker Desktop (includes Compose V2)"
    exit 1
}

# Check if Docker daemon is running
try {
    docker info | Out-Null
    Write-Success "  ✓ Docker daemon is running"
} catch {
    Write-Error "  ✗ Docker daemon is not running. Please start Docker Desktop"
    exit 1
}

# Step 2: Configure environment
Write-Info "`n⚙️  Step 2/7: Configuring environment..."

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Success "  ✓ Created .env from .env.example"
        
        # Generate secure password if not provided
        if (-not $PostgresPassword) {
            $PostgresPassword = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 20 | ForEach-Object {[char]$_})
            Write-Info "  ℹ Generated secure PostgreSQL password"
        }
        
        # Update .env file
        $envContent = Get-Content ".env" -Raw
        $envContent = $envContent -replace 'POSTGRES_PASSWORD=changeme_in_production', "POSTGRES_PASSWORD=$PostgresPassword"
        
        if ($MapboxToken) {
            $envContent = $envContent -replace 'NEXT_PUBLIC_MAPBOX_TOKEN=', "NEXT_PUBLIC_MAPBOX_TOKEN=$MapboxToken"
            Write-Success "  ✓ Configured Mapbox token"
        } elseif (-not $SkipMapbox) {
            Write-Warning "  ⚠ Mapbox token not provided. Map visualization will be limited."
            Write-Info "    Get a free token at https://mapbox.com/signup"
            Write-Info "    Then add to .env: NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token"
        }
        
        Set-Content ".env" $envContent
        Write-Success "  ✓ Environment configured with secure password"
    } else {
        Write-Error "  ✗ .env.example not found"
        exit 1
    }
} else {
    Write-Warning "  ⚠ .env already exists, skipping configuration"
}

# Step 3: Build Docker images
Write-Info "`n🔨 Step 3/7: Building Docker images..."
Write-Info "  (This may take 5-10 minutes on first run)"

docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml build 2>&1 | ForEach-Object {
    if ($_ -match "Successfully") {
        Write-Success "  $_"
    }
}

if ($LASTEXITCODE -eq 0) {
    Write-Success "  ✓ Docker images built successfully"
} else {
    Write-Error "  ✗ Docker build failed"
    exit 1
}

# Step 4: Start services
Write-Info "`n🚀 Step 4/7: Starting services..."

docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml up -d

if ($LASTEXITCODE -eq 0) {
    Write-Success "  ✓ Services started"
} else {
    Write-Error "  ✗ Failed to start services"
    exit 1
}

# Step 5: Wait for services to be healthy
Write-Info "`n⏳ Step 5/7: Waiting for services to be healthy..."
Write-Info "  (This may take 30-60 seconds)"

$maxAttempts = 30
$attempt = 0
$allHealthy = $false

while ($attempt -lt $maxAttempts -and -not $allHealthy) {
    Start-Sleep -Seconds 2
    $attempt++
    
    try {
        # Check PostgreSQL
        $pgHealth = docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml exec -T postgres pg_isready -U worlddash 2>&1
        $pgHealthy = $pgHealth -match "accepting connections"
        
        # Check Redis
        $redisHealth = docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml exec -T redis redis-cli ping 2>&1
        $redisHealthy = $redisHealth -match "PONG"
        
        # Check API
        try {
            $apiHealth = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            $apiHealthy = $apiHealth.StatusCode -eq 200
        } catch {
            $apiHealthy = $false
        }
        
        if ($pgHealthy -and $redisHealthy -and $apiHealthy) {
            $allHealthy = $true
            Write-Success "  ✓ All services are healthy"
        } else {
            Write-Host "  ⏳ Waiting... ($attempt/$maxAttempts)" -NoNewline
            Write-Host "`r" -NoNewline
        }
    } catch {
        # Continue waiting
    }
}

if (-not $allHealthy) {
    Write-Warning "  ⚠ Services may not be fully healthy yet"
    Write-Info "  Continuing with setup..."
}

# Step 6: Run database migrations
Write-Info "`n💾 Step 6/7: Running database migrations..."

docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml exec -T api alembic upgrade head

if ($LASTEXITCODE -eq 0) {
    Write-Success "  ✓ Database migrations completed"
} else {
    Write-Error "  ✗ Database migrations failed"
    Write-Info "  Check logs: docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs api"
    exit 1
}

# Step 7: Seed database
Write-Info "`n🌱 Step 7/7: Seeding database with RSS sources..."

docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml exec -T api python scripts/seed.py

if ($LASTEXITCODE -eq 0) {
    Write-Success "  ✓ Database seeded with 15 RSS sources"
} else {
    Write-Warning "  ⚠ Database seeding had issues (may be okay if sources already exist)"
}

# Success summary
Write-Host "`n" + ("=" * 70) -ForegroundColor Green
Write-Host "🎉 Setup Complete! World Dash is running!" -ForegroundColor Green
Write-Host ("=" * 70) + "`n" -ForegroundColor Green

Write-Info "📊 Service Status:"
docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml ps

Write-Host "`n🌐 Access Points:" -ForegroundColor Cyan
Write-Host "  Dashboard:  " -NoNewline; Write-Success "http://localhost:3000"
Write-Host "  API Docs:   " -NoNewline; Write-Success "http://localhost:8000/docs"
Write-Host "  Health:     " -NoNewline; Write-Success "http://localhost:8000/health"

Write-Host "`n📝 Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Open dashboard: " -NoNewline; Write-Info "http://localhost:3000"
Write-Host "  2. Wait 5 minutes for first ingestion cycle"
Write-Host "  3. Or trigger manually: " -NoNewline; Write-Info "docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml exec api python -c 'from apps.worker.tasks import ingest_all_sources_task; ingest_all_sources_task()'"

Write-Host "`n🔍 Useful Commands:" -ForegroundColor Cyan
Write-Host "  View logs:        " -NoNewline; Write-Info "docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs -f"
Write-Host "  View API logs:    " -NoNewline; Write-Info "docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs -f api"
Write-Host "  View worker logs: " -NoNewline; Write-Info "docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml logs -f worker"
Write-Host "  Stop services:    " -NoNewline; Write-Info "docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml down"
Write-Host "  Restart:          " -NoNewline; Write-Info "docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml restart"

Write-Host "`n📚 Documentation:" -ForegroundColor Cyan
Write-Host "  README.md, DEVELOPMENT.md, ARCHITECTURE.md"

if (-not $MapboxToken -and -not $SkipMapbox) {
    Write-Host "`n💡 Tip: Add Mapbox token for better maps:" -ForegroundColor Yellow
    Write-Host "  1. Get token: https://mapbox.com/signup"
    Write-Host "  2. Add to .env: NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token"
    Write-Host "  3. Restart: docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml restart web"
}

Write-Host ""
