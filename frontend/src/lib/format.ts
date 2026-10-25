/**
 * Display helpers shared across routes. All numeric formatting uses Geist Mono
 * classes at the call site — helpers only decide semantics.
 */
import type { Disposition } from "@/lib/api";

export const LANGUAGE_LABEL: Record<string, string> = {
  "en-IN": "EN-IN",
  "hi-IN": "HI-IN",
  codemix: "HINGLISH",
};

export const SCENARIO_LABEL: Record<string, string> = {
  cold_call: "Cold call",
  warm_discovery: "Warm discovery",
  demo_objection: "Demo objection",
};

export const OUTCOME_LABEL: Record<string, string> = {
  converted: "Converted",
  follow_up_booked: "Follow-up booked",
  stalled: "Stalled",
  rejected: "Rejected",
};

export type Tone = "primary" | "success" | "warning" | "danger" | "muted";

/** Badge/chip styling per tone — data colors only, sharp borders (§3.3). */
export const TONE_CLASS: Record<Tone, string> = {
  primary: "border-primary/40 bg-primary/10 text-primary",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  muted: "border-border bg-muted text-muted-foreground",
};

/** Solid fills (meters, dots). */
export const TONE_BG: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted-foreground",
};

/** Text-only color (numerals, inline labels). */
export const TONE_TEXT: Record<Tone, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

export const OUTCOME_TONE: Record<string, Tone> = {
  converted: "success",
  follow_up_booked: "success",
  stalled: "warning",
  rejected: "danger",
};

/** Trust meter bands (FRONTEND.md §3.1): 0-39 red, 40-69 amber, 70-100 emerald. */
export function trustBand(score: number): Tone {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "danger";
}

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  guarded: "Guarded",
  curious: "Curious",
  skeptical_about_switching: "Skeptical",
  convinced: "Convinced",
  annoyed_ready_to_hang_up: "Ready to hang up",
};

export const DISPOSITION_TONE: Record<Disposition, Tone> = {
  guarded: "muted",
  curious: "primary",
  skeptical_about_switching: "warning",
  convinced: "success",
  annoyed_ready_to_hang_up: "danger",
};

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : DATE_FMT.format(date);
}

export function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "—";
  const seconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
