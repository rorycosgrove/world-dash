# Alembic Migrations

This project uses Alembic for database schema migrations. Migration files live in
`alembic/versions/` and are applied against the PostgreSQL database configured via `.env`.

## Local (uv)

```powershell
# Create a new migration from model changes
uv run alembic revision --autogenerate -m "description"

# Apply migrations
uv run alembic upgrade head

# Roll back one migration
uv run alembic downgrade -1
```

After creating a migration, review and edit the generated file in
`alembic/versions/` before applying it.

## Docker

```powershell
# Apply migrations inside the API container
docker-compose exec api alembic upgrade head
```

