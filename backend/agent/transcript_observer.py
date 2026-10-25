"""Records user/assistant turns to SQLite (SPEC §4.3).

Design note: rather than sniffing individual text frames (LLM token frames and
TTS sentence frames would double-count), the observer sits at the tail of the
pipeline and *diffs the LLM context message list* on turn boundaries. Every
message the aggregators append (user turn, assistant reply) is persisted exactly
once, tagged with the buyer's trust snapshot at that moment.
"""

from datetime import datetime, timezone
from typing import Any

from loguru import logger
from pipecat.frames.frames import BotStoppedSpeakingFrame, EndFrame, Frame, UserStoppedSpeakingFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import SessionLocal
from database.models import TranscriptTurn


def _content_to_text(content: Any) -> str:
    """LLM context content is a string or a list of typed parts."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text", "")))
            elif isinstance(part, str):
                parts.append(part)
        return "".join(parts)
    return ""


class TranscriptObserver(FrameProcessor):
    def __init__(self, context: Any, tracker: Any, session_id: str):
        super().__init__()
        self._context = context  # LLMContext
        self._tracker = tracker  # StateTracker
        self._session_id = session_id
        self._cursor = 0  # index of the first context message not yet persisted

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, (UserStoppedSpeakingFrame, BotStoppedSpeakingFrame, EndFrame)):
            try:
                await self._flush()
            except Exception:
                logger.exception("transcript flush failed for session {}", self._session_id)

        await self.push_frame(frame, direction)

    async def _flush(self) -> None:
        messages = self._context.messages
        new_messages = messages[self._cursor:]
        self._cursor = len(messages)

        rows: list[tuple[str, str]] = []
        for message in new_messages:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            if role not in ("user", "assistant"):
                continue  # system / developer / tool results are not transcript turns
            if message.get("tool_calls"):
                continue  # assistant tool-call shell; the spoken reply arrives separately
            text = _content_to_text(message.get("content")).strip()
            if text:
                rows.append((role, text))

        if not rows:
            return

        async with SessionLocal() as db:
            await _insert_turns(
                db, self._session_id, rows, self._tracker.trust_score
            )


async def _insert_turns(
    db: AsyncSession, session_id: str, rows: list[tuple[str, str]], trust: int
) -> None:
    now = datetime.now(timezone.utc)
    for role, text in rows:
        db.add(
            TranscriptTurn(
                session_id=session_id,
                speaker="user" if role == "user" else "assistant",
                text=text,
                timestamp=now,
                buyer_trust_snapshot=trust,
            )
        )
    await db.commit()
    logger.debug("persisted {} transcript turn(s) for {}", len(rows), session_id)
