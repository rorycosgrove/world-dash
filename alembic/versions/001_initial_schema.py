"""Initial schema

Revision ID: 001
Revises: 
Create Date: 2026-03-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from geoalchemy2 import Geometry

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable PostGIS extension
    op.execute('CREATE EXTENSION IF NOT EXISTS postgis')

    # Create sources table
    op.create_table(
        'sources',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('url', sa.String(2048), nullable=False, unique=True),
        sa.Column('type', sa.Enum('rss', 'atom', 'api', 'manual', name='sourcetype'), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, default=True),
        sa.Column('tags', postgresql.ARRAY(sa.String()), nullable=False, server_default='{}'),
        sa.Column('last_polled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_success_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('error_count', sa.Integer(), nullable=False, default=0),
        sa.Column('total_events', sa.Integer(), nullable=False, default=0),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_sources_name', 'sources', ['name'])
    op.create_index('ix_sources_enabled', 'sources', ['enabled'])

    # Create events table
    op.create_table(
        'events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('source_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('sources.id'), nullable=False),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('url', sa.String(2048), nullable=False),
        sa.Column('content_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('raw_content', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum('raw', 'normalized', 'enriched', 'processed', 'failed', name='eventstatus'), nullable=False),
        sa.Column('severity', sa.Enum('low', 'medium', 'high', 'critical', name='eventseverity'), nullable=True),
        sa.Column('risk_score', sa.Float(), nullable=True),
        sa.Column('tags', postgresql.ARRAY(sa.String()), nullable=False, server_default='{}'),
        sa.Column('entities', postgresql.JSONB(), nullable=True),
        sa.Column('location', postgresql.JSONB(), nullable=True),
        sa.Column('location_point', Geometry('POINT', srid=4326), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_events_source_id', 'events', ['source_id'])
    op.create_index('ix_events_url', 'events', ['url'])
    op.create_index('ix_events_content_hash', 'events', ['content_hash'])
    op.create_index('ix_events_status', 'events', ['status'])
    op.create_index('ix_events_severity', 'events', ['severity'])
    op.create_index('ix_events_risk_score', 'events', ['risk_score'])
    op.create_index('ix_events_published_at', 'events', ['published_at'])
    op.create_index('ix_events_location_point', 'events', ['location_point'], postgresql_using='gist')

    # Create alerts table
    op.create_table(
        'alerts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('event_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('events.id'), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('severity', sa.Enum('low', 'medium', 'high', 'critical', name='eventseverity'), nullable=False),
        sa.Column('acknowledged', sa.Boolean(), nullable=False, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_alerts_event_id', 'alerts', ['event_id'])
    op.create_index('ix_alerts_severity', 'alerts', ['severity'])
    op.create_index('ix_alerts_acknowledged', 'alerts', ['acknowledged'])


def downgrade() -> None:
    op.drop_index('ix_alerts_acknowledged', 'alerts')
    op.drop_index('ix_alerts_severity', 'alerts')
    op.drop_index('ix_alerts_event_id', 'alerts')
    op.drop_table('alerts')

    op.drop_index('ix_events_location_point', 'events')
    op.drop_index('ix_events_published_at', 'events')
    op.drop_index('ix_events_risk_score', 'events')
    op.drop_index('ix_events_severity', 'events')
    op.drop_index('ix_events_status', 'events')
    op.drop_index('ix_events_content_hash', 'events')
    op.drop_index('ix_events_url', 'events')
    op.drop_index('ix_events_source_id', 'events')
    op.drop_table('events')

    op.drop_index('ix_sources_enabled', 'sources')
    op.drop_index('ix_sources_name', 'sources')
    op.drop_table('sources')

    op.execute('DROP TYPE IF EXISTS eventseverity')
    op.execute('DROP TYPE IF EXISTS eventstatus')
    op.execute('DROP TYPE IF EXISTS sourcetype')
