# BACKEND.md — Backend Development Plan

> Working plan for building `/backend` of the B2B SaaS Customer Persona Pitch Simulator.
> Authoritative reference: [SPEC.md](./SPEC.md) (updated for SmallWebRTC + pipecat 1.14 + Sarvam v4 APIs). This file adds execution context, decisions, and acceptance criteria.

---

## 1. Context & Background

### 1.1 What the backend does
A single FastAPI process serves three concerns:

1. **REST API** — persona CRUD, session lifecycle, historical analytics for the Next.js frontend.
2. **Live voice pipeline host** — per call session, spins up a [Pipecat](https://docs.pipecat.ai) pipeline that wires the browser's microphone/speakers (via SmallWebRTC) to an all-Sarvam AI stack:
   * STT: `SarvamRealtimeSTTService` (`saaras:v4`, server-side VAD endpointing, codemix support)
   * LLM: `SarvamLLMService` (`sarvam-105b`, function calling for the `update_buyer_state` buyer-psychology tool)
   * TTS: `SarvamTTSService` (`bulbul:v4-flash`, 24 kHz, v4-catalogue voice IDs)
3. **Persistence & evaluation** — every turn, buyer-state transition, and post-call LLM critique lands in SQLite (`aiosqlite`); evaluation runs as a background task after hangup.

### 1.2 Runtime environment (important constraint)
Development machine is Windows 11, but **aiortc — the WebRTC stack behind `SmallWebRTCTransport` — publishes no native Windows wheels** (Linux/macOS only; source builds on Windows require MSVC + libav and are fragile). **Decision: the backend runs in a Linux VM** (user's choice). Consequences:

* The repo lives on the Windows side (`S:\1-Project\zemon\SALES`); the VM accesses it via its mount (e.g. `/mnt/s/...` under WSL2 or a shared folder). If dev-server reload/file-watching proves flaky across the mount, clone the repo into the VM's native filesystem instead.
* The VM must forward the backend port (default `8000`) so the Windows-side browser and Next.js dev server can reach it (`http://<vm-host>:8000` or `localhost` with WSL2 localhost-forwarding).
* Mic/speaker capture happens **browser-side on Windows** — the backend only sees RTP over the network, so no audio-device passthrough into the VM is needed.
* SQLite DB file (`pitch_simulator.db`) is created wherever the backend runs — keep it inside the VM-visible path and treat it as disposable local state.

### 1.3 Framework facts that shape the code (verified against pipecat 1.14 docs/examples)
* **Settings pattern:** every Sarvam service takes model config only via `settings=Service.Settings(...)`; stray top-level kwargs are silently ignored (deprecated ones are removed in pipecat 2.0).
* **STT specifics:** `vad_signals` does **not** exist on `SarvamRealtimeSTTService.Settings` (it belongs to the non-realtime `SarvamSTTService`). The realtime service exposes server-side VAD via constructor param `endpointing="vad"` (default). `should_interrupt=False` defers interruption gating to the user-aggregator turn strategies.
* **Turn management:** `LLMContextAggregatorPair` + `LLMUserAggregatorParams(user_turn_strategies=UserTurnStrategies(start=[MinWordsUserTurnStartStrategy(min_words=3, use_interim=True)], stop=[ExternalUserTurnStopStrategy()]))` — brief Hindi/English backchannels ("haan", "achha", "okay") must not cut off the persona; 3+ word utterances barge in naturally.
* **Signaling:** pipecat ships `SmallWebRTCRequestHandler` (`pipecat.transports.smallwebrtc.request_handler`) which owns SDP answer generation, `pc_id`-keyed connection caching for browser reconnects, and trickle ICE via `PATCH /api/offer`. Do not hand-roll connection management.
* **Server→client events:** HUD updates ride `RTVIServerMessageFrame`s delivered by `RTVIObserver(transport)` attached to `PipelineTask(observers=[...])`; the browser receives them via the Pipecat JS client's `onServerMessage` callback.
* **Voice IDs:** `bulbul:v4-flash` uses its own catalogue (`<name>_<lang>_<style>`, e.g. `aayan_hi_conversational`); v3 names (`anushka`…) are rejected. `enhi` voices exist for code-mixed Hinglish.
* **Official reference examples:** `pipecat/examples/voice/voice-sarvam-realtime.py` (Sarvam services + aggregator pair) and `pipecat-examples/p2p-webrtc/voice-agent/{server.py,bot.py}` (offer endpoint + transport wiring).

---

## 2. Decisions Made

| # | Decision | Rationale / Alternatives |
|---|---|---|
| D1 | **Transport = SmallWebRTC** (browser ↔ backend) | Spec originally said raw WebSocket; pipecat docs recommend WebRTC for browser clients (jitter/latency resilience). Costs: SDP offer/answer endpoint + `pc_id` handling, both solved by `SmallWebRTCRequestHandler`. |
| D2 | **pipecat `>=1.14.0`** with extras `[webrtc,sarvam]` | Latest stable (1.14.0, Oct 2026). `silero` extra dropped — Sarvam realtime STT does server-side VAD, so no local VAD analyzer is needed. `websocket` extra dropped with the transport switch. |
| D3 | **All AI via one `SARVAM_API_KEY`** — `saaras:v4` / `sarvam-105b` / `bulbul:v4-flash` | Verified valid on all three pipecat services. Sarvam-M is deprecated; `sarvam-105b` supports `reasoning_effort` and OpenAI-style tool calling (the `-conversations` variant does not support `reasoning_effort`). |
| D4 | **Backend runs in a Linux VM** | aiortc has no Windows wheels (§1.2). Alternatives rejected: Docker Desktop (heavier iteration loop), native Windows (fragile source build). |
| D5 | **Schema via `metadata.create_all()` + seed on startup; no Alembic in v1** | Single-user local SQLite tool; migrations are ceremony here. Revisit if schema churn grows. |
| D6 | **Session↔pipeline registry is an in-memory dict** (`session_id → PipelineTask/runner handle`) | Needed so `POST /api/sessions/{id}/end` can cancel the live task from a REST route. Lost on restart — acceptable: a restart also drops the WebRTC connection, and disconnect handling finalizes the session row anyway. |
| D7 | **Buyer-state HUD via RTVI server messages** (`RTVIServerMessageFrame` + `RTVIObserver`) | Idiomatic pipecat path; lands in the JS client's `onServerMessage`. No bespoke side-channel WebSocket. |
| D8 | **Post-call evaluator calls Sarvam chat-completions directly** (OpenAI-compatible), not through a live pipeline | Runs after hangup as an `asyncio` background task; same key, `reasoning_effort="high"`, strict-JSON output parsed into `call_evaluations`. |
| D9 | **No auth; CORS limited to the Next.js dev origin** | Local single-user tool. |
| D10 | **`session_id` passed as query param on `POST /api/offer`** | Keeps the request body the standard `SmallWebRTCRequest` schema the handler expects; the Next.js proxy route appends it. |
| D11 | **One persona agent per session, single concurrent call assumed** | Local practice tool. The design (registry + handler) doesn't preclude concurrency, but nothing is built for parallel calls. |

---

## 3. Phase-wise TODO

### Phase 0 — Scaffold & Environment Bootstrap
- [ ] `backend/pyproject.toml` for `uv`: deps `pipecat-ai[webrtc,sarvam]>=1.14.0`, `fastapi`, `uvicorn[standard]`, `sqlalchemy>=2.0`, `aiosqlite`, `pydantic>=2.0`, `pydantic-settings`, `python-dotenv`; dev deps `pytest`, `pytest-asyncio`, `httpx`.
- [ ] `backend/.env.example` (`SARVAM_API_KEY=`, `DATABASE_URL=sqlite+aiosqlite:///./pitch_simulator.db`, `HOST=0.0.0.0`, `PORT=8000`, `ALLOWED_ORIGIN=http://localhost:3000`).
- [ ] `config.py`: pydantic-settings `Settings` class, single instance.
- [ ] `database/db.py`: async engine + `async_sessionmaker`, `get_session()` FastAPI dependency; `init_db()` running `create_all` + seed (D5).
- [ ] `main.py` skeleton: FastAPI app with lifespan (`init_db()` on startup, `small_webrtc_handler.close()` on shutdown), CORS middleware (D9), router includes.
- [ ] Verify in the Linux VM: `uv sync` installs aiortc from Linux wheels; `uv run uvicorn main:app` boots; `GET /health` (add it) returns 200 from the Windows browser.
- [ ] Pre-flight script `scripts/preflight.py`: with the real key, (a) Sarvam chat-completions round-trip with a tool call, (b) `bulbul:v4-flash` synthesis with each seed voice ID, (c) realtime STT websocket auth. **Gate: all three pass before Phase 2.**

**Definition of Done — Phase 0:** `uv sync && uv run uvicorn main:app` works in the VM; `/health` reachable from Windows; preflight script passes with the user's key; `.env.example` documents every variable.

### Phase 1 — Data Layer & Persona/Session REST
- [ ] `database/models.py`: `Persona`, `CallSession`, `TranscriptTurn`, `CallEvaluation` exactly per SPEC §4 (UUID PKs as `String(36)`; JSON columns via `sqlalchemy JSON`; `CallEvaluation.session_id` unique).
- [ ] `schemas/api_schemas.py`: Pydantic v2 request/response models (`PersonaCreate/Out`, `SessionCreate/Out`, `SessionDetail` embedding turns + trust timeline + evaluation, `SessionSummary` for the list view).
- [ ] `database/seed.py`: 3 personas per SPEC §10 — English VP Eng (`simran_en_conversation`), Hinglish Head of Ops (`ishita_enhi_customer`), Hindi Director (`aayan_hi_conversational`) — with realistic status-quo stacks, hidden pain points, switching objections, scenarios.
- [ ] REST endpoints: `GET/POST /api/personas`, `POST /api/sessions`, `GET /api/sessions` (summaries), `GET /api/sessions/{id}` (full detail). New session row starts `started_at=now`, `outcome=NULL`.
- [ ] Tests (pytest + httpx AsyncClient against an in-memory/tmp-file SQLite): CRUD round-trips, seed idempotency, session detail shape.

**Definition of Done — Phase 1:** all §8 REST endpoints (minus offer/end) return correct payloads; seed personas present on first boot; test suite green.

### Phase 2 — Voice Pipeline (the core)
- [ ] `agent/prompts.py`: `build_persona_system_prompt(persona, product_context)` implementing SPEC §6.2 verbatim behaviors (incl. language-mode diction rules and the trust≥75 + objection-addressed consent gate); `build_evaluator_prompt(...)` for Phase 3.
- [ ] `agent/state_tracker.py`: `BuyerState` dataclass (`trust_score` clamped 0–100, `disposition`, `active_objection`, `objections_resolved` set); `update_buyer_state` tool handler that (a) mutates state, (b) appends to `state_history` on the session row, (c) queues `RTVIServerMessageFrame` `{"type": "BUYER_STATE_UPDATE", ...}` (D7); tool schema per SPEC §6.1.
- [ ] `agent/pipeline.py`: `run_persona_agent(connection, session_id, persona, product_context)` per SPEC §5.1 — SmallWebRTC transport, three Sarvam services (Settings pattern, `endpointing="vad"`, `should_interrupt=False`, `min_buffer_size=10`), aggregator pair with MinWords(3)+External stop strategies, `LLMContext(messages, tools)`, `llm.register_function("update_buyer_state", ...)`, `PipelineTask(observers=[RTVIObserver(transport)])`, `PipelineRunner`.
  - `on_client_connected`: prime context with system prompt + first-message developer nudge → `LLMRunFrame`.
  - `on_client_disconnected`: finalize session (`ended_at`, snapshot `final_trust_score`, derive `outcome`), trigger evaluation (Phase 3), remove from registry.
- [ ] `agent/transcript_observer.py`: hook the context aggregators (`user`/`assistant` aggregation events or a thin frame processor) to insert `TranscriptTurn` rows tagged with the current `buyer_trust_snapshot`.
- [ ] `main.py`: `POST /api/offer?session_id=` + `PATCH /api/offer` via `SmallWebRTCRequestHandler` (SPEC §5 wiring snippet); session registry dict (D6); guard: offer for unknown/ended session → 404/409.
- [ ] Manual smoke checklist in the VM with a browser test page or the scaffolded frontend: call connects, persona speaks, full-duplex conversation works in `en-IN`; "haan"/"achha" backchannels do NOT interrupt the persona; a 3+ word utterance DOES; `BUYER_STATE_UPDATE` arrives in `onServerMessage` when the pitch shifts.

**Definition of Done — Phase 2:** a real voice call runs end-to-end with all three Sarvam services; interruption gating behaves per D2/§5; buyer-state events reach the browser; `state_history` and `transcript_turns` fill up during the call.

### Phase 3 — Call Lifecycle & Post-Call Evaluation
- [ ] `POST /api/sessions/{id}/end`: cancel the registry task gracefully (`task.cancel()`), run the same finalize path as disconnect; respond with `{"evaluation": "pending"}`.
- [ ] `agent/evaluator.py`: background `asyncio` task calling Sarvam chat-completions (`sarvam-105b`, `reasoning_effort="high"`, `temperature=0.2`) with full transcript + `state_history` + persona pain points/objections; require strict JSON matching `call_evaluations` (retry once on parse failure; on persistent failure store NULL scores + error note rather than crash). Compute `outcome` mapping: trust ≥75 + objection resolved → `converted`; follow-up promised → `follow_up_booked`; trust <40 end → `rejected`; else `stalled`.
- [ ] `GET /api/sessions/{id}` gains `evaluation_status` (`pending|ready|failed`) so the frontend can poll.
- [ ] Session list endpoint exposes summary scores for the dashboard trend table.

**Definition of Done — Phase 3:** ending a call (button or hangup) reliably produces a `call_evaluations` row with valid scores + markdown critique; session detail returns everything SPEC §9.4 needs (score cards, trust trajectory points, missed cues).

### Phase 4 — Hardening, Docs & Verification
- [ ] Unit tests: trust clamping & delta bounds, prompt builder output for all 3 language modes, evaluator JSON parsing (incl. malformed-JSON path), outcome mapping.
- [ ] Integration test: offer endpoint 404/409 guards; end-endpoint on a session with no live task still finalizes (crash-recovery path).
- [ ] `backend/README.md`: VM setup (uv, port forwarding, `.env`), preflight, run commands, smoke checklist.
- [ ] Log hygiene: loguru request/call lifecycle lines; no `SARVAM_API_KEY` in logs.
- [ ] Full manual pass of SPEC §8 contract + Phase 2 smoke checklist on the VM.

**Definition of Done — Phase 4:** test suite green, README lets a fresh VM run the backend unattended, final smoke pass recorded.

---

## 4. Definition of Done (Backend Overall)

1. **Environment:** `uv sync && uv run uvicorn main:app` (or `uv run main.py`) starts the backend in the Linux VM; `/health` OK from the Windows browser; only `SARVAM_API_KEY` required in `.env`.
2. **REST contract:** every endpoint in SPEC §8 implemented and returning the documented shapes, including `/api/offer` (POST+PATCH) with `pc_id` reconnect support.
3. **Live call:** a browser voice call against each of the 3 seeded personas (en-IN, hi-IN, codemix) holds a natural bidirectional conversation; backchannel false-interruptions do not occur; 3+ word interruptions do.
4. **Dynamic psychology:** `update_buyer_state` fires during calls; trust stays clamped 0–100; `BUYER_STATE_UPDATE` reaches the browser in real time; `state_history` persists every transition.
5. **Persistence:** personas, sessions, per-turn transcripts with trust snapshots, and evaluations all survive a backend restart (SQLite).
6. **Evaluation:** every ended call yields a scorecard row (`overall`, `discovery_depth`, `objection_handling`, `value_clarity`, `feature_dumping_detected`, `missed_cues`, `actionable_feedback`) and a derived `outcome`.
7. **Quality:** pytest suite green; no secrets logged; README documents VM setup and the smoke checklist.

### Known risks / watch-items
* **Tool-call reliability mid-voice:** if `sarvam-105b` skips `update_buyer_state` calls in long conversations, mitigate via stronger prompt nudges (SYSTEM reminder every N turns) before considering a second lightweight judge call.
* **Latency:** keep `max_tokens≈600`, `reasoning_effort="low"` on the live LLM; `bulbul:v4-flash` is the low-latency TTS tier. Watch `enable_metrics` output during smoke tests.
* **VM mount I/O:** if uvicorn reload or SQLite writes misbehave on the Windows mount, move the working copy into the VM filesystem (D4 note).
* **`pc_id` re-offers:** ensure the finalize path tolerates a browser reconnect mid-session (session row not double-finalized; registry entry replaced not duplicated).
