"""ORM models for the four tables defined in SPEC §4."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Persona(Base):
    __tablename__ = "personas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    role_title: Mapped[str] = mapped_column(String(120))
    company_profile: Mapped[str] = mapped_column(String(255))
    # "en-IN" | "hi-IN" | "codemix"
    language_mode: Mapped[str] = mapped_column(String(16), default="en-IN")
    # bulbul:v4-flash catalogue ID: <name>_<lang>_<style>, e.g. "aayan_hi_conversational"
    sarvam_voice_id: Mapped[str] = mapped_column(String(64))
    status_quo_stack: Mapped[list] = mapped_column(JSON, default=list)
    hidden_pain_points: Mapped[list] = mapped_column(JSON, default=list)
    switching_objections: Mapped[list] = mapped_column(JSON, default=list)
    # "cold_call" | "warm_discovery" | "demo_objection"
    call_scenario: Mapped[str] = mapped_column(String(32), default="cold_call")
    initial_trust_score: Mapped[int] = mapped_column(Integer, default=25)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    sessions: Mapped[list["CallSession"]] = relationship(back_populates="persona")


class CallSession(Base):
    __tablename__ = "call_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    persona_id: Mapped[str] = mapped_column(String(36), ForeignKey("personas.id"))
    product_context: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    final_trust_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "converted" | "follow_up_booked" | "stalled" | "rejected"
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Appended by the update_buyer_state tool handler. NOTE: always reassign this list
    # (obj.state_history = obj.state_history + [event]) — in-place appends are not
    # detected by SQLAlchemy's change tracking on plain JSON columns.
    state_history: Mapped[list] = mapped_column(JSON, default=list)

    persona: Mapped["Persona"] = relationship(back_populates="sessions")
    turns: Mapped[list["TranscriptTurn"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="TranscriptTurn.id",
    )
    evaluation: Mapped["CallEvaluation | None"] = relationship(
        back_populates="session", cascade="all, delete-orphan", uselist=False
    )


class TranscriptTurn(Base):
    __tablename__ = "transcript_turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("call_sessions.id"))
    # "user" (founder) | "assistant" (buyer persona)
    speaker: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    buyer_trust_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)

    session: Mapped["CallSession"] = relationship(back_populates="turns")


class CallEvaluation(Base):
    __tablename__ = "call_evaluations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("call_sessions.id"), unique=True
    )
    # Scores are nullable so a failed evaluation run can be recorded without fake numbers.
    overall_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    discovery_depth_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    objection_handling_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    value_clarity_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feature_dumping_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    missed_cues: Mapped[list] = mapped_column(JSON, default=list)
    actionable_feedback: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    session: Mapped["CallSession"] = relationship(back_populates="evaluation")
