import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { AnalysisView } from "./analysis-view";

export default function SessionAnalysisPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <Suspense fallback={<Skeleton className="h-64" />}>
        <AnalysisViewLoader params={params} />
      </Suspense>
    </div>
  );
}

async function AnalysisViewLoader({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <AnalysisView sessionId={sessionId} />;
}
