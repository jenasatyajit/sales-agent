import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <p className="font-mono text-4xl tracking-tight text-muted-foreground">404</p>
      <p className="text-sm text-muted-foreground">That page doesn&apos;t exist.</p>
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/" />}>
        Back to dashboard
      </Button>
    </div>
  );
}
