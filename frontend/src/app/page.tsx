"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PersonaCard } from "@/components/persona-card";
import { api, type Persona, type SessionSummary } from "@/lib/api";
import {
  OUTCOME_LABEL,
  OUTCOME_TONE,
  TONE_CLASS,
  TONE_TEXT,
  formatDateTime,
  formatDuration,
  trustBand,
} from "@/lib/format";
import { PRODUCT_CONTEXT_STORAGE_KEY, useLocalStorage } from "@/lib/storage";

export default function DashboardPage() {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  // Stored value (via useSyncExternalStore) + unsaved draft while debouncing.
  const [storedContext, setStoredContext] = useLocalStorage(PRODUCT_CONTEXT_STORAGE_KEY, "");
  const [draftContext, setDraftContext] = useState<string | null>(null);
  const pitchContext = draftContext ?? storedContext;

  // Debounced autosave — state updates happen in the timer callback, not in the effect body.
  useEffect(() => {
    if (draftContext === null) return;
    const timer = setTimeout(() => {
      setStoredContext(draftContext);
      setDraftContext(null);
    }, 500);
    return () => clearTimeout(timer);
  }, [draftContext, setStoredContext]);

  const refresh = useCallback(async () => {
    await Promise.all([api.listPersonas(), api.listSessions()]).then(
      ([personaRows, sessionRows]) => {
        setPersonas(personaRows);
        setSessions(sessionRows);
      },
      (error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to load dashboard");
        setPersonas([]);
        setSessions([]);
      },
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const finished = (sessions ?? []).filter((s) => s.ended_at !== null);
  const conversions = finished.filter((s) => s.outcome === "converted").length;
  const conversionRate = finished.length
    ? Math.round((conversions / finished.length) * 100)
    : null;
  const avgTrust = finished.length
    ? Math.round(
        finished.reduce((sum, s) => sum + (s.final_trust_score ?? 0), 0) / finished.length,
      )
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Practice calls" value={finished.length} />
        <StatCard label="Conversion rate" value={conversionRate == null ? "—" : `${conversionRate}%`} />
        <StatCard label="Avg final trust" value={avgTrust == null ? "—" : `${avgTrust}/100`} />
        <StatCard
          label="Avg overall score"
          value={averageScore(sessions) == null ? "—" : `${averageScore(sessions)}/100`}
        />
      </div>

      {/* Product pitch context */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="tracking-tight">Product Pitch Context</CardTitle>
            <CardDescription>
              Describe your B2B SaaS platform — every persona hears this pitch.
            </CardDescription>
          </div>
          <span
            className={`font-mono text-[10px] transition-opacity ${
              draftContext === null ? "text-success opacity-100" : "text-muted-foreground opacity-60"
            }`}
          >
            {draftContext === null ? "SAVED" : "SAVING…"}
          </span>
        </CardHeader>
        <CardContent>
          <Textarea
            value={pitchContext}
            onChange={(event) => setDraftContext(event.target.value)}
            placeholder="e.g. FleetOps — an AI operations copilot for logistics teams that automates dispatch, billing reconciliation and fleet tracking…"
            className="min-h-24 resize-y"
          />
        </CardContent>
      </Card>

      {/* Persona grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">ICP Buyer Personas</h2>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/personas/new" />}
          >
            New persona
          </Button>
        </div>

        {personas === null ? (
          <SkeletonGrid />
        ) : personas.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No personas yet. Create your first ICP buyer in the{" "}
              <Link href="/personas/new" className="text-primary underline-offset-4 hover:underline">
                Persona Builder
              </Link>
              .
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {personas.map((persona) => (
              <PersonaCard key={persona.id} persona={persona} />
            ))}
          </div>
        )}
      </section>

      {/* Recent sessions */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Recent Calls</h2>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Final trust</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions === null ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    No practice calls yet — start one from a persona above.
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((session) => {
                  const live = session.ended_at === null;
                  const band = trustBand(session.final_trust_score ?? 0);
                  return (
                    <TableRow key={session.id} className="cursor-pointer">
                      <TableCell>
                        <Link href={`/sessions/${session.id}`} className="hover:underline">
                          {session.persona_name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatDateTime(session.started_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatDuration(session.started_at, session.ended_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {live ? (
                          <span className="font-mono text-xs text-primary">LIVE</span>
                        ) : (
                          <span className={`font-mono text-xs ${TONE_TEXT[band]}`}>
                            {session.final_trust_score ?? "—"}/100
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {live ? (
                          <Badge className="border-primary/40 bg-primary/10 text-primary">Live</Badge>
                        ) : session.outcome ? (
                          <Badge className={TONE_CLASS[OUTCOME_TONE[session.outcome]]}>
                            {OUTCOME_LABEL[session.outcome]}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Evaluating…
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {session.overall_score ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}

function averageScore(sessions: SessionSummary[] | null): number | null {
  const scored = (sessions ?? []).filter((s) => s.overall_score != null);
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, s) => sum + (s.overall_score ?? 0), 0) / scored.length);
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription className="text-xs">{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <p className="font-mono text-2xl font-medium tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index} className="min-h-44" />
      ))}
    </div>
  );
}
