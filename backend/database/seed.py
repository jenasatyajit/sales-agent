"""Default B2B buyer personas (SPEC §10). Seeded once on an empty database."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Persona

# Voice IDs are bulbul:v4-flash catalogue entries (<name>_<lang>_<style>).
DEFAULT_PERSONAS: list[dict] = [
    {
        "name": "Rohan Kapoor",
        "role_title": "VP of Engineering",
        "company_profile": "180-person Series B fintech SaaS in Bengaluru",
        "language_mode": "en-IN",
        "sarvam_voice_id": "simran_en_conversation",
        "status_quo_stack": [
            "Jira",
            "Excel exports",
            "Home-grown Python scripts",
            "Slack threads",
        ],
        "hidden_pain_points": [
            "Sprint reporting eats 6 hours of every manager's week — manual Jira-to-Excel exports",
            "Zero visibility into cross-team velocity until month-end retrospectives",
            "Release approvals live in Slack threads nobody can audit later",
        ],
        "switching_objections": [
            "Migration downtime during a release cycle",
            "Team retraining fatigue after the last tool rollout flopped",
            "Security review for anything touching customer data",
        ],
        "call_scenario": "warm_discovery",
        "initial_trust_score": 25,
    },
    {
        "name": "Vikram Mehta",
        "role_title": "Head of Operations",
        "company_profile": "250-person Series B Logistics SaaS in Bengaluru",
        "language_mode": "codemix",
        "sarvam_voice_id": "ishita_enhi_customer",
        "status_quo_stack": ["Excel", "WhatsApp groups", "Zoho", "Tally"],
        "hidden_pain_points": [
            "Dispatch updates compiled by hand from 14 WhatsApp groups every evening",
            "Billing reconciliation errors cost roughly 2 working days every month",
            "No single source of truth for fleet status — drivers phone it in",
        ],
        "switching_objections": [
            "Migration downtime",
            "Team retraining fatigue",
            "Security compliance",
        ],
        "call_scenario": "cold_call",
        "initial_trust_score": 20,
    },
    {
        "name": "Rajesh Bansal",
        "role_title": "Director of IT",
        "company_profile": "120-person enterprise manufacturing group in Pune",
        "language_mode": "hi-IN",
        "sarvam_voice_id": "aayan_hi_conversational",
        "status_quo_stack": ["SAP Business One", "Excel", "Phone calls"],
        "hidden_pain_points": [
            "Field staff report by phone; a data-entry team types it into Excel the next day",
            "Director-level reports take a week to compile and are stale on arrival",
            "Stock mismatches surface only during the monthly audit",
        ],
        "switching_objections": [
            "Existing SAP investment must not be wasted",
            "Staff training across a mixed Hindi/English workforce",
            "No downtime allowed during audit season",
        ],
        "call_scenario": "demo_objection",
        "initial_trust_score": 30,
    },
]


async def seed_default_personas(session: AsyncSession) -> None:
    """Insert the default personas if the table is empty; otherwise do nothing."""
    existing = (await session.execute(select(Persona).limit(1))).scalar_one_or_none()
    if existing is not None:
        return
    for data in DEFAULT_PERSONAS:
        session.add(Persona(**data))
    await session.commit()
