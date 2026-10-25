"""FastAPI entry point: REST routes + SmallWebRTC /api/offer endpoints (SPEC §8)."""

from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

from agent.evaluator import finalize_and_evaluate
from agent.pipeline import cancel_active_session, run_persona_agent
from config import settings
from database.db import get_session, init_db
from database.models import CallEvaluation, CallSession, Persona, TranscriptTurn
from schemas import api_schemas as schemas

small_webrtc_handler = SmallWebRTCRequestHandler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.sarvam_api_key:
        logger.warning(
            "SARVAM_API_KEY is not set — REST routes work, but voice calls and "
            "post-call evaluation will fail. Copy .env.example to .env."
        )
    await init_db()
    logger.info("database ready ({} )", settings.database_url)
    yield
    await small_webrtc_handler.close()
    logger.info("shutdown complete")


app = FastAPI(
    title="B2B Pitch Simulator API",
    description="Voice roleplay & pitch coaching backend (Pipecat + Sarvam)",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ------------------------------------------------------------------------ personas


@app.get("/api/personas", response_model=list[schemas.PersonaOut])
async def list_personas(db: AsyncSession = Depends(get_session)):
    rows = await db.execute(select(Persona).order_by(Persona.created_at))
    return rows.scalars().all()


@app.post(
    "/api/personas", response_model=schemas.PersonaOut, status_code=status.HTTP_201_CREATED
)
async def create_persona(payload: schemas.PersonaCreate, db: AsyncSession = Depends(get_session)):
    persona = Persona(**payload.model_dump())
    db.add(persona)
    await db.commit()
    await db.refresh(persona)
    return persona


# ------------------------------------------------------------------------ sessions


@app.post(
    "/api/sessions", response_model=schemas.SessionOut, status_code=status.HTTP_201_CREATED
)
async def create_session(payload: schemas.SessionCreate, db: AsyncSession = Depends(get_session)):
    persona = await db.get(Persona, payload.persona_id)
    if persona is None:
        raise HTTPException(status_code=404, detail="persona not found")
    session = CallSession(persona_id=payload.persona_id, product_context=payload.product_context)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@app.get("/api/sessions", response_model=list[schemas.SessionSummary])
async def list_sessions(db: AsyncSession = Depends(get_session)):
    rows = await db.execute(
        select(CallSession, Persona, CallEvaluation)
        .join(Persona, CallSession.persona_id == Persona.id)
        .outerjoin(CallEvaluation, CallEvaluation.session_id == CallSession.id)
        .order_by(CallSession.started_at.desc())
        .limit(100)
    )
    return [
        schemas.SessionSummary(
            id=session.id,
            persona_name=persona.name,
            language_mode=persona.language_mode,
            started_at=session.started_at,
            ended_at=session.ended_at,
            final_trust_score=session.final_trust_score,
            outcome=session.outcome,
            overall_score=evaluation.overall_score if evaluation else None,
        )
        for session, persona, evaluation in rows.all()
    ]


@app.get("/api/sessions/{session_id}", response_model=schemas.SessionDetail)
async def get_session(session_id: str, db: AsyncSession = Depends(get_session)):
    session = (
        await db.execute(
            select(CallSession)
            .options(
                selectinload(CallSession.persona),
                selectinload(CallSession.turns),
                selectinload(CallSession.evaluation),
            )
            .where(CallSession.id == session_id)
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    return schemas.SessionDetail(
        id=session.id,
        persona=schemas.PersonaOut.model_validate(session.persona),
        product_context=session.product_context,
        started_at=session.started_at,
        ended_at=session.ended_at,
        final_trust_score=session.final_trust_score,
        outcome=session.outcome,
        state_history=session.state_history or [],
        turns=[schemas.TranscriptTurnOut.model_validate(t) for t in session.turns],
        evaluation=(
            schemas.EvaluationOut.model_validate(session.evaluation)
            if session.evaluation is not None
            else None
        ),
        evaluation_status=_evaluation_status(session),
    )


def _evaluation_status(session: CallSession) -> schemas.EvaluationStatus:
    if session.ended_at is None:
        return "live"
    if session.evaluation is None:
        return "pending"
    return "ready" if session.evaluation.overall_score is not None else "failed"


@app.post("/api/sessions/{session_id}/end")
async def end_session(session_id: str, db: AsyncSession = Depends(get_session)):
    """Finalize the session (idempotent), stop any live pipeline, trigger evaluation."""
    session = await db.get(CallSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    if session.ended_at is not None:
        return {"status": "already_ended", "evaluation_status": _evaluation_status(session)}

    await cancel_active_session(session_id)

    # If no live pipeline existed (crash recovery / never connected), finalize here.
    # The pipeline's own finally-branch handles the normal disconnect path idempotently.
    fresh = await db.get(CallSession, session_id)
    if fresh.ended_at is None:
        trust = await _last_trust_snapshot(db, session_id)
        await finalize_and_evaluate(session_id, trust)

    return {"status": "ended", "evaluation_status": "pending"}


async def _last_trust_snapshot(db: AsyncSession, session_id: str) -> int:
    row = (
        await db.execute(
            select(TranscriptTurn.buyer_trust_snapshot)
            .where(
                TranscriptTurn.session_id == session_id,
                TranscriptTurn.buyer_trust_snapshot.is_not(None),
            )
            .order_by(TranscriptTurn.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return row if row is not None else 0


# ------------------------------------------------------- SmallWebRTC (voice calls)


@app.post("/api/offer")
async def webrtc_offer(
    request: SmallWebRTCRequest,
    background_tasks: BackgroundTasks,
    session_id: str = Query(..., description="Call session this SDP offer belongs to"),
    db: AsyncSession = Depends(get_session),
):
    """SmallWebRTC SDP offer/answer exchange. Spawns the persona agent on connect."""
    session = (
        await db.execute(
            select(CallSession)
            .options(selectinload(CallSession.persona))
            .where(CallSession.id == session_id)
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    if session.ended_at is not None:
        raise HTTPException(status_code=409, detail="session already ended")

    persona = session.persona
    product_context = session.product_context

    async def on_connection(connection):
        background_tasks.add_task(
            run_persona_agent, connection, session_id, persona, product_context
        )

    return await small_webrtc_handler.handle_web_request(
        request=request,
        webrtc_connection_callback=on_connection,
    )


@app.patch("/api/offer")
async def webrtc_ice_candidate(request: SmallWebRTCPatchRequest):
    """Trickle-ICE candidates routed to the cached connection by pc_id."""
    await small_webrtc_handler.handle_patch_request(request)
    return {"status": "success"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=False,
    )
