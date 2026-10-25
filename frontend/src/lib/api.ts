/**
 * Typed REST client for the FastAPI backend (SPEC §8).
 * All browser calls go through here so error handling and the base URL stay in one place.
 */

export type LanguageMode = "en-IN" | "hi-IN" | "codemix";
export type CallScenario = "cold_call" | "warm_discovery" | "demo_objection";
export type Outcome = "converted" | "follow_up_booked" | "stalled" | "rejected";
export type EvaluationStatus = "live" | "pending" | "ready" | "failed";
export type Disposition =
  | "guarded"
  | "curious"
  | "skeptical_about_switching"
  | "convinced"
  | "annoyed_ready_to_hang_up";

export interface Persona {
  id: string;
  name: string;
  role_title: string;
  company_profile: string;
  language_mode: LanguageMode;
  sarvam_voice_id: string;
  status_quo_stack: string[];
  hidden_pain_points: string[];
  switching_objections: string[];
  call_scenario: CallScenario;
  initial_trust_score: number;
  created_at: string;
}

export interface PersonaCreate {
  name: string;
  role_title: string;
  company_profile: string;
  language_mode: LanguageMode;
  sarvam_voice_id: string;
  status_quo_stack: string[];
  hidden_pain_points: string[];
  switching_objections: string[];
  call_scenario: CallScenario;
  initial_trust_score: number;
}

export interface SessionSummary {
  id: string;
  persona_name: string;
  language_mode: LanguageMode;
  started_at: string;
  ended_at: string | null;
  final_trust_score: number | null;
  outcome: Outcome | null;
  overall_score: number | null;
}

export interface TranscriptTurn {
  id: number;
  speaker: "user" | "assistant";
  text: string;
  timestamp: string;
  buyer_trust_snapshot: number | null;
}

export interface StateEvent {
  timestamp?: string;
  trust_delta?: number;
  trust_score?: number;
  disposition?: Disposition;
  active_objection?: string | null;
  internal_monologue?: string;
  objections_resolved?: string[];
}

export interface Evaluation {
  id: string;
  session_id: string;
  overall_score: number | null;
  discovery_depth_score: number | null;
  objection_handling_score: number | null;
  value_clarity_score: number | null;
  feature_dumping_detected: boolean | null;
  missed_cues: string[];
  actionable_feedback: string;
}

export interface SessionDetail {
  id: string;
  persona: Persona;
  product_context: string;
  started_at: string;
  ended_at: string | null;
  final_trust_score: number | null;
  outcome: Outcome | null;
  state_history: StateEvent[];
  turns: TranscriptTurn[];
  evaluation: Evaluation | null;
  evaluation_status: EvaluationStatus;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Backend unreachable — is the VM running?");
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body) => String(body?.detail ?? body?.["message"] ?? ""))
      .catch(() => "");
    throw new ApiError(response.status, detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  listPersonas: () => request<Persona[]>("/api/personas"),

  createPersona: (payload: PersonaCreate) =>
    request<Persona>("/api/personas", { method: "POST", body: JSON.stringify(payload) }),

  createSession: (personaId: string, productContext: string) =>
    request<{ id: string; persona_id: string; started_at: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ persona_id: personaId, product_context: productContext }),
    }),

  endSession: (sessionId: string) =>
    request<{ status: string; evaluation_status: string }>(
      `/api/sessions/${sessionId}/end`,
      { method: "POST" },
    ),

  listSessions: () => request<SessionSummary[]>("/api/sessions"),

  getSession: (sessionId: string) => request<SessionDetail>(`/api/sessions/${sessionId}`),
};
