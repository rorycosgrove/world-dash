"""Add pgvector extension and embedding column to events

Revision ID: 004
Revises: 003_add_source_auth
Create Date: 2026-03-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003_add_source_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Add embedding column (768-dim for nomic-embed-text)
    op.execute("ALTER TABLE events ADD COLUMN embedding vector(768)")

    # Add embedded_at timestamp to track which events have embeddings
    op.add_column(
        "events",
        sa.Column("embedded_at", sa.DateTime(timezone=True), nullable=True),
    )

    # HNSW index for fast cosine similarity search
    op.execute(
        "CREATE INDEX ix_events_embedding_hnsw ON events "
        "USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )

    op.create_index("ix_events_embedded_at", "events", ["embedded_at"])


def downgrade() -> None:
    op.drop_index("ix_events_embedded_at", "events")
    op.execute("DROP INDEX IF EXISTS ix_events_embedding_hnsw")
    op.drop_column("events", "embedded_at")
    op.execute("ALTER TABLE events DROP COLUMN IF EXISTS embedding")
    op.execute("DROP EXTENSION IF EXISTS vector")
