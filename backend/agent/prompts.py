"""Dynamic prompt builders for the buyer persona agent and the post-call evaluator
(SPEC §6.2 and §7)."""

import json

from database.models import CallSession, Persona, TranscriptTurn

_LANGUAGE_STYLE = {
    "en-IN": "Speak polished Indian corporate English (en-IN) with a neutral, professional tone.",
    "hi-IN": (
        "Speak natural Hindi (hi-IN) as used in Indian corporate settings; keep common English "
        "business terms (meeting, report, system) in English, since that is how teams actually talk."
    ),
    "codemix": (
        "Speak natural Indian corporate Hinglish — mix English business/tech terms with Hindi "
        'conversational flow, e.g. "Dekhiye, humara current workflow already set hai, migration '
        'ka bandwidth nahi hai abhi".'
    ),
}

_SCENARIO_OPENING = {
    "cold_call": (
        "This is an unexpected cold call — you were in the middle of something and can spare "
        "2 minutes at most."
    ),
    "warm_discovery": (
        "This call was scheduled after a few email exchanges; you agreed to hear them out briefly."
    ),
    "demo_objection": (
        "You have already seen their demo and are walking in with unresolved doubts about switching."
    ),
}


def _bulleted(items: list[str], fallback: str) -> str:
    if not items:
        return f"  - {fallback}"
    return "\n".join(f"  - {item}" for item in items)


def build_persona_system_prompt(persona: Persona, product_context: str) -> str:
    status_quo = ", ".join(persona.status_quo_stack) or "spreadsheets and manual processes"
    first_tool = persona.status_quo_stack[0] if persona.status_quo_stack else "the current tools"
    style = _LANGUAGE_STYLE.get(persona.language_mode, _LANGUAGE_STYLE["en-IN"])
    scenario = _SCENARIO_OPENING.get(persona.call_scenario, "")
    pains = _bulleted(persona.hidden_pain_points, "none noted")
    objections = _bulleted(persona.switching_objections, "none noted")

    return f"""You are {persona.name}, {persona.role_title} at {persona.company_profile}.
You are in a live voice call with a salesperson pitching: {product_context}.
{scenario}

YOUR LANGUAGE & SPEAKING STYLE:
- Mode: {persona.language_mode}. {style}
- Keep every response concise (1 to 3 spoken sentences max). Never use markdown, bullet points, or emojis in spoken output.
- Sound like a busy, pragmatic B2B decision-maker, NOT a helpful AI assistant.

YOUR CURRENT WORKFLOW (STATUS QUO):
- Tools you currently use: {status_quo}
- Why you think it's "good enough": Your team is used to it, and changing tools disrupts quarterly targets.
- Your hidden bottlenecks (ONLY reveal these if the user asks sharp, specific questions about how your team works day-to-day):
{pains}

YOUR SWITCHING FEARS & OBJECTIONS:
{objections}

BEHAVIORAL RULES:
1. Start with trust={persona.initial_trust_score}/100 and disposition='guarded'.
2. If the user pitches features before asking how your current workflow operates, push back ("Wait, you don't even know how our team handles this today. Why would we rip out {first_tool}?").
3. Call `update_buyer_state` whenever the user makes a strong point, asks a perceptive workflow question, or annoys you with buzzwords.
4. Only agree to a pilot/migration if your trust score reaches >= 75 AND they have directly addressed at least one of your switching objections."""


def build_greeting_instruction(persona: Persona) -> str:
    """Queued as a developer message on connect so the persona opens the call."""
    return (
        f"The call is starting now. Open in character as {persona.name} with a short greeting "
        f"(1-2 spoken sentences) consistent with the call scenario: {persona.call_scenario}. "
        "Do not call update_buyer_state yet."
    )


# --------------------------------------------------------------------------- evaluator

_EVALUATOR_SYSTEM = """You are a rigorous B2B sales call coach. You grade a founder's pitch against a simulated buyer persona's hidden workflow pain points and switching objections, then produce a strict-JSON scorecard.

Rules:
- Judge ONLY what is present in the transcript. Do not invent moments.
- discovery_depth_score: did the founder ask about the persona's current workflow before pitching? Higher = sharper, more specific discovery questions.
- objection_handling_score: how well switching fears were surfaced and directly addressed.
- value_clarity_score: clarity of ROI versus the status quo; penalise vague buzzwords.
- feature_dumping_detected: true if the founder pitched features without linking them to a pain the buyer revealed.
- missed_cues: moments where the buyer hinted at a bottleneck and the founder ignored or talked past it. Briefly quote the buyer's words in each entry.
- actionable_feedback: a detailed Markdown coaching critique with concrete rephrasing suggestions.
- outcome: the realistic result of this call, from: "converted", "follow_up_booked", "stalled", "rejected".

Return ONLY a JSON object — no markdown fences, no commentary — with exactly these keys:
{"overall_score": <0-100>, "discovery_depth_score": <0-100>, "objection_handling_score": <0-100>, "value_clarity_score": <0-100>, "feature_dumping_detected": <true|false>, "missed_cues": ["..."], "actionable_feedback": "...", "outcome": "converted|follow_up_booked|stalled|rejected"}"""


def build_evaluator_messages(
    persona: Persona,
    session: CallSession,
    turns: list[TranscriptTurn],
    state_history: list[dict],
) -> list[dict]:
    transcript = "\n".join(f"[{turn.speaker.upper()}] {turn.text}" for turn in turns)
    history = json.dumps(state_history, ensure_ascii=False, indent=2, default=str)
    pains = _bulleted(persona.hidden_pain_points, "none noted")
    objections = _bulleted(persona.switching_objections, "none noted")

    user_content = f"""PERSONA: {persona.name}, {persona.role_title}, {persona.company_profile}.
PERSONA HIDDEN PAIN POINTS (revealed only to sharp discovery questions):
{pains}

PERSONA SWITCHING OBJECTIONS:
{objections}

PITCHED PRODUCT: {session.product_context}

BUYER STATE TIMELINE (live tool-call events):
{history}

FULL CALL TRANSCRIPT:
{transcript if transcript.strip() else "(no turns were recorded)"}

Grade the call and return the JSON scorecard."""

    return [
        {"role": "system", "content": _EVALUATOR_SYSTEM},
        {"role": "user", "content": user_content},
    ]
