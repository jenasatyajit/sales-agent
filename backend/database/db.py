"""Async SQLAlchemy engine/session factory and startup initialisation (BACKEND.md Phase 0)."""

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, echo=False)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """WAL + busy timeout: the pipeline writes (state history, transcript turns)
    overlap with REST request writes, which plain-journal SQLite would reject with
    'database is locked'."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a scoped async session per request."""
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create tables (if missing) and seed default personas. Idempotent (D5).

    Models are imported here rather than at module top so their table definitions
    register on Base.metadata without an import cycle (models imports Base from us).
    """
    import database.models as _models  # noqa: F401  (registers ORM tables)
    from database.seed import seed_default_personas

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as session:
        await seed_default_personas(session)
