"""Post-call LLM analysis service (SPEC §7, BACKEND.md D8).

Runs after hangup as a background asyncio task: grades the founder's pitch against
the persona's hidden pain points / switching objections via Sarvam's
OpenAI-compatible chat-completions endpoint, and stores a `call_evaluations` row.
A failed run is recorded with NULL scores rather than crashing or vanishing.
"""

import asyncio
import json
import re
from datetime import datetime, timezone

from loguru import logger
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from agent.prompts import build_evaluator_messages
from config import settings
from database.db import SessionLocal
from database.models import CallEvaluation, CallSession, Persona, TranscriptTurn
from schemas.api_schemas import EvaluationResult

SARVAM_BASE_URL = "https://api.sarvam.ai/v2"  # /v1 hosts sarvam-105b-conversations only
EVALUATOR_MODEL = "sarvam-105b"

_client = AsyncOpenAI(api_key=settings.sarvam_api_key, base_url=SARVAM_BASE_URL)

# Strong references so the event loop doesn't garbage-collect in-flight evaluations.
_EVALUATION_TASKS: set[asyncio.Task] = set()


async def finalize_and_evaluate(session_id: str, final_trust_score: int) -> None:
    """Mark the session ended (idempotent) and schedule the LLM evaluation.

    Called from the pipeline's `finally` (disconnect or cancel) and from
    POST /api/sessions/{id}/end when no live task exists (crash recovery).
    """
    async with SessionLocal() as db:
        row = (
            await db.execute(select(CallSession).where(CallSession.id == session_id))
        ).scalar_one_or_none()
        if row is None:
            logger.warning("finalize: session {} not found", session_id)
            return
        already_ended = row.ended_at is not None
        if not already_ended:
            row.ended_at = datetime.now(timezone.utc)
            row.final_trust_score = final_trust_score
            await db.commit()

    if already_ended:
        logger.debug("session {} already finalized; skipping", session_id)
        return

    task = asyncio.create_task(evaluate_session(session_id))
    _EVALUATION_TASKS.add(task)
    task.add_done_callback(_EVALUATION_TASKS.discard)


async def evaluate_session(session_id: str) -> None:
    async with SessionLocal() as db:
        row = (
            await db.execute(
                select(CallSession)
                .options(
                    selectinload(CallSession.persona),
                    selectinload(CallSession.turns),
                )
                .where(CallSession.id == session_id)
            )
        ).scalar_one_or_none()
        if row is None or row.persona is None:
            logger.warning("evaluate: session {} or persona missing", session_id)
            return

        persona: Persona = row.persona
        turns: list[TranscriptTurn] = list(row.turns)
        state_history: list[dict] = row.state_history or []

        # Upsert target: clear any previous (possibly failed) evaluation row.
        existing = (
            await db.execute(
                select(CallEvaluation).where(CallEvaluation.session_id == session_id)
            )
        ).scalar_one_or_none()
        if existing is not None:
            await db.delete(existing)
            await db.commit()

        evaluation = CallEvaluation(session_id=session_id)

        if not turns:
            evaluation.actionable_feedback = "No transcript was recorded for this call."
            db.add(evaluation)
            await db.commit()
            logger.warning("session {} has no transcript; marked failed", session_id)
            return

        messages = build_evaluator_messages(persona, row, turns, state_history)
        try:
            parsed = await _run_evaluator(messages)
        except Exception as exc:
            logger.exception("evaluator failed for session {}", session_id)
            evaluation.actionable_feedback = f"Evaluation failed: {exc}"
            db.add(evaluation)
            await db.commit()
            return

        evaluation.overall_score = parsed.overall_score
        evaluation.discovery_depth_score = parsed.discovery_depth_score
        evaluation.objection_handling_score = parsed.objection_handling_score
        evaluation.value_clarity_score = parsed.value_clarity_score
        evaluation.feature_dumping_detected = parsed.feature_dumping_detected
        evaluation.missed_cues = parsed.missed_cues
        evaluation.actionable_feedback = parsed.actionable_feedback
        db.add(evaluation)

        session_row = await db.get(CallSession, session_id)
        if session_row is not None and session_row.outcome is None:
            session_row.outcome = parsed.outcome or _derived_outcome(
                state_history, parsed.overall_score
            )
        await db.commit()
        logger.info(
            "evaluation stored for session {} (overall={})", session_id, parsed.overall_score
        )


async def _run_evaluator(messages: list[dict]) -> EvaluationResult:
    """Call the evaluator LLM; retry once if the response is not valid scorecard JSON."""
    last_error: Exception | None = None
    for attempt in range(2):
        attempt_messages = list(messages)
        if attempt == 1:
            attempt_messages.append(
                {
                    "role": "user",
                    "content": "Your previous response was not valid JSON. "
                    "Return ONLY the JSON object with the exact required keys.",
                }
            )
        response = await _client.chat.completions.create(
            model=EVALUATOR_MODEL,
            messages=attempt_messages,
            temperature=0.2,
            max_tokens=2000,
            extra_body={"reasoning_effort": "high"},
        )
        raw = response.choices[0].message.content or ""
        try:
            return _parse_strict_json(raw)
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            logger.warning("evaluator attempt {} returned unparseable JSON", attempt + 1)
    raise ValueError(f"evaluator never returned valid JSON: {last_error}")


def _parse_strict_json(raw: str) -> EvaluationResult:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Tolerate commentary around the JSON object.
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        data = json.loads(match.group(0))
    return EvaluationResult.model_validate(data)


def _derived_outcome(state_history: list[dict], final_trust: int) -> str:
    """Heuristic outcome when the evaluator LLM omits one: objections raised count
    as resolved only if trust ended at the consent threshold."""
    objections = {
        str(event["active_objection"])
        for event in state_history
        if isinstance(event, dict) and event.get("active_objection")
    }
    resolved = objections if final_trust >= 75 else set()
    return heuristic_outcome(final_trust, state_history, resolved)


def heuristic_outcome(
    final_trust_score: int, state_history: list[dict], objections_resolved: set[str]
) -> str:
    """Fallback outcome mapping when the evaluator omits one (BACKEND.md Phase 3)."""
    if final_trust_score >= 75 and objections_resolved:
        return "converted"
    if final_trust_score < 40:
        return "rejected"
    last_disposition = ""
    for event in reversed(state_history):
        if isinstance(event, dict) and event.get("disposition"):
            last_disposition = str(event["disposition"])
            break
    if final_trust_score >= 50 and last_disposition in (
        "curious",
        "skeptical_about_switching",
    ):
        return "follow_up_booked"
    return "stalled"
