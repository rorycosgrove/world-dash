# ⚡ World Dash - Quick Start Guide

Get the geopolitical intelligence dashboard running in **5 minutes**.

## Prerequisites

- Docker Desktop installed and running
- Git (to clone or download the project)
- 8GB RAM minimum
- (Optional) Mapbox account for map visualization

## Step 1: Get the Code

```powershell
cd c:\code\world-dash
```

## Step 2: Configure Environment

```powershell
# Copy environment template
Copy-Item .env.example .env

# Edit .env in your favorite editor
notepad .env
```

**Required Changes**:
1. Change `POSTGRES_PASSWORD` from `changeme_in_production` to a secure password
2. (Optional) Add `NEXT_PUBLIC_MAPBOX_TOKEN` - Get free token at https://mapbox.com/signup

**Minimum .env**:
```env
POSTGRES_PASSWORD=YourSecurePassword123!
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token_here  # Optional
```

## Step 3: Start Services

```powershell
# Build and start all services
docker-compose up -d

# Wait 30 seconds for services to initialize...
Start-Sleep -Seconds 30

# Check services are healthy
docker-compose ps
```

You should see 6 running services:
- worlddash-postgres
- worlddash-redis  
- worlddash-api
- worlddash-worker
- worlddash-beat
- worlddash-web

## Step 4: Initialize Database

```powershell
# Run database migrations (see alembic/README.md)

# Seed with 15 RSS feed sources
docker-compose exec api python scripts/seed.py
```

## Step 5: Access the Dashboard

Open your browser to:

🌐 **Frontend Dashboard**: http://localhost:3000

📚 **API Documentation**: http://localhost:8000/docs

💚 **Health Check**: http://localhost:8000/health

## Step 6: Verify It's Working

### Check Feed Ingestion

```powershell
# View worker logs (should show ingestion activity)
docker-compose logs -f worker
```

Wait a few minutes for the first scheduled ingestion (runs every 5 min).

### Check API

```powershell
# Get sources
curl http://localhost:8000/sources

# Get events (may be empty initially)
curl http://localhost:8000/events
```

### Check Dashboard

1. Open http://localhost:3000
2. You should see:
   - Empty event feed initially
   - World map centered on the globe
   - Alert panel (no alerts yet)
   - Severity filter buttons

After the first ingestion cycle (~5 minutes), events will appear.

## 🔥 Trigger Immediate Ingestion

Don't want to wait? Trigger ingestion manually:

```powershell
# Connect to API container
docker-compose exec api python

# In Python shell:
from apps.worker.tasks import ingest_all_sources_task
ingest_all_sources_task.delay()
exit()

# Watch the logs
docker-compose logs -f worker
```

Events will appear in the dashboard within 1-2 minutes!

## 🛠️ Common Commands

```powershell
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f api
docker-compose logs -f worker

# Restart services
docker-compose restart

# Stop all services
docker-compose down

# Stop and remove all data (DESTRUCTIVE)
docker-compose down -v
```

## 🧪 Test the API

### Get Events
```powershell
# Get latest 10 events
curl "http://localhost:8000/events?limit=10"

# Get high severity events
curl "http://localhost:8000/events?severity=high"

# Get events from last 24 hours
curl "http://localhost:8000/events?since_hours=24"
```

### Add Custom Feed
```powershell
curl -X POST "http://localhost:8000/sources" `
  -H "Content-Type: application/json" `
  -d '{
    "name": "My Custom Feed",
    "url": "https://example.com/rss",
    "type": "rss",
    "enabled": true,
    "tags": ["custom"]
  }'
```

### Get Alerts
```powershell
# Get unacknowledged alerts
curl "http://localhost:8000/alerts?acknowledged=false"

# Acknowledge alert (replace {id} with actual alert ID)
curl -X POST "http://localhost:8000/alerts/{id}/acknowledge"
```

## 🐛 Troubleshooting

### Services won't start
```powershell
# Check Docker is running
docker info

# Check logs
docker-compose logs

# Try rebuilding
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Database connection errors
```powershell
# Check PostgreSQL is healthy
docker-compose ps postgres
docker-compose logs postgres

# Restart database
docker-compose restart postgres

# Wait for health check
Start-Sleep -Seconds 10
```

### Frontend not loading
```powershell
# Check API is reachable
curl http://localhost:8000/health

# Check web service
docker-compose logs web

# Restart frontend
docker-compose restart web
```

### No events appearing
```powershell
# Check worker is running
docker-compose ps worker

# Check worker logs for errors
docker-compose logs worker

# Manually trigger ingestion
docker-compose exec api python -c "from apps.worker.tasks import ingest_all_sources_task; ingest_all_sources_task()"
```

### Map not displaying
- Get a free Mapbox token at https://mapbox.com/signup
- Add to `.env`: `NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token`
- Restart: `docker-compose restart web`

## 🎯 What to Expect

### First 5 Minutes
- Services start up
- Database initialized
- 15 RSS sources configured
- No events yet (waiting for first poll)

### After 5-10 Minutes
- First ingestion completes
- 10-50 events in database
- Events appear on map
- Event feed populated
- Possible alerts generated

### After 1 Hour
- 100-500 events collected
- Multiple ingestion cycles completed
- Alert rules triggered
- Full dashboard experience

## 📖 Next Steps

1. **Read the README**: [README.md](README.md)
2. **Explore the API**: http://localhost:8000/docs
3. **Add More Sources**: Edit `scripts/seed.py` or use API
4. **Customize Alert Rules**: Edit `packages/intelligence_engine/engine.py`
5. **Review Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md)
6. **Start Development**: [DEVELOPMENT.md](DEVELOPMENT.md)

## 🆘 Need Help?

Check the documentation:
- [README.md](README.md) - Main documentation
- [DEVELOPMENT.md](DEVELOPMENT.md) - Development guide
- [PHASE1-COMPLETE.md](PHASE1-COMPLETE.md) - Feature overview
- API Docs: http://localhost:8000/docs

View logs for debugging:
```powershell
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f [api|worker|beat|web|postgres|redis]
```

## ✅ Success Checklist

- [ ] All 6 services running (`docker-compose ps`)
- [ ] Database migrations completed
- [ ] 15 sources seeded
- [ ] API health check returns `{"status": "healthy"}`
- [ ] Frontend loads at http://localhost:3000
- [ ] Worker logs show ingestion activity
- [ ] Events appear in dashboard (after first poll)

---

**You're all set!** 🎉

The World Dash geopolitical intelligence dashboard is now running.

Monitor world events, track military movements, and analyze geopolitical signals in real-time.
