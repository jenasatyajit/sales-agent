# B2B SaaS Customer Persona Pitch Simulator — Technical Specification (`SPEC.md`)

## 1. System Overview & Objective
An interactive, real-time voice roleplay and pitch-coaching application designed for B2B SaaS founders and sales teams. The system simulates skeptical Ideal Customer Profile (ICP) buyer personas across English (`en-IN`), Hindi (`hi-IN`), and Hinglish (code-mixed), allowing the user to practice discovery calls, workflow audits, and platform-switching pitches.

### Core Capabilities
1. **Multi-Persona Management:** Create, configure, and select distinct B2B buyer personas (role, company size, legacy "status quo" tool stack, hidden workflow bottlenecks, and switching fears).
2. **Real-Time Voice Simulation:** Low-latency bidirectional voice conversation powered by **Pipecat** over **SmallWebRTC** (FastAPI-hosted) and **Sarvam AI** (`saaras:v4` Realtime STT, `sarvam-105b` LLM, and `bulbul:v4-flash` TTS).
3. **Dynamic Buyer Psychology (Tool-Driven State):** The persona maintains internal state variables (`trust_score`, `skepticism_level`, `current_disposition`, `objections_resolved`) updated dynamically mid-call via LLM function calling.
4. **Session Persistence & Post-Call Analytics:** Every call transcript, state transition log, and post-call AI critique scorecard is saved to a local SQLite database for historical tracking and pitch improvement analysis.

---

## 2. Tech Stack & Dependencies

### Backend (`/backend`)
* **Runtime:** Python 3.11+ (`uv` package manager recommended)
* **Voice Agent Framework:** `pipecat-ai[webrtc,sarvam]>=1.14.0` (the `webrtc` extra pulls in `aiortc` for SmallWebRTC)
* **API Server:** `fastapi`, `uvicorn[standard]`
* **AI Services (All via Single `SARVAM_API_KEY`):**
  * **STT:** `SarvamRealtimeSTTService` (`model="saaras:v4"`, server-side VAD + `codemix` support for English/Hindi/Hinglish)
  * **LLM (Conversation & Post-Call Evaluator):** `SarvamLLMService` (`model="sarvam-105b"`)
  * **TTS:** `SarvamTTSService` (`model="bulbul:v4-flash"`, sample rate `24000` Hz)
* **Database & ORM:** SQLite (`sqlite+aiosqlite:///./pitch_simulator.db`) + `SQLAlchemy>=2.0` + `pydantic>=2.0`

### Frontend (`/frontend`)
* **Framework:** Next.js 16 (App Router, TypeScript, Tailwind CSS)
* **Client Audio & Transport:** `@pipecat-ai/client-js`, `@pipecat-ai/client-react`, `@pipecat-ai/small-webrtc-transport`
* **UI Components:** Lucide React icons, Recharts (for post-call analytics & trust trend visualization)

---

## 3. Repository File Structure

```text
b2b-pitch-simulator/
├── .env.example
├── README.md
├── SPEC.md
├── backend/
│   ├── pyproject.toml
│   ├── main.py                      # FastAPI entry point, REST routes + SmallWebRTC /api/offer endpoint
│   ├── config.py                    # Env variables & global settings
│   ├── database/
│   │   ├── db.py                    # Async SQLAlchemy engine & session maker
│   │   ├── models.py                # ORM models: Persona, CallSession, TranscriptTurn, CallEvaluation
│   │   └── seed.py                  # Default B2B SaaS buyer personas seed script
│   ├── schemas/
│   │   └── api_schemas.py           # Pydantic request/response schemas
│   └── agent/
│       ├── pipeline.py              # Pipecat pipeline assembly & Sarvam service wiring
│       ├── prompts.py               # Dynamic system prompt builder for personas & evaluator
│       ├── state_tracker.py         # BuyerState class & LLM tool handler (update_buyer_state)
│       ├── transcript_observer.py   # FrameProcessor/Observer to record turns to SQLite
│       └── evaluator.py             # Post-call LLM analysis service (runs after hangup)
└── frontend/
    ├── package.json
    ├── next.config.ts
    └── src/
        ├── app/
        │   ├── api/offer/route.ts         # SDP offer proxy → FastAPI backend
        │   ├── layout.tsx
        │   ├── page.tsx                     # Persona selector & analytics overview
        │   ├── personas/new/page.tsx        # Create/edit custom ICP persona
        │   ├── call/[sessionId]/page.tsx    # Live voice call room + real-time trust HUD
        │   └── sessions/[sessionId]/page.tsx# Post-call scorecard, transcript & critique
        ├── components/
        │   ├── PersonaCard.tsx
        │   ├── VoiceCallHUD.tsx             # Mic controls, audio visualizer, live mood badge
        │   └── ScorecardView.tsx            # Radar/bar charts & turn-by-turn feedback
        └── lib/
            └── api.ts                       # REST client for FastAPI backend
```

---

## 4. Database Schema (`backend/database/models.py`)

Coding agents must implement the following four SQLAlchemy async models:

### 4.1 `personas` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `String (UUID)` | Primary Key |
| `name` | `String` | e.g., `"Vikram Mehta"` |
| `role_title` | `String` | e.g., `"VP of Operations"` |
| `company_profile` | `String` | e.g., `"250-person Series B Logistics SaaS in Bengaluru"` |
| `language_mode` | `String` | `"en-IN"` (English), `"hi-IN"` (Hindi), or `"codemix"` (Hinglish) |
| `sarvam_voice_id` | `String` | `bulbul:v4-flash` speaker ID in v4 format `<name>_<lang>_<style>` (e.g., `aayan_hi_conversational`). v3-era names (`anushka`, `abhilash`, …) are rejected by the API; use an `enhi` code-mixed voice (e.g., `ishita_enhi_customer`) for Hinglish personas. |
| `status_quo_stack` | `JSON (List[str])` | Tools they currently use (e.g., `["Excel", "Jira", "WhatsApp Groups"]`) |
| `hidden_pain_points` | `JSON (List[str])` | Workflow bottlenecks they only reveal if asked good discovery questions |
| `switching_objections` | `JSON (List[str])` | e.g., `["Migration downtime", "Team retraining fatigue", "Security compliance"]` |
| `call_scenario` | `String` | `"cold_call"`, `"warm_discovery"`, or `"demo_objection"` |
| `initial_trust_score` | `Integer` | Default `25` (Range `0` to `100`) |
| `created_at` | `DateTime` | Timestamp |

### 4.2 `call_sessions` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `String (UUID)` | Primary Key |
| `persona_id` | `String (FK)` | Reference to `personas.id` |
| `product_context` | `Text` | Description of the user's B2B SaaS platform being pitched |
| `started_at` | `DateTime` | Call start timestamp |
| `ended_at` | `DateTime` | Nullable, populated on disconnect |
| `final_trust_score` | `Integer` | Final buyer trust (`0` to `100`) |
| `outcome` | `String` | `"converted"`, `"follow_up_booked"`, `"stalled"`, or `"rejected"` |
| `state_history` | `JSON` | Array of state changes triggered by LLM tool calls during the call |

### 4.3 `transcript_turns` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `Integer` | Primary Key (Auto-increment) |
| `session_id` | `String (FK)` | Reference to `call_sessions.id` |
| `speaker` | `String` | `"user"` (Founder) or `"assistant"` (Buyer Persona) |
| `text` | `Text` | Utterance text |
| `timestamp` | `DateTime` | Turn timestamp |
| `buyer_trust_snapshot`| `Integer` | Buyer's trust score at the moment of this turn |

### 4.4 `call_evaluations` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `String (UUID)` | Primary Key |
| `session_id` | `String (FK)` | Unique reference to `call_sessions.id` |
| `overall_score` | `Integer` | `0` to `100` |
| `discovery_depth_score`| `Integer` | `0` to `100` (Did the user ask about workflow before pitching?) |
| `objection_handling_score`| `Integer` | `0` to `100` (How well switching fears were addressed) |
| `value_clarity_score` | `Integer` | `0` to `100` (Clarity of ROI vs status quo) |
| `feature_dumping_detected`| `Boolean` | `True` if the user pitched features without linking to pain |
| `missed_cues` | `JSON (List[str])` | Moments where the buyer hinted at a bottleneck and user ignored it |
| `actionable_feedback` | `Text` | Detailed Markdown coaching critique |

---

## 5. Pipecat + Sarvam Voice Pipeline Specification (`backend/agent/pipeline.py`)

> **CRITICAL IMPLEMENTATION RULES FOR CODING AGENTS (Pipecat v1.14+ & Sarvam SDK):**
> 1. **Use `.Settings(...)` objects:** Do NOT pass model configuration parameters as top-level kwargs to `SarvamRealtimeSTTService`, `SarvamLLMService`, or `SarvamTTSService`—kwargs not in the constructor are silently ignored. Pass them inside `settings=Service.Settings(...)`.
> 2. **Prevent Backchannel False Interruptions ("Haan", "Achha", "Okay"):** When using `SarvamRealtimeSTTService`, pass `should_interrupt=False` to the constructor and configure `LLMUserAggregatorParams` with `MinWordsUserTurnStartStrategy(min_words=3, use_interim=True)` so brief acknowledgments do not cut off the buyer mid-sentence, while a 3+ word interruption barges in naturally.
> 3. **Avoid Double Buffering in TTS:** Set a small `min_buffer_size` (e.g., `10`) inside `SarvamTTSService.Settings` because Pipecat already aggregates sentences before sending them to TTS.
> 4. **Never pass `vad_signals` to `SarvamRealtimeSTTService`:** that field exists only on the non-realtime `SarvamSTTService.Settings`. The realtime service performs server-side VAD endpointing via the `endpointing="vad"` constructor param (default).
> 5. **Deliver HUD updates via RTVI:** queue `RTVIServerMessageFrame`s and attach `RTVIObserver(transport)` to `PipelineTask(observers=[...])`; the browser client receives them through its `onServerMessage` callback.

### 5.1 Service Instantiation Blueprint

```python
import os
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi import RTVIObserver
from pipecat.turns.user_start import MinWordsUserTurnStartStrategy
from pipecat.turns.user_stop import ExternalUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.services.sarvam.stt import SarvamRealtimeSTTService
from pipecat.services.sarvam.llm import SarvamLLMService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

async def run_persona_agent(
    connection: SmallWebRTCConnection, session_id: str, persona, product_context: str
):
    api_key = os.environ["SARVAM_API_KEY"]

    # 1. SmallWebRTC Transport (one per call; `connection` is created by POST /api/offer)
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )

    # 2. Sarvam Realtime STT (saaras:v4 with server-side endpointing)
    # Language mapping: "en-IN", "hi-IN", or None with mode="codemix" for Hinglish
    stt_language = None if persona.language_mode == "codemix" else persona.language_mode
    stt_mode = "codemix" if persona.language_mode == "codemix" else "transcribe"

    stt = SarvamRealtimeSTTService(
        api_key=api_key,
        endpointing="vad",  # Server-side VAD proposes turn boundaries (no vad_signals field here)
        should_interrupt=False,  # Let MinWordsUserTurnStartStrategy gate interruptions
        settings=SarvamRealtimeSTTService.Settings(
            model="saaras:v4",
            language=stt_language,
            mode=stt_mode,
            stream_type="balanced",
            silence_duration_ms=600,
        ),
    )

    # 3. Sarvam LLM (sarvam-105b with tool calling enabled)
    llm = SarvamLLMService(
        api_key=api_key,
        settings=SarvamLLMService.Settings(
            model="sarvam-105b",
            temperature=0.6,
            max_tokens=600,
            reasoning_effort="low",  # Keep voice latency low during live turns
        ),
    )

    # 4. Sarvam TTS (bulbul:v4-flash for low-latency Indic/English speech)
    # persona.sarvam_voice_id MUST be a v4 catalogue ID, e.g. "simran_en_conversation"
    # (English), "aayan_hi_conversational" (Hindi) or "ishita_enhi_customer" (Hinglish).
    tts_lang = "hi-IN" if persona.language_mode in ("hi-IN", "codemix") else "en-IN"
    tts = SarvamTTSService(
        api_key=api_key,
        settings=SarvamTTSService.Settings(
            model="bulbul:v4-flash",
            language=tts_lang,
            voice=persona.sarvam_voice_id,
            pace=1.05,
            min_buffer_size=10,
        ),
    )

    # 5. Context, Tools & Turn Strategies
    # (Register update_buyer_state tool on `llm` and build system prompt)
    context = LLMContext(messages=messages, tools=tools)

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            user_turn_strategies=UserTurnStrategies(
                start=[MinWordsUserTurnStartStrategy(min_words=3, use_interim=True)],
                stop=[ExternalUserTurnStopStrategy()],
            ),
        ),
    )

    # 6. Assemble Pipeline
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
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
        observers=[RTVIObserver(transport)],  # Delivers BUYER_STATE_UPDATE RTVI server messages
    )
```

#### Offer Endpoint Wiring (`backend/main.py`)

Use pipecat's `SmallWebRTCRequestHandler` — it owns connection creation, SDP answer generation, `pc_id`-keyed connection caching for browser reconnects, and trickle-ICE via `PATCH`. The `session_id` rides along as a query param (body stays the standard `SmallWebRTCRequest`):

```python
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

small_webrtc_handler = SmallWebRTCRequestHandler()

@app.post("/api/offer")
async def offer(request: SmallWebRTCRequest, session_id: str, background_tasks: BackgroundTasks):
    async def on_connection(connection):
        persona, product_context = await load_session_context(session_id)
        background_tasks.add_task(
            run_persona_agent, connection, session_id, persona, product_context
        )

    answer = await small_webrtc_handler.handle_web_request(
        request=request,
        webrtc_connection_callback=on_connection,
    )
    return answer  # SDP answer (with pc_id) returned to the browser

@app.patch("/api/offer")
async def ice_candidate(request: SmallWebRTCPatchRequest):
    await small_webrtc_handler.handle_patch_request(request)
    return {"status": "success"}
```

Shutdown must call `await small_webrtc_handler.close()` (FastAPI lifespan). The Next.js `/api/offer` route handler proxies both `POST` and `PATCH`, appending `?session_id=` to the POST.

---

## 6. Dynamic Buyer State & Prompt Architecture (`backend/agent/prompts.py` & `state_tracker.py`)

### 6.1 Tool Definition: `update_buyer_state`
Register a function tool on `SarvamLLMService` that the persona calls whenever the user's pitch shifts its perception:

```json
{
  "type": "function",
  "function": {
    "name": "update_buyer_state",
    "description": "Update your internal buyer psychology when the salesperson asks a great discovery question, triggers an objection, or feature-dumps.",
    "parameters": {
      "type": "object",
      "properties": {
        "trust_delta": {
          "type": "integer",
          "description": "Change in trust between -20 and +20. Negative for generic pitches or ignoring questions; positive for uncovering workflow pain or resolving migration fears."
        },
        "current_disposition": {
          "type": "string",
          "enum": ["guarded", "curious", "skeptical_about_switching", "convinced", "annoyed_ready_to_hang_up"]
        },
        "active_objection": {
          "type": "string",
          "description": "The specific objection currently on your mind, or 'none'."
        },
        "internal_monologue": {
          "type": "string",
          "description": "1-sentence private thought explaining why your trust shifted."
        }
      },
      "required": ["trust_delta", "current_disposition", "internal_monologue"]
    }
  }
}
```
* **Side Effect:** Whenever `update_buyer_state` executes on the backend, it:
  1. Updates the session's `trust_score` (clamped between `0` and `100`).
  2. Appends the event to `call_sessions.state_history`.
  3. Queues an `RTVIServerMessageFrame` (`type: "BUYER_STATE_UPDATE"`) which `RTVIObserver` delivers over the WebRTC data channel; the Next.js client receives it through its `onServerMessage` callback so the live HUD updates the Trust Meter and Internal Monologue badge in real time.

### 6.2 Buyer Persona System Prompt Template
```text
You are {persona.name}, {persona.role_title} at {persona.company_profile}.
You are in a live voice call with a salesperson pitching: {product_context}.

YOUR LANGUAGE & SPEAKING STYLE:
- Mode: {persona.language_mode} (If 'codemix', speak natural Indian corporate Hinglish—mixing English business/tech terms with Hindi conversational flow like "Dekhiye, humara current workflow already set hai, migration ka bandwidth nahi hai abhi").
- Keep every response concise (1 to 3 spoken sentences max). Never use markdown, bullet points, or emojis in spoken output.
- Sound like a busy, pragmatic B2B decision-maker, NOT a helpful AI assistant.

YOUR CURRENT WORKFLOW (STATUS QUO):
- Tools you currently use: {persona.status_quo_stack}
- Why you think it's "good enough": Your team is used to it, and changing tools disrupts quarterly targets.
- Your hidden bottlenecks (ONLY reveal these if the user asks sharp, specific questions about how your team works day-to-day): {persona.hidden_pain_points}

YOUR SWITCHING FEARS & OBJECTIONS:
- {persona.switching_objections}

BEHAVIORAL RULES:
1. Start with trust={persona.initial_trust_score}/100 and disposition='guarded'.
2. If the user pitches features before asking how your current workflow operates, push back ("Wait, you don't even know how our team handles this today. Why would we rip out {persona.status_quo_stack[0]}?").
3. Call `update_buyer_state` whenever the user makes a strong point, asks a perceptive workflow question, or annoys you with buzzwords.
4. Only agree to a pilot/migration if your trust score reaches >= 75 AND they have directly addressed at least one of your switching objections.
```

---

## 7. Post-Call Evaluator Specification (`backend/agent/evaluator.py`)

When the WebRTC connection disconnects or the user clicks **End Call**, trigger an asynchronous background task that queries `SarvamLLMService` (`model="sarvam-105b"`, `reasoning_effort="high"`, `temperature=0.2`) with the full `transcript_turns` and `state_history`. Running outside a live pipeline, it can call Sarvam's OpenAI-compatible chat-completions API directly with the same `SARVAM_API_KEY`.

* **Evaluator Prompt Objective:** Grade the founder's pitch against the persona's `hidden_pain_points` and `switching_objections`.
* **Required Output Format:** Strict JSON matching the `call_evaluations` table schema (`overall_score`, `discovery_depth_score`, `objection_handling_score`, `value_clarity_score`, `feature_dumping_detected`, `missed_cues`, `actionable_feedback`).

---

## 8. REST & SmallWebRTC API Contract (`backend/main.py`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/personas` | List all saved ICP buyer personas. |
| `POST` | `/api/personas` | Create a new ICP buyer persona. |
| `POST` | `/api/sessions` | Create a new call session (`persona_id`, `product_context`) and return `session_id`. |
| `POST` | `/api/offer` | SmallWebRTC SDP offer/answer exchange (`session_id` + SDP in body). Spawns the Pipecat persona agent for that session and returns the SDP answer. |
| `POST` | `/api/sessions/{session_id}/end` | Finalize session, trigger post-call evaluation via `sarvam-105b`, and return evaluation status. |
| `GET` | `/api/sessions` | List historical call sessions with summary scores for trend analysis. |
| `GET` | `/api/sessions/{session_id}` | Fetch full session details: persona, transcript turns, trust timeline, and evaluation scorecard. |

---

## 9. Next.js Frontend Specification (`/frontend`)

1. **Dashboard (`/`)**:
   * Displays a **"Product Pitch Context"** text area (saved in local state/DB) describing the user's B2B SaaS platform.
   * Grid of **ICP Persona Cards** (with language badges: `EN-IN`, `HI-IN`, `Hinglish`) and a **"Start Call"** button.
   * **Analytics Summary Table:** Shows recent practice calls, final trust score achieved, and conversion rate over time.
2. **Persona Builder (`/personas/new`)**:
   * Form to create a new persona with tags for Status Quo Stack, Hidden Workflow Pain Points, Switching Objections, Language Mode, and Call Scenario.
3. **Live Call Studio (`/call/[sessionId]`)**:
   * Connects using `PipecatClient` + `SmallWebRTCTransport` (`@pipecat-ai/client-js`, `@pipecat-ai/small-webrtc-transport`) via the Next.js route handler `/api/offer`, which proxies the SDP exchange to the FastAPI backend.
   * Receives `BUYER_STATE_UPDATE` RTVI server messages through the client's `onServerMessage` callback to drive the live HUD.
   * **Live Buyer Psyche HUD:** Displays real-time Trust Meter (`0-100%`), current mood badge (`Guarded`, `Curious`, `Skeptical`), and the buyer's latest `internal_monologue` (can be toggled on/off for "Hard Mode").
   * Live scrolling transcript panel.
4. **Post-Call Analysis View (`/sessions/[sessionId]`)**:
   * Score breakdown cards (`Discovery Depth`, `Objection Handling`, `Value Clarity`).
   * **Trust Trajectory Chart:** Line chart plotting `buyer_trust_snapshot` across conversation turns so the user can see the exact sentence that won or lost the buyer.
   * **Missed Cues & Coaching Critique:** Renders the evaluator's findings and annotated transcript.

---

## 10. Step-by-Step Implementation Plan for Coding Agents

1. **Step 1 (Backend Foundation & DB):** Initialize `/backend` with `pyproject.toml`, configure SQLite + async SQLAlchemy models (`models.py`), and write `seed.py` with 3 realistic B2B personas (1 English VP of Engineering, 1 Hinglish Head of Operations, 1 Hindi SMB/Enterprise Director), each with a valid `bulbul:v4-flash` voice ID (`simran_en_conversation`, `ishita_enhi_customer`, `aayan_hi_conversational` respectively).
2. **Step 2 (Pipecat + Sarvam Voice Agent):** Implement `state_tracker.py`, `prompts.py`, and `pipeline.py` using `SarvamRealtimeSTTService`, `SarvamLLMService`, and `SarvamTTSService`. Verify that `SARVAM_API_KEY` authenticates all three services. Then run an end-to-end SmallWebRTC smoke test: confirm `BUYER_STATE_UPDATE` reaches the browser via `onServerMessage`, and brief backchannels ("haan", "achha", "okay") do not trigger false interruptions.
3. **Step 3 (Transcript Recording & Post-Call Evaluator):** Attach transcript logging to the Pipecat context aggregator events and build `evaluator.py` to generate structured JSON scorecards upon call termination.
4. **Step 4 (Frontend Call & Analytics UI):** Scaffold `/frontend` Next.js 16 app, wire up the Pipecat SmallWebRTC client (via the `/api/offer` route handler) in `/call/[sessionId]`, and build the post-call analytics dashboard in `/sessions/[sessionId]`.