#!/bin/bash
set -e

# World Dash - Automated Setup Script (Linux/macOS)
# This script automates the complete setup of the World Dash geopolitical intelligence dashboard.

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Helper functions
log_info() { echo -e "${CYAN}$1${NC}"; }
log_success() { echo -e "${GREEN}$1${NC}"; }
log_warning() { echo -e "${YELLOW}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}"; }

echo -e "\n${MAGENTA}🌍 World Dash - Automated Setup${NC}\n"

# Parse arguments
SKIP_MAPBOX=false
POSTGRES_PASSWORD=""
MAPBOX_TOKEN=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-mapbox)
            SKIP_MAPBOX=true
            shift
            ;;
        --postgres-password)
            POSTGRES_PASSWORD="$2"
            shift 2
            ;;
        --mapbox-token)
            MAPBOX_TOKEN="$2"
            shift 2
            ;;
        *)
            echo "Usage: $0 [--skip-mapbox] [--postgres-password PASSWORD] [--mapbox-token TOKEN]"
            exit 1
            ;;
    esac
done

# Step 1: Check prerequisites
log_info "📋 Step 1/7: Checking prerequisites..."

if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    log_success "  ✓ Docker installed: $DOCKER_VERSION"
else
    log_error "  ✗ Docker not found. Please install Docker from https://docker.com"
    exit 1
fi

if docker compose version &> /dev/null; then
    COMPOSE_VERSION=$(docker compose version)
    log_success "  ✓ Docker Compose available: $COMPOSE_VERSION"
else
    log_error "  ✗ Docker Compose V2 not found. Please install Docker Desktop (includes Compose V2)"
    exit 1
fi

if docker info &> /dev/null; then
    log_success "  ✓ Docker daemon is running"
else
    log_error "  ✗ Docker daemon is not running. Please start Docker"
    exit 1
fi

# Step 2: Configure environment
log_info "\n⚙️  Step 2/7: Configuring environment..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        log_success "  ✓ Created .env from .env.example"
        
        # Generate secure password if not provided
        if [ -z "$POSTGRES_PASSWORD" ]; then
            POSTGRES_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)!@#
            log_info "  ℹ Generated secure PostgreSQL password"
        fi
        
        # Update .env file
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/POSTGRES_PASSWORD=changeme_in_production/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" .env
        else
            # Linux
            sed -i "s/POSTGRES_PASSWORD=changeme_in_production/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" .env
        fi
        
        if [ -n "$MAPBOX_TOKEN" ]; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s/NEXT_PUBLIC_MAPBOX_TOKEN=/NEXT_PUBLIC_MAPBOX_TOKEN=$MAPBOX_TOKEN/" .env
            else
                sed -i "s/NEXT_PUBLIC_MAPBOX_TOKEN=/NEXT_PUBLIC_MAPBOX_TOKEN=$MAPBOX_TOKEN/" .env
            fi
            log_success "  ✓ Configured Mapbox token"
        elif [ "$SKIP_MAPBOX" = false ]; then
            log_warning "  ⚠ Mapbox token not provided. Map visualization will be limited."
            log_info "    Get a free token at https://mapbox.com/signup"
            log_info "    Then add to .env: NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token"
        fi
        
        log_success "  ✓ Environment configured with secure password"
    else
        log_error "  ✗ .env.example not found"
        exit 1
    fi
else
    log_warning "  ⚠ .env already exists, skipping configuration"
fi

# Compose command with file paths
COMPOSE="docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml"

# Step 3: Build Docker images
log_info "\n🔨 Step 3/7: Building Docker images..."
log_info "  (This may take 5-10 minutes on first run)"

$COMPOSE build

if [ $? -eq 0 ]; then
    log_success "  ✓ Docker images built successfully"
else
    log_error "  ✗ Docker build failed"
    exit 1
fi

# Step 4: Start services
log_info "\n🚀 Step 4/7: Starting services..."

$COMPOSE up -d

if [ $? -eq 0 ]; then
    log_success "  ✓ Services started"
else
    log_error "  ✗ Failed to start services"
    exit 1
fi

# Step 5: Wait for services to be healthy
log_info "\n⏳ Step 5/7: Waiting for services to be healthy..."
log_info "  (This may take 30-60 seconds)"

MAX_ATTEMPTS=30
ATTEMPT=0
ALL_HEALTHY=false

while [ $ATTEMPT -lt $MAX_ATTEMPTS ] && [ "$ALL_HEALTHY" = false ]; do
    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
    
    # Check PostgreSQL
    if $COMPOSE exec -T postgres pg_isready -U worlddash &> /dev/null; then
        PG_HEALTHY=true
    else
        PG_HEALTHY=false
    fi
    
    # Check Redis
    if $COMPOSE exec -T redis redis-cli ping 2>&1 | grep -q "PONG"; then
        REDIS_HEALTHY=true
    else
        REDIS_HEALTHY=false
    fi
    
    # Check API
    if curl -sf http://localhost:8000/health &> /dev/null; then
        API_HEALTHY=true
    else
        API_HEALTHY=false
    fi
    
    if [ "$PG_HEALTHY" = true ] && [ "$REDIS_HEALTHY" = true ] && [ "$API_HEALTHY" = true ]; then
        ALL_HEALTHY=true
        log_success "  ✓ All services are healthy"
    else
        echo -ne "  ⏳ Waiting... ($ATTEMPT/$MAX_ATTEMPTS)\r"
    fi
done

if [ "$ALL_HEALTHY" = false ]; then
    log_warning "  ⚠ Services may not be fully healthy yet"
    log_info "  Continuing with setup..."
fi

# Step 6: Run database migrations
log_info "\n💾 Step 6/7: Running database migrations..."

$COMPOSE exec -T api alembic upgrade head

if [ $? -eq 0 ]; then
    log_success "  ✓ Database migrations completed"
else
    log_error "  ✗ Database migrations failed"
    log_info "  Check logs: $COMPOSE logs api"
    exit 1
fi

# Step 7: Seed database
log_info "\n🌱 Step 7/7: Seeding database with RSS sources..."

$COMPOSE exec -T api python scripts/seed.py

if [ $? -eq 0 ]; then
    log_success "  ✓ Database seeded with 15 RSS sources"
else
    log_warning "  ⚠ Database seeding had issues (may be okay if sources already exist)"
fi

# Success summary
echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}🎉 Setup Complete! World Dash is running!${NC}"
echo -e "${GREEN}======================================================================${NC}\n"

log_info "📊 Service Status:"
$COMPOSE ps

echo -e "\n${CYAN}🌐 Access Points:${NC}"
echo -e "  Dashboard:  ${GREEN}http://localhost:3000${NC}"
echo -e "  API Docs:   ${GREEN}http://localhost:8000/docs${NC}"
echo -e "  Health:     ${GREEN}http://localhost:8000/health${NC}"

echo -e "\n${CYAN}📝 Next Steps:${NC}"
echo -e "  1. Open dashboard: ${CYAN}http://localhost:3000${NC}"
echo -e "  2. Wait 5 minutes for first ingestion cycle"
echo -e "  3. Or trigger manually: ${CYAN}$COMPOSE exec api python -c 'from apps.worker.tasks import ingest_all_sources_task; ingest_all_sources_task()'${NC}"

echo -e "\n${CYAN}🔍 Useful Commands:${NC}"
echo -e "  View logs:        ${CYAN}$COMPOSE logs -f${NC}"
echo -e "  View API logs:    ${CYAN}$COMPOSE logs -f api${NC}"
echo -e "  View worker logs: ${CYAN}$COMPOSE logs -f worker${NC}"
echo -e "  Stop services:    ${CYAN}$COMPOSE down${NC}"
echo -e "  Restart:          ${CYAN}$COMPOSE restart${NC}"

echo -e "\n${CYAN}📚 Documentation:${NC}"
echo -e "  README.md, DEVELOPMENT.md, ARCHITECTURE.md"

if [ -z "$MAPBOX_TOKEN" ] && [ "$SKIP_MAPBOX" = false ]; then
    echo -e "\n${YELLOW}💡 Tip: Add Mapbox token for better maps:${NC}"
    echo -e "  1. Get token: https://mapbox.com/signup"
    echo -e "  2. Add to .env: NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token"
    echo -e "  3. Restart: $COMPOSE restart web"
fi

echo ""
