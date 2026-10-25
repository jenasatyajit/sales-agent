import { Suspense } from "react";

import { CallPageClient } from "@/components/call/call-page-client";

export default function CallPage({ params }: PageProps<"/call/[sessionId]">) {
  return (
    <Suspense fallback={<div className="h-[calc(100vh-3rem)]" />}>
      <CallPageContent params={params} />
    </Suspense>
  );
}

async function CallPageContent({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <CallPageClient sessionId={sessionId} />;
}
