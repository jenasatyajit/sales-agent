"use client";

import dynamic from "next/dynamic";

import { CallRoomSkeleton } from "@/components/call/call-room";

// The Pipecat client touches browser APIs (WebRTC, media devices) — client-only.
const CallRoom = dynamic(
  () => import("@/components/call/call-room").then((mod) => mod.CallRoom),
  { ssr: false, loading: () => <CallRoomSkeleton /> },
);

export function CallPageClient({ sessionId }: { sessionId: string }) {
  return (
    <div className="h-[calc(100vh-3rem)]">
      <CallRoom sessionId={sessionId} />
    </div>
  );
}
