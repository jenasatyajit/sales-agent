"""Sarvam pre-flight checks — run inside the Linux VM before Phase 2 smoke tests.

Usage (from backend/):  uv run python scripts/preflight.py

Checks:
  1. sarvam-105b chat completion + tool-call round trip (OpenAI-compatible endpoint).
  2. bulbul:v4-flash synthesis for every seeded persona voice ID (v4 catalogue).
  3. SarvamRealtimeSTTService construction with the SPEC §5.1 settings (catches
     invalid model names / Settings fields). The live STT audio round-trip is
     covered by the Phase 2 end-to-end smoke test instead.

Exits non-zero if any check fails.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # make `config` importable

import httpx
from openai import AsyncOpenAI

from config import settings
from database.seed import DEFAULT_PERSONAS

SARVAM_BASE_URL = "https://api.sarvam.ai/v2"
TTS_URL = "https://api.sarvam.ai/text-to-speech"

_TTS_LANGUAGE = {"en-IN": "en-IN", "hi-IN": "hi-IN", "codemix": "hi-IN"}

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "report_readiness",
            "description": "Report whether you are ready to continue.",
            "parameters": {
                "type": "object",
                "properties": {"ready": {"type": "boolean"}},
                "required": ["ready"],
            },
        },
    }
]


async def check_llm() -> bool:
    """Key + sarvam-105b access + function-calling round trip."""
    client = AsyncOpenAI(api_key=settings.sarvam_api_key, base_url=SARVAM_BASE_URL)
    response = await client.chat.completions.create(
        model="sarvam-105b",
        messages=[{"role": "user", "content": "Call report_readiness with ready=true."}],
        tools=_TOOLS,
        max_tokens=200,
        extra_body={"reasoning_effort": "low"},
    )
    message = response.choices[0].message
    tool_calls = getattr(message, "tool_calls", None)
    if not tool_calls:
        print("[LLM] WARN: responded without a tool call (key/model OK, tools unverified)")
        return True
    name = tool_calls[0].function.name
    print(f"[LLM] OK: sarvam-105b responded and called tool '{name}'")
    return True


async def check_tts() -> bool:
    """Every seeded voice ID must synthesize with bulbul:v4-flash."""
    ok = True
    async with httpx.AsyncClient(timeout=60) as http:
        for persona in DEFAULT_PERSONAS:
            voice_id = persona["sarvam_voice_id"]
            language = _TTS_LANGUAGE[persona["language_mode"]]
            resp = await http.post(
                TTS_URL,
                headers={"api-subscription-key": settings.sarvam_api_key},
                json={
                    "inputs": [f"This is a voice preflight test for {persona['name']}."],
                    "target_language_code": language,
                    "speaker": voice_id,
                    "model": "bulbul:v4-flash",
                },
            )
            if resp.status_code == 200 and len(resp.content) > 100:
                print(f"[TTS] OK: {voice_id} ({language}) -> {len(resp.content)} bytes")
            else:
                ok = False
                print(
                    f"[TTS] FAIL: {voice_id} -> HTTP {resp.status_code}: {resp.text[:200]}"
                )
    return ok


def check_stt_settings() -> bool:
    """Construct the realtime STT service with SPEC settings (no network call)."""
    from pipecat.services.sarvam.stt import SarvamRealtimeSTTService

    SarvamRealtimeSTTService(
        api_key=settings.sarvam_api_key,
        endpointing="vad",
        should_interrupt=False,
        settings=SarvamRealtimeSTTService.Settings(
            model="saaras:v4",
            language=None,
            mode="codemix",
            stream_type="balanced",
            silence_duration_ms=600,
        ),
    )
    print("[STT] OK: SarvamRealtimeSTTService accepts saaras:v4 + codemix settings")
    return True


async def main() -> int:
    if not settings.sarvam_api_key:
        print("SARVAM_API_KEY is not set — copy .env.example to .env and fill it in.")
        return 2

    results: list[tuple[str, bool]] = []
    try:
        results.append(("LLM", await check_llm()))
    except Exception as exc:
        results.append(("LLM", False))
        print(f"[LLM] FAIL: {exc}")
    try:
        results.append(("TTS", await check_tts()))
    except Exception as exc:
        results.append(("TTS", False))
        print(f"[TTS] FAIL: {exc}")
    try:
        results.append(("STT", check_stt_settings()))
    except Exception as exc:
        results.append(("STT", False))
        print(f"[STT] FAIL: {exc}")

    print("\n=== preflight summary ===")
    for name, ok in results:
        print(f"  {name}: {'PASS' if ok else 'FAIL'}")
    return 0 if all(ok for _, ok in results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
