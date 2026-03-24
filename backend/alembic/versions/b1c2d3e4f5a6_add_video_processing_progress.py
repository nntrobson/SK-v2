"""Add video processing progress columns

Revision ID: b1c2d3e4f5a6
Revises: 295c3a9c54e9
Create Date: 2026-03-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "295c3a9c54e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("processing_progress", sa.Float(), nullable=True))
    op.add_column("videos", sa.Column("processing_stage", sa.String(), nullable=True))
    op.add_column("videos", sa.Column("processing_started_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "processing_started_at")
    op.drop_column("videos", "processing_stage")
    op.drop_column("videos", "processing_progress")
