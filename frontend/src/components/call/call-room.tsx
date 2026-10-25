"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import {
  PipecatClientProvider,
  usePipecatClient,
  usePipecatClientAudioElement,
  usePipecatClientMicControl,
  usePipecatClientTransportState,
  usePipecatConversation,
  useRTVIClientEvent,
} from "@pipecat-ai/client-react";
import { Mic, MicOff, PhoneOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceCallHud } from "@/components/call/voice-call-hud";
import { api, type Persona } from "@/lib/api";
import { LANGUAGE_LABEL } from "@/lib/format";
import { useCallHudStore, type BuyerStateEvent } from "@/lib/store";

const TRANSPORT_LABEL: Record<string, string> = {
  initializing: "Initializing",
  initialized: "Ready to connect",
  connecting: "Connecting…",
  connected: "Connected",
  ready: "Live",
  disconnecting: "Ending…",
  error: "Connection error",
};

export function CallRoom({ sessionId }: { sessionId: string }) {
  const [client] = useState(
    () =>
      new PipecatClient({
        transport: new SmallWebRTCTransport(),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onError: (message: unknown) => {
            const text =
              typeof message === "string" ? message : ((message as { message?: string })?.message ?? "Call error");
            toast.error(text);
          },
        },
      }),
  );

  useEffect(() => {
    return () => {
      void client.disconnect().catch(() => {});
    };
  }, [client]);

  return (
    <PipecatClientProvider client={client}>
      <CallSessionView sessionId={sessionId} />
    </PipecatClientProvider>
  );
}

function CallSessionView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const client = usePipecatClient();
  const transportState = usePipecatClientTransportState();
  const { enableMic, isMicEnabled } = usePipecatClientMicControl();
  const audioRef = usePipecatClientAudioElement();
  const { messages } = usePipecatConversation();
  const applyServerMessage = useCallHudStore((state) => state.applyServerMessage);
  const resetHud = useCallHudStore((state) => state.reset);

  const [persona, setPersona] = useState<Persona | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);
  const connectAttempted = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  // Load persona (for HUD header + initial trust) once.
  useEffect(() => {
    api
      .getSession(sessionId)
      .then((detail) => {
        setPersona(detail.persona);
        resetHud(detail.persona.initial_trust_score);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Session not found"));
  }, [sessionId, resetHud]);

  // Connect once on mount via the SDP proxy.
  useEffect(() => {
    if (!client || connectAttempted.current) return;
    connectAttempted.current = true;
    startedAtRef.current = Date.now();
    client
      .connect({
        webrtcRequestParams: { endpoint: `/api/offer?sessionId=${sessionId}` },
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Could not reach the voice backend",
        );
      });
  }, [client, sessionId]);

  // Elapsed timer.
  useEffect(() => {
    const timer = setInterval(() => {
      if (startedAtRef.current) setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // BUYER_STATE_UPDATE → HUD store. Handler receives the frame's data payload.
  const onServerMessage = useCallback(
    (data: unknown) => applyServerMessage(data as BuyerStateEvent),
    [applyServerMessage],
  );
  useRTVIClientEvent(RTVIEvent.ServerMessage, onServerMessage);

  const transcript = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          text: message.parts
            .map((part) => (part as { text?: string })?.text ?? "")
            .join("")
            .trim(),
        }))
        .filter((turn) => turn.text.length > 0),
    [messages],
  );

  async function endCall() {
    setEnding(true);
    try {
      await client?.disconnect();
    } catch {
      // already down
    }
    try {
      await api.endSession(sessionId);
    } catch {
      // backend also finalizes on transport disconnect; ignore double-finalize errors
    }
    router.push(`/sessions/${sessionId}`);
  }

  const connecting = transportState === "connecting" || transportState === "initializing";
  const live = transportState === "connected" || transportState === "ready";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Session bar */}
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <Badge
            className={
              live
                ? "border-success/40 bg-success/10 text-success"
                : transportState === "error"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-border bg-muted text-muted-foreground"
            }
          >
            {live && <span className="mr-1 inline-block size-1.5 animate-pulse bg-success" />}
            {TRANSPORT_LABEL[transportState] ?? transportState}
          </Badge>
          {persona && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {LANGUAGE_LABEL[persona.language_mode]} · {persona.sarvam_voice_id}
            </span>
          )}
        </div>
        <span className="font-mono text-sm text-muted-foreground">
          {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
          {String(elapsed % 60).padStart(2, "0")}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* HUD column */}
        <div className="flex w-80 shrink-0 flex-col gap-3 border-r p-4">
          {persona ? (
            <VoiceCallHud personaName={persona.name} />
          ) : (
            <Skeleton className="h-48" />
          )}

          <div className="mt-auto space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => enableMic(!isMicEnabled)}
              disabled={!live}
            >
              {isMicEnabled ? <Mic /> : <MicOff className="text-danger" />}
              {isMicEnabled ? "Mute mic" : "Unmute mic"}
            </Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={endCall}
              disabled={ending || connecting}
            >
              {ending ? <RefreshCw className="animate-spin" /> : <PhoneOff />}
              End call
            </Button>
          </div>
        </div>

        {/* Transcript */}
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <p className="mb-2 text-xs text-muted-foreground">Live transcript</p>
          <TranscriptPanel transcript={transcript} personaName={persona?.name ?? "Buyer"} />
          <audio ref={audioRef} autoPlay className="hidden" />
        </div>
      </div>
    </div>
  );
}

function TranscriptPanel({
  transcript,
  personaName,
}: {
  transcript: { role: "user" | "assistant"; text: string }[];
  personaName: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [transcript]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
      {transcript.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing said yet — open with your pitch once the buyer picks up.
        </p>
      ) : (
        transcript.map((turn, index) => (
          <div key={index} className="space-y-0.5">
            <span
              className={`font-mono text-[10px] ${
                turn.role === "user" ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {turn.role === "user" ? "YOU" : personaName.toUpperCase()}
            </span>
            <p className="text-sm leading-relaxed">{turn.text}</p>
          </div>
        ))
      )}
    </div>
  );
}

export function CallRoomSkeleton() {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-32" />
          <Skeleton className="h-10" />
        </CardContent>
      </Card>
    </div>
  );
}
