"use client";

import { TONE_BG, TONE_TEXT, trustBand } from "@/lib/format";

const SEGMENTS = 10;

/**
 * Segmented square trust bar (FRONTEND.md §3.1): bands 0-39 red / 40-69 amber /
 * 70-100 emerald, mono numeral. The +/- delta flash is pure CSS (keyed by deltaAt,
 * see the flash-delta keyframes in globals.css) — no state, no timers.
 */
export function TrustMeter({
  score,
  delta,
  deltaAt,
}: {
  score: number;
  delta: number | null;
  deltaAt: number | null;
}) {
  const filled = Math.round((score / 100) * SEGMENTS);
  const band = trustBand(score);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Buyer trust</span>
        <span className="flex items-baseline gap-1.5">
          {delta != null && deltaAt != null && (
            <span
              key={deltaAt}
              className={`animate-[flash-delta_1.2s_ease-out_forwards] font-mono text-xs ${
                delta >= 0 ? "text-success" : "text-danger"
              }`}
            >
              {delta >= 0 ? `+${delta}` : delta}
            </span>
          )}
          <span className={`font-mono text-2xl font-medium tracking-tight ${TONE_TEXT[band]}`}>
            {score}
          </span>
          <span className="font-mono text-xs text-muted-foreground">/100</span>
        </span>
      </div>
      <div
        className="flex gap-0.5"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <div
            key={index}
            className={`h-2 flex-1 border ${
              index < filled ? `${TONE_BG[band]} border-transparent` : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
