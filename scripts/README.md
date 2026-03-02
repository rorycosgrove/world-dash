# World Dash - Setup Scripts

This directory contains automated setup and utility scripts.

## Setup Scripts

### Windows (PowerShell)

```powershell
# Run automated setup
.\setup.ps1

# With custom password
.\setup.ps1 -PostgresPassword "YourSecurePassword123!"

# With Mapbox token
.\setup.ps1 -MapboxToken "pk.your_mapbox_token"

# Skip Mapbox prompt
.\setup.ps1 -SkipMapbox
```

### Linux/macOS (Bash)

```bash
# Make executable
chmod +x setup.sh

# Run automated setup
./setup.sh

# With custom password
./setup.sh --postgres-password "YourSecurePassword123!"

# With Mapbox token
./setup.sh --mapbox-token "pk.your_mapbox_token"

# Skip Mapbox prompt
./setup.sh --skip-mapbox
```

## What the Setup Script Does

1. ✅ **Checks prerequisites** - Docker, Docker Compose
2. ✅ **Configures environment** - Creates .env with secure password
3. ✅ **Builds Docker images** - Compiles all services
4. ✅ **Starts services** - Launches all containers
5. ✅ **Waits for health** - Ensures services are ready
6. ✅ **Runs migrations** - Sets up database schema
7. ✅ **Seeds data** - Adds 15 RSS sources

**Total time**: 5-10 minutes on first run

## Utility Scripts

### Trigger Manual Ingestion

**Windows:**
```powershell
.\scripts\trigger-ingestion.ps1
```

**Linux/macOS:**
```bash
chmod +x scripts/trigger-ingestion.sh
./scripts/trigger-ingestion.sh
```

This manually triggers feed ingestion without waiting for the scheduled poll.

### Seed Database

```bash
docker-compose exec api python scripts/seed.py
```

Adds the 15 pre-configured RSS sources to the database.

## Manual Setup (Alternative)

If you prefer manual setup, see [QUICKSTART.md](../QUICKSTART.md).

## Troubleshooting

**Script fails on prerequisites:**
- Install Docker Desktop: https://docker.com/products/docker-desktop
- Ensure Docker daemon is running

**Permission denied (Linux/macOS):**
```bash
chmod +x setup.sh
chmod +x scripts/*.sh
```

**Services not healthy:**
- Check Docker resources (RAM, CPU)
- View logs: `docker-compose logs`
- Restart: `docker-compose restart`

**Database migration fails:**
```bash
# Check PostgreSQL logs
docker-compose logs postgres

# Restart and retry
docker-compose restart postgres
sleep 10
docker-compose exec api alembic upgrade head
```

## Next Steps After Setup

1. Open dashboard: http://localhost:3000
2. Wait 5 minutes for first ingestion
3. Or trigger manually: `./scripts/trigger-ingestion.sh`
4. View logs: `docker-compose logs -f worker`

## Environment Variables

The setup script configures these key variables:

- `POSTGRES_PASSWORD` - Auto-generated secure password
- `NEXT_PUBLIC_MAPBOX_TOKEN` - Optional (for maps)
- Other defaults from `.env.example`

To customize, edit `.env` after setup and restart:
```bash
docker-compose restart
```

## Clean Slate

To completely reset:
```bash
docker-compose down -v  # Removes all data!
./setup.sh              # Re-run setup
```
