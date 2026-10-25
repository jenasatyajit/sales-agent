"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { api, type Persona } from "@/lib/api";
import { LANGUAGE_LABEL, SCENARIO_LABEL, formatDateTime } from "@/lib/format";
import { PRODUCT_CONTEXT_STORAGE_KEY } from "@/lib/storage";

export function PersonaCard({ persona }: { persona: Persona }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function startCall() {
    setStarting(true);
    try {
      const productContext =
        typeof window === "undefined"
          ? ""
          : (localStorage.getItem(PRODUCT_CONTEXT_STORAGE_KEY) ?? "").trim();
      if (!productContext) {
        toast.error("Add your Product Pitch Context first");
        return;
      }
      const session = await api.createSession(persona.id, productContext);
      router.push(`/call/${session.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start call");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-0">
      <CardHeader className="gap-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium tracking-tight">{persona.name}</p>
            <p className="text-sm text-muted-foreground">
              {persona.role_title} · {persona.company_profile}
            </p>
          </div>
          <Badge
            variant="outline"
            className={
              persona.language_mode === "codemix"
                ? "border-primary/40 bg-primary/10 font-mono text-[10px] text-primary"
                : "font-mono text-[10px]"
            }
          >
            {LANGUAGE_LABEL[persona.language_mode]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {SCENARIO_LABEL[persona.call_scenario]}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
            TRUST {persona.initial_trust_score}/100
          </Badge>
        </div>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">Status quo</p>
          <div className="flex flex-wrap gap-1">
            {persona.status_quo_stack.slice(0, 4).map((tool) => (
              <span
                key={tool}
                className="border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {tool}
              </span>
            ))}
            {persona.status_quo_stack.length > 4 && (
              <span className="px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                +{persona.status_quo_stack.length - 4}
              </span>
            )}
          </div>
        </div>
      </CardContent>

      <CardFooter className="items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          Added {formatDateTime(persona.created_at)}
        </span>
        <Button size="sm" onClick={startCall} disabled={starting}>
          {starting ? <RefreshCw className="animate-spin" /> : <Phone />}
          Start call
        </Button>
      </CardFooter>
    </Card>
  );
}
