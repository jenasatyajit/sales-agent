"use client";

import { Eye, EyeOff, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TrustMeter } from "@/components/call/trust-meter";
import { useCallHudStore } from "@/lib/store";
import { DISPOSITION_LABEL, DISPOSITION_TONE, TONE_CLASS } from "@/lib/format";
import { HARD_MODE_STORAGE_KEY, useLocalStorage } from "@/lib/storage";

/**
 * Buyer Psyche HUD (SPEC §9.3): trust meter, disposition badge, internal monologue
 * (hidden in Hard Mode), resolved-objection chips. State comes from the zustand
 * store fed by BUYER_STATE_UPDATE server messages.
 */
export function VoiceCallHud({ personaName }: { personaName: string }) {
  const trustScore = useCallHudStore((state) => state.trustScore);
  const lastDelta = useCallHudStore((state) => state.lastDelta);
  const deltaAt = useCallHudStore((state) => state.deltaAt);
  const disposition = useCallHudStore((state) => state.disposition);
  const internalMonologue = useCallHudStore((state) => state.internalMonologue);
  const objectionsResolved = useCallHudStore((state) => state.objectionsResolved);

  const [hardModeValue, setHardModeValue] = useLocalStorage(HARD_MODE_STORAGE_KEY, "false");
  const hardMode = hardModeValue === "true";

  function toggleHardMode() {
    setHardModeValue(hardMode ? "false" : "true");
  }

  return (
    <Card className="gap-3">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            Buyer psyche — {personaName}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={toggleHardMode}
            title="Hard Mode hides the buyer's internal monologue"
          >
            {hardMode ? <EyeOff /> : <Eye />}
            {hardMode ? "Hard mode" : "Easy mode"}
          </Button>
        </div>

        <TrustMeter score={trustScore} delta={lastDelta} deltaAt={deltaAt} />

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={`text-[10px] ${TONE_CLASS[DISPOSITION_TONE[disposition]]}`}>
            {DISPOSITION_LABEL[disposition]}
          </Badge>
          {objectionsResolved.map((objection) => (
            <Badge
              key={objection}
              variant="outline"
              className="border-success/40 text-[10px] text-success"
              title="Switching objection addressed"
            >
              ✓ {objection}
            </Badge>
          ))}
        </div>

        {internalMonologue && !hardMode && (
          <p className="border-l-2 border-l-primary/40 bg-primary/5 px-2 py-1.5 text-xs italic text-muted-foreground">
            “{internalMonologue}”
          </p>
        )}
      </CardContent>
    </Card>
  );
}
