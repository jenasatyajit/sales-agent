"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScorecardView } from "@/components/scorecard-view";
import { api, type SessionDetail } from "@/lib/api";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40; // ≈2 minutes

/**
 * Post-call analysis view (SPEC §9.4). Polls while the evaluator is running
 * (evaluation_status "pending"), renders the scorecard once ready.
 */
export function AnalysisView({ sessionId }: { sessionId: string }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [pollAttempts, setPollAttempts] = useState(0);

  // All state updates happen in async continuations, not synchronously in the effect body.
  const load = useCallback(
    () =>
      api
        .getSession(sessionId)
        .then(
          (data) => setDetail(data),
          (error: unknown) => {
            toast.error(error instanceof Error ? error.message : "Could not load session");
            setFailed(true);
          },
        ),
    [sessionId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the evaluator is running.
  useEffect(() => {
    if (detail?.evaluation_status !== "pending") return;
    if (pollAttempts >= MAX_POLL_ATTEMPTS) return;
    const timer = setTimeout(() => {
      setPollAttempts((attempts) => attempts + 1);
      void load();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [detail, pollAttempts, load]);

  if (failed) {
    return (
      <Notice>
        Session not found.{" "}
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Back to dashboard
        </Link>
      </Notice>
    );
  }

  if (detail === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (detail.evaluation_status === "live") {
    return (
      <Notice>
        This call is still in progress.{" "}
        <Link href={`/call/${sessionId}`} className="text-primary underline-offset-4 hover:underline">
          Return to the call room
        </Link>
      </Notice>
    );
  }

  if (detail.evaluation_status === "pending") {
    const timedOut = pollAttempts >= MAX_POLL_ATTEMPTS;
    return (
      <Notice>
        {timedOut ? (
          <>
            The evaluator is taking longer than expected.{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => void load()}>
              Retry now
            </Button>
          </>
        ) : (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Grading your call with sarvam-105b…
          </span>
        )}
      </Notice>
    );
  }

  if (detail.evaluation_status === "failed") {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            The evaluation failed for this session
            {detail.evaluation?.actionable_feedback
              ? `: ${detail.evaluation.actionable_feedback}`
              : "."}{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => void load()}>
              Retry
            </Button>
          </CardContent>
        </Card>
        {/* Transcript is still valuable even without a scorecard. */}
        <ScorecardView detail={detail} />
      </div>
    );
  }

  return <ScorecardView detail={detail} />;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex justify-center py-10 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}
