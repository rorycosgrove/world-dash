"""Add auth columns to sources

Revision ID: 003
Revises: 002_add_llm_columns
Create Date: 2025-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "003_add_source_auth"
down_revision = "002_add_llm_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sources", sa.Column("auth_header", sa.String(200), nullable=True))
    op.add_column("sources", sa.Column("auth_token", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sources", "auth_token")
    op.drop_column("sources", "auth_header")
