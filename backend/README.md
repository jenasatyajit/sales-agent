# Pitch Simulator — Backend

Pipecat + Sarvam voice agent behind the B2B SaaS Customer Persona Pitch Simulator.
Plan & decisions: [../BACKEND.md](../BACKEND.md). Contract: [../SPEC.md](../SPEC.md).

## Why a Linux VM

`SmallWebRTCTransport` depends on **aiortc, which publishes no native Windows wheels**.
The backend therefore runs inside your Linux VM; the Windows browser and Next.js dev
server talk to it over the network (mic capture is browser-side, so no audio devices
are needed inside the VM).

## Setup (inside the VM)

```bash
cd backend
uv sync                      # installs aiortc from Linux wheels
cp .env.example .env         # then set SARVAM_API_KEY
uv run python scripts/preflight.py   # gate: LLM + TTS voice IDs + STT settings must PASS
```

`ALLOWED_ORIGIN` must match the Next.js origin. If the frontend runs on the Windows
host and reaches the VM via `localhost` (WSL2 forwards by default), the default
`http://localhost:3000` works; if you browse via the VM's IP, change it.

## Run

```bash
uv run uvicorn main:app --host 0.0.0.0 --port 8000
# or: uv run python main.py
```

- `GET /health` from the Windows browser is the reachability check.
- Interactive API docs: `http://<vm-host>:8000/docs`.

## Tests

```bash
uv run pytest
```

## Voice smoke checklist (Phase 2 gate)

1. Create a session via `POST /api/sessions`, point the frontend (or a minimal offer
   client) at `POST /api/offer?session_id=<id>`.
2. Persona opens the call in the right language/voice.
3. Backchannels ("haan", "achha", "okay") do **not** interrupt the persona; a 3+ word
   utterance does.
4. `BUYER_STATE_UPDATE` arrives via the client's `onServerMessage` when the pitch shifts.
5. After hangup: `GET /api/sessions/{id}` shows transcript turns, trust snapshots and
   `evaluation_status: ready`.

## Troubleshooting

- **WebRTC connects but no audio / ICE fails** (WSL2 NAT): enable WSL2 *mirrored*
  networking, or set `PIPECAT_ICE_SERVERS=stun:stun.l.google.com:19302`, or expose the
  VM on the LAN and target its IP from the browser.
- **DB write errors on the Windows mount**: move the repo (or at least run with
  `DATABASE_URL` pointing to a VM-native path, e.g. `~/pitch_simulator.db`).
- **TTS 4xx in preflight**: the voice ID must be a `bulbul:v4-flash` catalogue entry —
  v3 names like `anushka` are rejected.
