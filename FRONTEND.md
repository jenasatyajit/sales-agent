# FRONTEND.md — Frontend Development Plan

> Working plan for building `/frontend` of the B2B SaaS Customer Persona Pitch Simulator.
> Authoritative reference: [SPEC.md](./SPEC.md) §9 (UI contract) and [BACKEND.md](./BACKEND.md) (API it talks to). This file adds the design system, decisions, and acceptance criteria.

---

## 1. Context & Background

### 1.1 What the frontend does
A Next.js App Router SPA (4 routes + 1 API proxy) that is the entire user-facing product:

| Route | Purpose (SPEC §9) |
|---|---|
| `/` | Dashboard: Product Pitch Context editor, ICP persona grid with **Start Call**, analytics summary table |
| `/personas/new` | Persona Builder: create ICP buyer personas (stack, hidden pains, objections, language mode, scenario) |
| `/call/[sessionId]` | Live Call Studio: SmallWebRTC voice call + real-time **Buyer Psyche HUD** (trust meter, mood badge, internal monologue, transcript) |
| `/sessions/[sessionId]` | Post-Call Analysis: score cards, trust trajectory chart, missed cues, coaching critique |
| `/api/offer` (route handler) | Proxy: browser SDP offer/ICE → FastAPI backend (keeps the backend origin server-side) |

### 1.2 Runtime environment
The frontend runs **on Windows** (no native-dependency problem — that's backend-only). The backend runs in the Linux VM, so all API calls target `NEXT_PUBLIC_API_BASE_URL` (e.g. `http://localhost:8000`); the SDP proxy uses a server-only env var `BACKEND_ORIGIN` (never `NEXT_PUBLIC_`).

### 1.3 Backend contract it must speak (already built)
* REST: `GET/POST /api/personas`, `POST /api/sessions`, `POST /api/sessions/{id}/end`, `GET /api/sessions` (summaries), `GET /api/sessions/{id}` (detail incl. `evaluation_status: live|pending|ready|failed`).
* Voice: `POST /api/offer?session_id=…` (SDP offer → answer with `pc_id`) and `PATCH /api/offer` (trickle ICE). The browser client (`@pipecat-ai/small-webrtc-transport`) speaks both.
* Live events: RTVI server messages via `useRTVIClientEvent(RTVIEvent.ServerMessage, …)`; the backend pushes payloads shaped:
  `{ type: "BUYER_STATE_UPDATE", session_id, timestamp, trust_delta, trust_score, disposition, active_objection, internal_monologue, objections_resolved }`
  with `disposition ∈ guarded | curious | skeptical_about_switching | convinced | annoyed_ready_to_hang_up`.

### 1.4 Stack facts this plan relies on (verified against current docs)
* **Next.js 16**: `create-next-app@latest` scaffolds App Router + TypeScript + Tailwind + ESLint with **Turbopack as the default bundler**; React Compiler support is built in.
* **Tailwind v4** is CSS-first: `@import "tailwindcss";` in `globals.css`, theming via `@theme inline` + CSS variables — **no `tailwind.config.ts`**.
* **shadcn CLI**: `npx shadcn@latest init` (writes `components.json` + CSS-variable theme; `-b` selects primitive base, presets capture theme/font) then `npx shadcn@latest add <component>`. Namespaced registries (`@shadcn/…`) exist for extras. The `sidebar` registry component is the shell we use.
* **Pipecat React**: provider + hooks from `@pipecat-ai/client-react` — `usePipecatClient`, `usePipecatClientTransportState`, `usePipecatClientMicControl`, `usePipecatClientAudioElement`, `usePipecatConversation` (live transcript), `useRTVIClientEvent` (incl. `RTVIEvent.ServerMessage`).
* Theme toggle: `next-themes` (class-based dark mode, which shadcn's tokens expect).

---

## 2. Decisions Made

| # | Decision | Rationale / Alternatives |
|---|---|---|
| F1 | **Next.js 16, App Router, TypeScript, Turbopack default** | User choice (latest stable); SPEC pinned 15 but nothing depends on 15-specific behavior. |
| F2 | **Tailwind v4, CSS-first config** | No `tailwind.config.ts`; tokens live in `globals.css` via `@theme inline`. |
| F3 | **shadcn/ui via CLI, default preset `base-nova` (Base UI primitives), zinc base color** | `npx shadcn@latest init -d`. Note: the current CLI default uses **Base UI** (composition via `render` prop, not Radix `asChild`). Components owned in-repo (copy-in model) so we enforce the sharp-edge look through tokens, not library fights. |
| F4 | **Dark-first theme + manual toggle** (`next-themes`, both palettes implemented) | User choice; voice-tool convention (Vapi/Retell/Linear). |
| F5 | **Fonts: Geist Sans (UI) + Geist Mono (numbers/labels)** via `next/font/google` | User choice; single-family sharp Vercel-style look, zero layout shift, `--font-sans`/`--font-mono` wired into `@theme inline`. |
| F6 | **Accent: teal (`teal-600` light / `teal-400` dark) on zinc base; semantic emerald/amber/red** | User choice. Semantically aligned: emerald = trust gains/conversions, amber = skepticism, red = annoyance/rejection. |
| F7 | **Sharp-edge visual language: `--radius: 0rem`, 1px borders, no shadows** | User's "sharp edges professional" requirement. Elevation is expressed with background steps (`zinc-950 → zinc-900 → zinc-900/60`), never drop shadows. |
| F8 | **Layout: shadcn `sidebar` (collapsible) + main content region** | User's sidebar + main window requirement; nav items: Dashboard, Persona Builder, Sessions history. |
| F9 | **`zustand` store for live-call HUD state; plain `useState`/fetch everywhere else** | RTVI events fire at high frequency mid-call; a tiny external store avoids re-render storms through the React tree. No other state library. |
| F10 | **Recharts (v3) for trust trajectory + score breakdown; lucide-react icons** | SPEC-pinned; v3 supports React 19. |
| F11 | **HUD updates via `RTVIEvent.ServerMessage`; transcript via `usePipecatConversation`** | Verified client API — no custom side-channel needed. |
| F12 | **SDP proxy in `app/api/offer/route.ts` (POST + PATCH → backend)** | Hides `BACKEND_ORIGIN` from the browser; the Pipecat client connects with `endpoint: "/api/offer?sessionId=…"`. |
| F13 | **Product Pitch Context persisted in `localStorage`** | SPEC §9.1 allows local state; sent as `product_context` when creating a session. |
| F14 | **npm as the package manager for all documented commands** | User choice; zero extra setup on Windows. |

---

## 3. Design System (the "sharp, minimal, professional" contract)

### 3.1 Color tokens (CSS variables, both modes)

Core tokens are standard shadcn names; set them once in `globals.css`:

| Token | Light | Dark | Notes |
|---|---|---|---|
| `background` | `#fafafa` (zinc-50) | `#09090b` (zinc-950) | App canvas |
| `card` / `popover` | `#ffffff` | `#18181b` (zinc-900) | Raised surfaces (a bg step, not a shadow) |
| `border` / `input` | `#e4e4e7` (zinc-200) | `#27272a` (zinc-800) | The 1px line language |
| `muted` / `muted-foreground` | `#f4f4f5` / `#71717a` | `#27272a` / `#a1a1aa` | Secondary text, subtle fills |
| `primary` / `primary-foreground` | `#0d9488` (teal-600) / `#ffffff` | `#2dd4bf` (teal-400) / `#09090b` | Primary actions, active nav, live indicators |
| `ring` | teal-600 | teal-400 | Focus rings, 2px, offset 0 |
| `secondary` | zinc-100 | zinc-800 | Secondary buttons |

Semantic (used by charts, meters, badges only — never chrome):

| Meaning | Token | Value |
|---|---|---|
| Trust up / converted / convinced | `--success` | `#10b981` (emerald-500) |
| Skeptical / stalled / warning | `--warning` | `#f59e0b` (amber-500) |
| Rejected / annoyed / recording | `--danger` | `#ef4444` (red-500) |

**Disposition → color mapping (HUD badge):** `guarded` → zinc, `curious` → teal, `skeptical_about_switching` → amber, `convinced` → emerald, `annoyed_ready_to_hang_up` → red.

**Trust meter rule:** score bands 0–39 red, 40–69 amber, 70–100 emerald; rendered as a segmented square bar (10 sharp segments), never a rounded/gradient gauge.

### 3.2 Typography
* `--font-sans`: Geist Sans — body at 14px (`text-sm`), headings `tracking-tight`, page titles `text-2xl font-semibold`.
* `--font-mono`: Geist Mono — **all numbers**: trust scores, chart axes, timestamps, speaker labels (`YOU` / `VIKRAM`), score deltas. This is the signature "engineered" detail.
* No font weights beyond 400/500/600.

### 3.3 Shape & elevation rules (non-negotiable for the look)
* `--radius: 0rem` — every component is square. No `rounded-*` anywhere (badges included).
* Borders over shadows: `border border-border`, never `shadow-*` (toasts excepted, per sonner default).
* Interactive states: background-step change (`hover:bg-muted`) + teal ring on focus; active nav = teal left-edge 2px indicator + `bg-primary/10`.
* Spacing on a 4px grid; dashboard content `max-w-6xl`; generous whitespace over decoration.

### 3.4 `globals.css` skeleton (Tailwind v4 + shadcn)

```css
@import "tailwindcss";
@import "shadcn/tailwind.css"; /* added by shadcn init */
@custom-variant dark (&:is(.dark *));

:root { --radius: 0rem; /* …light tokens from §3.1 as oklch/hex vars… */ }
.dark { /* …dark tokens… */ }

@theme inline {
  --color-background: var(--background);
  /* …standard shadcn mappings… */
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --radius-lg: var(--radius); --radius-md: calc(var(--radius) - 2px); --radius-sm: calc(var(--radius) - 4px);
}
```

---

## 4. Phase-wise TODO

### Phase 0 — Scaffold & Design System
- [ ] `npx create-next-app@latest frontend --typescript --eslint --app --tailwind --src-dir --import-alias "@/*"` (from repo root; SPEC §3 uses `/frontend`).
- [ ] `npx shadcn@latest init` (defaults: Next template, zinc base, CSS variables).
- [ ] Fonts: `Geist` + `Geist_Mono` via `next/font/google` in `layout.tsx`; expose `--font-geist-sans`/`--font-geist-mono` variables.
- [ ] `globals.css`: token sets from §3.1/§3.4 (light + `.dark`), `--radius: 0rem`, semantic success/warning/danger tokens.
- [ ] `next-themes` provider, dark default (`defaultTheme="dark"`), minimal theme toggle (sun/moon icon button).
- [ ] shadcn add: `button card badge input textarea label select separator skeleton dropdown-menu tooltip tabs table dialog alert progress scroll-area sonner sidebar avatar` (add others on demand).
- [ ] App shell: shadcn Sidebar (collapsible icon mode) with nav — **Dashboard** (`/`), **Persona Builder** (`/personas/new`), **Sessions** (`/sessions` via dashboard anchor); main region renders route content; footer shows backend health dot (`GET /health`).
- [ ] `.env.local.example`: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`, `BACKEND_ORIGIN=http://localhost:8000`.
- [ ] `lib/api.ts`: typed fetch wrapper (personas/sessions endpoints, error normalization, timeouts).

**DoD — Phase 0:** `npm run dev` renders the dark sidebar shell with working toggle, teal accent visible on active nav, all squares/borders per §3.3; `lib/api.ts` fetches seeded personas from the running VM backend.

### Phase 1 — Dashboard (`/`)
- [ ] **Product Pitch Context** card: textarea autosaving to `localStorage` (F13), char counter, "saved" flash.
- [ ] **Persona grid**: `PersonaCard` — name, role @ company, language badge (`EN-IN`/`HI-IN`/`HINGLISH`), scenario badge, status-quo chips, initial trust mono numeral; **Start Call** button → `POST /api/sessions` (persona_id + product_context) → `router.push(/call/{id})`.
- [ ] Empty state (no personas) → CTA to Persona Builder.
- [ ] **Analytics summary table**: recent sessions (persona, started, final trust in mono, outcome badge, overall score), conversion-rate stat cards on top (reuse `GET /api/sessions`).
- [ ] Row click → `/sessions/{id}`.

**DoD — Phase 1:** start-to-call flow works against the backend; table reflects a real session ended from Phase 3 testing; localStorage context survives reloads.

### Phase 2 — Persona Builder (`/personas/new`)
- [ ] Form: name, role title, company profile, language mode (select: en-IN / hi-IN / codemix), `sarvam_voice_id` input with helper text linking the v4 naming pattern (`<name>_<lang>_<style>`) and the three seeded examples, call scenario select, initial trust slider (0–100, default 25).
- [ ] Tag-list inputs (type + Enter, chips with × remove) for Status Quo Stack, Hidden Pain Points, Switching Objections — hidden pains visually flagged "revealed only to sharp discovery questions".
- [ ] Client validation mirroring backend schemas; `POST /api/personas` → toast → redirect to `/`.
- [ ] "Test voice" nicety is out of scope (backend preflight covers voices).

**DoD — Phase 2:** a persona created here appears on the dashboard grid and is usable in a call; invalid payloads show inline field errors (422 mapping).

### Phase 3 — Live Call Studio (`/call/[sessionId]`)
- [ ] `app/api/offer/route.ts`: `export async function POST` forwards body + `sessionId` query to `POST ${BACKEND_ORIGIN}/api/offer?session_id=…`; `export async function PATCH` forwards trickle ICE. Plain `fetch` passthrough, JSON in/out.
- [ ] Client-only page (`dynamic(…, { ssr: false })`): `PipecatClientProvider` with `new PipecatClient({ transport: new SmallWebRTCTransport(), enableMic: true })`.
- [ ] Connect on mount: `client.connect({ endpoint: `/api/offer?sessionId=${sessionId}` })`; on unmount / **End Call**: `client.disconnect()` + `POST /api/sessions/{id}/end` → redirect to `/sessions/{id}`.
- [ ] **Buyer Psyche HUD** (zustand store fed by `useRTVIClientEvent(RTVIEvent.ServerMessage)`):
  * Trust meter: segmented square bar, mono score numeral, delta flash (+/-) on each event.
  * Disposition badge with §3.1 mapping; `internal_monologue` line, hidden unless **Hard Mode off** (persisted toggle).
  * `objections_resolved` chips when non-empty.
- [ ] **Live transcript** panel via `usePipecatConversation` (or ServerMessage-independent conversation state); speaker labels in mono, auto-scroll with stick-to-bottom.
- [ ] **Mic control** (`usePipecatClientMicControl`), connection state chip (`usePipecatClientTransportState`: init/connecting/connected/disconnected), bot audio via `usePipecatClientAudioElement`.
- [ ] Call timer (mono, top-right), leave-confirmation dialog.

**DoD — Phase 3:** real voice call to a seeded persona (en-IN, hi-IN, codemix) works from the Windows browser against the VM backend; backchannels don't cut off the persona (backend behavior verified visually through the transcript); HUD trust/disposition/monologue update live; End Call lands on the analysis page.

### Phase 4 — Post-Call Analysis (`/sessions/[sessionId]`)
- [ ] Fetch `GET /api/sessions/{id}`; if `evaluation_status === "pending"` poll every 3s (cap ~2 min, then show failed state); `live` → link back to call room.
- [ ] **Score cards**: Overall, Discovery Depth, Objection Handling, Value Clarity — big mono numerals, thin score bars in semantic colors, `feature_dumping_detected` alert when true.
- [ ] **Trust Trajectory chart** (Recharts `LineChart`): turn index vs `buyer_trust_snapshot`, dot hover shows the turn text tooltip ("the exact sentence that won or lost the buyer"); reference line at 75 (pilot threshold).
- [ ] **Missed Cues** list (warning-styled, each with the buyer quote) and **Coaching Critique** rendering `actionable_feedback` as Markdown (`react-markdown` + prose styles, sharp).
- [ ] Annotated transcript table (speaker, mono timestamp, trust snapshot column).

**DoD — Phase 4:** a completed session renders every field of the backend `SessionDetail` contract; chart tooltip maps dots to exact turns; pending → ready transition is visible without reload.

### Phase 5 — Polish & Hardening
- [ ] Loading skeletons for every route; empty states for no sessions/personas; error toasts (sonner) with retry for failed fetches; 404 pages for unknown session/persona.
- [ ] Responsive: sidebar collapses to Sheet under `md`; call studio stacks HUD above transcript; dashboard grid 1→2→3 columns.
- [ ] Accessibility pass: focus-visible rings everywhere, aria-labels on icon buttons, `prefers-reduced-motion` respected on the trust-delta flash.
- [ ] `npm run build` + `npm run lint` clean; no console errors in normal flows.

**DoD — Phase 5:** build passes with zero warnings that reference our code; every failure path shows a designed state instead of a blank screen.

---

## 5. Definition of Done (Frontend Overall)

1. **Stack:** Next.js 16 + Tailwind v4 + shadcn (zinc/teal, `--radius: 0`) + Geist/Geist Mono; `npm run build` clean.
2. **Design system:** §3 tokens implemented once in `globals.css`; no hex values or `shadow-*`/`rounded-*` in component code (except sonner default); semantic colors appear only in data.
3. **Full loop works end-to-end:** create persona → set pitch context → start call → live HUD + transcript over SmallWebRTC → End Call → scorecard + trust trajectory render from real backend data.
4. **Contract fidelity:** every field of the backend's persona/session/evaluation schemas is surfaced; `evaluation_status` polling handles pending/ready/failed.
5. **Resilience:** all fetch failures, unknown IDs, empty data, and mid-call disconnects render designed states.
6. **Hygiene:** env vars documented in `.env.local.example`; no secrets client-side (`BACKEND_ORIGIN` server-only); npm-standard scripts.

### Known risks / watch-items
* **Turbopack + shadcn**: both current and compatible, but if a registry component misbehaves under Turbopack, retry with `webpack` via `next dev --webpack` before debugging the component.
* **Recharts + React 19**: pin `recharts@^3` (v2 has React 19 peer issues).
* **SDP proxy fidelity**: the route handler must forward `PATCH` (trickle ICE) too, or calls stall at connection setup; test reconnects (`pc_id` reuse) by refreshing mid-call.
* **Geist on `next/font/google`**: if the Google Fonts mirror of Geist causes offline build failures, fall back to the `geist` npm package (same families, self-hosted).
* **High-frequency HUD updates**: throttle trust-delta flash animations; never put the zustand store subscription above the layout root.
* **Backend not reachable**: the dashboard health dot should render "backend offline" instead of throwing — first thing to check when the VM isn't up.
