"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Lightbulb } from "lucide-react";
import Markdown from "react-markdown";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SessionDetail } from "@/lib/api";
import { OUTCOME_LABEL, OUTCOME_TONE, SCENARIO_LABEL, TONE_BG, TONE_CLASS, TONE_TEXT, formatDateTime, trustBand } from "@/lib/format";

/**
 * Post-call scorecard (SPEC §9.4): score cards, trust trajectory with turn tooltips,
 * missed cues and the evaluator's markdown coaching critique.
 */
export function ScorecardView({ detail }: { detail: SessionDetail }) {
  const evaluation = detail.evaluation;
  const chartData = detail.turns
    .map((turn, index) => ({
      index,
      score: turn.buyer_trust_snapshot,
      speaker: turn.speaker,
      text: turn.text,
    }))
    .filter((point) => point.score != null);

  return (
    <div className="space-y-6">
      {/* Session header */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{detail.persona.name}</h1>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {SCENARIO_LABEL[detail.persona.call_scenario]}
        </Badge>
        {detail.outcome && (
          <Badge className={`text-[10px] ${TONE_CLASS[OUTCOME_TONE[detail.outcome] ?? "muted"]}`}>
            {OUTCOME_LABEL[detail.outcome]}
          </Badge>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {formatDateTime(detail.started_at)}
        </span>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Pitched: {detail.product_context}
      </p>

      {/* Score cards */}
      {evaluation && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ScoreCard label="Overall" score={evaluation.overall_score} />
          <ScoreCard label="Discovery depth" score={evaluation.discovery_depth_score} />
          <ScoreCard label="Objection handling" score={evaluation.objection_handling_score} />
          <ScoreCard label="Value clarity" score={evaluation.value_clarity_score} />
        </div>
      )}

      {evaluation?.feature_dumping_detected && (
        <Alert className="border-warning/40">
          <AlertTriangle className="size-4 text-warning" />
          <AlertTitle className="text-warning">Feature dumping detected</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            You pitched features without linking them to a pain the buyer had revealed.
          </AlertDescription>
        </Alert>
      )}

      {/* Trust trajectory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm tracking-tight">Trust trajectory</CardTitle>
          <p className="text-xs text-muted-foreground">
            Hover a point to see the exact turn. Dashed line = pilot threshold (75).
          </p>
        </CardHeader>
        <CardContent>
          {chartData.length >= 2 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
                  <XAxis
                    dataKey="index"
                    tick={{ fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip content={<TurnTooltip />} />
                  <ReferenceLine y={75} stroke="var(--primary)" strokeDasharray="4 4" />
                  <Line
                    type="stepAfter"
                    dataKey="score"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={{ r: 2, fill: "var(--chart-1)" }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough transcript data to plot a trajectory.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Missed cues */}
      {evaluation && evaluation.missed_cues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm tracking-tight">
              <AlertTriangle className="size-3.5 text-warning" />
              Missed cues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {evaluation.missed_cues.map((cue, index) => (
                <li key={index} className="border-l-2 border-l-warning/50 pl-3 text-sm">
                  {cue}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Coaching critique */}
      {evaluation?.actionable_feedback && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm tracking-tight">
              <Lightbulb className="size-3.5 text-primary" />
              Coaching critique
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown
              components={{
                h1: (props) => <h2 className="mb-2 mt-4 text-base font-semibold tracking-tight" {...props} />,
                h2: (props) => <h3 className="mb-2 mt-4 text-sm font-semibold tracking-tight" {...props} />,
                h3: (props) => <h4 className="mb-1 mt-3 text-sm font-medium" {...props} />,
                p: (props) => <p className="mb-2 text-sm leading-relaxed" {...props} />,
                ul: (props) => <ul className="mb-2 list-disc space-y-1 pl-5 text-sm" {...props} />,
                ol: (props) => <ol className="mb-2 list-decimal space-y-1 pl-5 text-sm" {...props} />,
                strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
                em: (props) => <em className="italic" {...props} />,
                blockquote: (props) => (
                  <blockquote className="mb-2 border-l-2 border-l-primary/40 pl-3 italic text-muted-foreground" {...props} />
                ),
              }}
            >
              {evaluation.actionable_feedback}
            </Markdown>
          </CardContent>
        </Card>
      )}

      {/* Annotated transcript */}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Speaker</TableHead>
              <TableHead className="w-28">Time</TableHead>
              <TableHead>Turn</TableHead>
              <TableHead className="w-16 text-right">Trust</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.turns.map((turn) => (
              <TableRow key={turn.id}>
                <TableCell
                  className={`font-mono text-[10px] ${
                    turn.speaker === "user" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {turn.speaker === "user" ? "YOU" : detail.persona.name.split(" ")[0].toUpperCase()}
                </TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">
                  {formatDateTime(turn.timestamp)}
                </TableCell>
                <TableCell className="text-sm leading-relaxed">{turn.text}</TableCell>
                <TableCell
                  className={`text-right font-mono text-xs ${
                    turn.buyer_trust_snapshot != null
                      ? TONE_TEXT[trustBand(turn.buyer_trust_snapshot)]
                      : "text-muted-foreground"
                  }`}
                >
                  {turn.buyer_trust_snapshot ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number | null }) {
  const band = score != null ? trustBand(score) : "muted";
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4">
        <p className={`font-mono text-3xl font-medium tracking-tight ${TONE_TEXT[band]}`}>
          {score ?? "—"}
        </p>
        <div className="h-1 w-full bg-muted">
          <div
            className={`h-full ${TONE_BG[score != null ? band : "muted"]}`}
            style={{ width: `${score ?? 0}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function TurnTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { index: number; score: number; speaker: string; text: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="max-w-72 border border-border bg-popover p-2 text-xs">
      <p className="mb-1 font-mono text-[10px] text-muted-foreground">
        TURN {point.index} · {point.speaker === "user" ? "YOU" : "BUYER"} · TRUST {point.score}
      </p>
      <p className="line-clamp-4 leading-relaxed">{point.text}</p>
    </div>
  );
}
