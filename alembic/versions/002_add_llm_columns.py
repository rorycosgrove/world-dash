"""Add LLM semantic columns to events

Revision ID: 002
Revises: 001
Create Date: 2026-03-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add LLM-extracted semantic columns
    op.add_column('events', sa.Column('categories', postgresql.ARRAY(sa.String()), nullable=False, server_default='{}'))
    op.add_column('events', sa.Column('actors', postgresql.ARRAY(sa.String()), nullable=False, server_default='{}'))
    op.add_column('events', sa.Column('themes', postgresql.ARRAY(sa.String()), nullable=False, server_default='{}'))
    op.add_column('events', sa.Column('llm_significance', sa.String(20), nullable=True))
    op.add_column('events', sa.Column('llm_processed_at', sa.DateTime(timezone=True), nullable=True))

    # GIN indexes for fast array overlap queries
    op.execute('CREATE INDEX ix_events_categories ON events USING GIN (categories)')
    op.execute('CREATE INDEX ix_events_actors ON events USING GIN (actors)')
    op.execute('CREATE INDEX ix_events_themes ON events USING GIN (themes)')
    op.create_index('ix_events_llm_processed_at', 'events', ['llm_processed_at'])


def downgrade() -> None:
    op.drop_index('ix_events_llm_processed_at', 'events')
    op.execute('DROP INDEX IF EXISTS ix_events_themes')
    op.execute('DROP INDEX IF EXISTS ix_events_actors')
    op.execute('DROP INDEX IF EXISTS ix_events_categories')
    op.drop_column('events', 'llm_processed_at')
    op.drop_column('events', 'llm_significance')
    op.drop_column('events', 'themes')
    op.drop_column('events', 'actors')
    op.drop_column('events', 'categories')
