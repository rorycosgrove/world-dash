"""Add clusters and chat_messages tables

Revision ID: 005
Revises: 004
Create Date: 2026-03-02 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Clusters ---
    op.create_table(
        "clusters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("keywords", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("centroid", postgresql.ARRAY(sa.Float()), nullable=True),
        sa.Column("auto_generated", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "cluster_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "cluster_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clusters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("similarity", sa.Float(), nullable=True),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("cluster_id", "event_id", name="uq_cluster_event"),
    )
    op.create_index("ix_cluster_events_cluster_id", "cluster_events", ["cluster_id"])
    op.create_index("ix_cluster_events_event_id", "cluster_events", ["event_id"])

    # --- Chat Messages ---
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", sa.String(100), nullable=False, index=True),
        sa.Column("role", sa.String(20), nullable=False),  # 'user' | 'assistant' | 'system'
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("context_event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("events.id"), nullable=True),
        sa.Column("context_cluster_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clusters.id"), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Add vector column via raw SQL (pgvector type not natively in SA column defs)
    op.execute("ALTER TABLE chat_messages ADD COLUMN embedding vector(768)")

    # session_id index is auto-created by index=True above
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"])


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("cluster_events")
    op.drop_table("clusters")
