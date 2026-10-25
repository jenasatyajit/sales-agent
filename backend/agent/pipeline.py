"""Pipecat pipeline assembly & Sarvam service wiring (SPEC §5.1).

One persona agent per WebRTC connection:
  browser ──SmallWebRTC── transport.input() ── saaras:v4 STT ── user aggregator
  ── sarvam-105b (tools) ── bulbul:v4-flash TTS ── transport.output()
  ── assistant aggregator ── TranscriptObserver
  RTVIObserver (task observer) turns BUYER_STATE_UPDATE frames into client messages.
"""

from loguru import logger
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi import RTVIObserver
from pipecat.services.sarvam.llm import SarvamLLMService
from pipecat.services.sarvam.stt import SarvamRealtimeSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.turns.user_start import MinWordsUserTurnStartStrategy
from pipecat.turns.user_stop import ExternalUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from agent.evaluator import finalize_and_evaluate
from agent.prompts import build_greeting_instruction, build_persona_system_prompt
from agent.state_tracker import BUYER_STATE_TOOL_SCHEMA, StateTracker
from agent.transcript_observer import TranscriptObserver
from config import settings
from database.models import Persona

# In-memory registry so POST /api/sessions/{id}/end can stop the live pipeline (D6).
# Lost on restart — acceptable: a restart also drops the WebRTC connection, and the
# disconnect path finalizes the session row anyway.
_ACTIVE_RUNNERS: dict[str, PipelineRunner] = {}


async def cancel_active_session(session_id: str) -> bool:
    """Stop the live pipeline for a session. Returns False if none is running."""
    runner = _ACTIVE_RUNNERS.pop(session_id, None)
    if runner is None:
        return False
    logger.info("cancelling live pipeline for session {}", session_id)
    await runner.cancel()
    return True


def _stt_settings_for(language_mode: str) -> tuple[str | None, str]:
    """Map persona language mode onto Sarvam realtime STT (language, mode)."""
    if language_mode == "codemix":
        return None, "codemix"  # None language -> per-utterance auto-detect
    return language_mode, "transcribe"


async def run_persona_agent(
    connection: SmallWebRTCConnection,
    session_id: str,
    persona: Persona,
    product_context: str,
) -> None:
    """Build and run the full voice pipeline for one call. Runs as a background task."""
    api_key = settings.sarvam_api_key
    tracker = StateTracker(session_id, persona.initial_trust_score)

    # 1. SmallWebRTC transport (one per call; connection created by POST /api/offer)
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )

    # 2. Sarvam Realtime STT — server-side VAD endpointing; no `vad_signals` here
    #    (that field only exists on the non-realtime SarvamSTTService).
    stt_language, stt_mode = _stt_settings_for(persona.language_mode)
    stt = SarvamRealtimeSTTService(
        api_key=api_key,
        endpointing="vad",
        should_interrupt=False,  # MinWordsUserTurnStartStrategy gates interruptions
        settings=SarvamRealtimeSTTService.Settings(
            model="saaras:v4",
            language=stt_language,
            mode=stt_mode,
            stream_type="balanced",
            silence_duration_ms=600,
        ),
    )

    # 3. Sarvam LLM — low reasoning effort keeps live-turn latency low
    llm = SarvamLLMService(
        api_key=api_key,
        settings=SarvamLLMService.Settings(
            model="sarvam-105b",
            temperature=0.6,
            max_tokens=600,
            reasoning_effort="low",
        ),
    )

    # 4. Sarvam TTS — v4-flash voice IDs only (see database/seed.py)
    tts_language = "hi-IN" if persona.language_mode in ("hi-IN", "codemix") else "en-IN"
    tts = SarvamTTSService(
        api_key=api_key,
        settings=SarvamTTSService.Settings(
            model="bulbul:v4-flash",
            language=tts_language,
            voice=persona.sarvam_voice_id,
            pace=1.05,
            min_buffer_size=10,
        ),
    )

    # 5. Context, tool registration & turn strategies
    context = LLMContext(
        messages=[
            {"role": "system", "content": build_persona_system_prompt(persona, product_context)}
        ],
        tools=[BUYER_STATE_TOOL_SCHEMA],
    )
    llm.register_function("update_buyer_state", tracker.handle_update)

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            user_turn_strategies=UserTurnStrategies(
                # "haan"/"achha"/"okay" backchannels must not start a turn; 3+ words barge in.
                start=[MinWordsUserTurnStartStrategy(min_words=3, use_interim=True)],
                stop=[ExternalUserTurnStopStrategy()],
            ),
        ),
    )

    transcript_observer = TranscriptObserver(context, tracker, session_id)

    # 6. Assemble pipeline
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
            transcript_observer,
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
        ),
        observers=[RTVIObserver(transport)],
    )
    tracker.bind_task(task)

    @transport.event_handler("on_client_connected")
    async def _on_client_connected(transport, client):
        logger.info("client connected for session {} ({})", session_id, persona.name)
        context.add_message(
            {"role": "developer", "content": build_greeting_instruction(persona)}
        )
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def _on_client_disconnected(transport, client):
        logger.info("client disconnected from session {}", session_id)

    runner = PipelineRunner()
    _ACTIVE_RUNNERS[session_id] = runner
    try:
        await runner.run(task)
    finally:
        _ACTIVE_RUNNERS.pop(session_id, None)
        try:
            await finalize_and_evaluate(session_id, tracker.trust_score)
        except Exception:
            logger.exception("finalization failed for session {}", session_id)
