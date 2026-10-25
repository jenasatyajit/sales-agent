"""Buyer psychology state and the `update_buyer_state` LLM tool handler (SPEC §6.1).

Every tool execution: (1) mutates the in-memory BuyerState, (2) appends the event to
`call_sessions.state_history` in SQLite, (3) broadcasts an RTVI server message
(`BUYER_STATE_UPDATE`) that reaches the browser via `onServerMessage`.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
from pipecat.services.llm_service import FunctionCallParams
from sqlalchemy import select

from database.db import SessionLocal
from database.models import CallSession

DISPOSITIONS = (
    "guarded",
    "curious",
    "skeptical_about_switching",
    "convinced",
    "annoyed_ready_to_hang_up",
)

MIN_TRUST, MAX_TRUST = 0, 100
MAX_ABS_DELTA = 20

BUYER_STATE_TOOL_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "update_buyer_state",
        "description": (
            "Update your internal buyer psychology when the salesperson asks a great discovery "
            "question, triggers an objection, or feature-dumps."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "trust_delta": {
                    "type": "integer",
                    "description": (
                        "Change in trust between -20 and +20. Negative for generic pitches or "
                        "ignoring questions; positive for uncovering workflow pain or resolving "
                        "migration fears."
                    ),
                },
                "current_disposition": {
                    "type": "string",
                    "enum": list(DISPOSITIONS),
                },
                "active_objection": {
                    "type": "string",
                    "description": "The specific objection currently on your mind, or 'none'.",
                },
                "internal_monologue": {
                    "type": "string",
                    "description": "1-sentence private thought explaining why your trust shifted.",
                },
            },
            "required": ["trust_delta", "current_disposition", "internal_monologue"],
        },
    },
}


@dataclass
class BuyerState:
    trust_score: int
    disposition: str = "guarded"
    active_objection: str | None = None
    objections_resolved: set[str] = field(default_factory=set)


class StateTracker:
    """Holds the live buyer state for one call session and persists/broadcasts changes."""

    def __init__(self, session_id: str, initial_trust_score: int):
        self.session_id = session_id
        self.state = BuyerState(
            trust_score=max(MIN_TRUST, min(MAX_TRUST, initial_trust_score))
        )
        self._task = None  # PipelineTask, bound after assembly

    def bind_task(self, task) -> None:
        """Give the tracker a way to queue RTVI frames once the task exists."""
        self._task = task

    @property
    def trust_score(self) -> int:
        return self.state.trust_score

    # ------------------------------------------------------------- tool entry point

    async def handle_update(self, params: FunctionCallParams) -> None:
        """Registered on SarvamLLMService as the `update_buyer_state` handler."""
        try:
            event = self._apply(params.arguments or {})
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("update_buyer_state rejected args: {}", exc)
            await params.result_callback({"ok": False, "error": str(exc)})
            return

        await self._persist(event)
        await self._broadcast(event)
        await params.result_callback(
            {
                "ok": True,
                "trust_score": self.state.trust_score,
                "disposition": self.state.disposition,
            }
        )

    # ------------------------------------------------------------------- internals

    def _apply(self, args: dict) -> dict:
        delta = int(args["trust_delta"])
        delta = max(-MAX_ABS_DELTA, min(MAX_ABS_DELTA, delta))

        disposition = str(args["current_disposition"])
        if disposition not in DISPOSITIONS:
            raise ValueError(f"unknown disposition: {disposition!r}")

        raw_objection = str(args.get("active_objection", "none")).strip()
        new_objection = None if raw_objection.lower() in ("", "none", "null") else raw_objection

        previous = self.state.active_objection
        if previous is not None and previous != new_objection:
            # The buyer moved off an objection — treat it as addressed (SPEC rule 4 gate).
            self.state.objections_resolved.add(previous)

        self.state.trust_score = max(MIN_TRUST, min(MAX_TRUST, self.state.trust_score + delta))
        self.state.disposition = disposition
        self.state.active_objection = new_objection

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "trust_delta": delta,
            "trust_score": self.state.trust_score,
            "disposition": disposition,
            "active_objection": new_objection,
            "internal_monologue": str(args.get("internal_monologue", "")).strip(),
        }

    async def _persist(self, event: dict) -> None:
        """Append the event to call_sessions.state_history (reassignment, not in-place)."""
        try:
            async with SessionLocal() as db:
                row = (
                    await db.execute(
                        select(CallSession).where(CallSession.id == self.session_id)
                    )
                ).scalar_one_or_none()
                if row is None:
                    logger.warning("state_history: session {} not found", self.session_id)
                    return
                row.state_history = (row.state_history or []) + [event]
                await db.commit()
        except Exception:
            # The call must survive a DB hiccup; the in-memory state stays authoritative.
            logger.exception("failed to persist state_history for {}", self.session_id)

    async def _broadcast(self, event: dict) -> None:
        if self._task is None:
            logger.warning("no bound task; BUYER_STATE_UPDATE not broadcast")
            return
        payload = {
            "type": "BUYER_STATE_UPDATE",
            "session_id": self.session_id,
            **event,
            "objections_resolved": sorted(self.state.objections_resolved),
        }
        try:
            await self._task.queue_frames([RTVIServerMessageFrame(data=payload)])
        except Exception:
            logger.exception("failed to queue BUYER_STATE_UPDATE frame")
