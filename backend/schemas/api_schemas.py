"""Pydantic request/response schemas for the REST API (SPEC §8)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

LanguageMode = Literal["en-IN", "hi-IN", "codemix"]
CallScenario = Literal["cold_call", "warm_discovery", "demo_objection"]
Outcome = Literal["converted", "follow_up_booked", "stalled", "rejected"]
EvaluationStatus = Literal["live", "pending", "ready", "failed"]


# --------------------------------------------------------------------------- personas


class PersonaCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role_title: str = Field(min_length=1, max_length=120)
    company_profile: str = Field(min_length=1, max_length=255)
    language_mode: LanguageMode = "en-IN"
    sarvam_voice_id: str = Field(min_length=1, max_length=64)
    status_quo_stack: list[str] = Field(default_factory=list)
    hidden_pain_points: list[str] = Field(default_factory=list)
    switching_objections: list[str] = Field(default_factory=list)
    call_scenario: CallScenario = "cold_call"
    initial_trust_score: int = Field(default=25, ge=0, le=100)


class PersonaOut(PersonaCreate):
    id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------- sessions


class SessionCreate(BaseModel):
    persona_id: str
    product_context: str = Field(min_length=1)


class SessionOut(BaseModel):
    id: str
    persona_id: str
    started_at: datetime
    ended_at: datetime | None = None
    final_trust_score: int | None = None
    outcome: Outcome | None = None

    model_config = ConfigDict(from_attributes=True)


class SessionSummary(BaseModel):
    """Row for the dashboard's analytics summary table (trend analysis)."""

    id: str
    persona_name: str
    language_mode: LanguageMode
    started_at: datetime
    ended_at: datetime | None
    final_trust_score: int | None
    outcome: Outcome | None
    overall_score: int | None


class TranscriptTurnOut(BaseModel):
    id: int
    speaker: Literal["user", "assistant"]
    text: str
    timestamp: datetime
    buyer_trust_snapshot: int | None = None

    model_config = ConfigDict(from_attributes=True)


class EvaluationOut(BaseModel):
    id: str
    session_id: str
    overall_score: int | None = None
    discovery_depth_score: int | None = None
    objection_handling_score: int | None = None
    value_clarity_score: int | None = None
    feature_dumping_detected: bool | None = None
    missed_cues: list[str] = Field(default_factory=list)
    actionable_feedback: str = ""

    model_config = ConfigDict(from_attributes=True)


class SessionDetail(BaseModel):
    """Full payload for the post-call analysis view (SPEC §9.4)."""

    id: str
    persona: PersonaOut
    product_context: str
    started_at: datetime
    ended_at: datetime | None
    final_trust_score: int | None
    outcome: Outcome | None
    state_history: list[dict[str, Any]]
    turns: list[TranscriptTurnOut]
    evaluation: EvaluationOut | None
    evaluation_status: EvaluationStatus


# ------------------------------------------------------------------ evaluator contract


class EvaluationResult(BaseModel):
    """Strict-JSON contract the post-call evaluator LLM must return (SPEC §7)."""

    overall_score: int = Field(ge=0, le=100)
    discovery_depth_score: int = Field(ge=0, le=100)
    objection_handling_score: int = Field(ge=0, le=100)
    value_clarity_score: int = Field(ge=0, le=100)
    feature_dumping_detected: bool
    missed_cues: list[str] = Field(default_factory=list)
    actionable_feedback: str = Field(min_length=1)
    # Optional: if the evaluator omits an invalid outcome, the backend derives one
    # heuristically from the buyer state timeline (agent/evaluator.py).
    outcome: Outcome | None = None

    @field_validator("missed_cues", mode="before")
    @classmethod
    def _clean_missed_cues(cls, value: object) -> list[str]:
        """Tolerate nulls/None entries or a bare string coming back from the LLM."""
        if isinstance(value, str):
            return [value] if value.strip() else []
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]
