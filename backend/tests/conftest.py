"""Test bootstrap: point the app at a throwaway SQLite DB *before* it is imported."""

import os
import tempfile

_TMP_DIR = tempfile.mkdtemp(prefix="pitch-sim-test-")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP_DIR}/test.db"
os.environ["SARVAM_API_KEY"] = "test-key-not-real"
os.environ["ALLOWED_ORIGIN"] = "http://localhost:3000"

import pytest_asyncio  # noqa: E402


@pytest_asyncio.fixture
async def client():
    from httpx import ASGITransport, AsyncClient

    from database.db import init_db
    from main import app

    await init_db()  # lifespan doesn't run under ASGITransport
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
