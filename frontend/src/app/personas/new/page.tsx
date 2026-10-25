"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { TagInput } from "@/components/tag-input";
import { api, type CallScenario, type LanguageMode } from "@/lib/api";

/** Known-good bulbul:v4-flash voice IDs from the backend seed (FRONTEND.md §4 Phase 2). */
const VOICE_HINTS: Record<LanguageMode, string> = {
  "en-IN": "simran_en_conversation",
  "hi-IN": "aayan_hi_conversational",
  codemix: "ishita_enhi_customer",
};

const SCENARIOS: { value: CallScenario; label: string }[] = [
  { value: "cold_call", label: "Cold call" },
  { value: "warm_discovery", label: "Warm discovery" },
  { value: "demo_objection", label: "Demo objection" },
];

export default function PersonaBuilderPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [companyProfile, setCompanyProfile] = useState("");
  const [languageMode, setLanguageMode] = useState<LanguageMode>("en-IN");
  const [voiceId, setVoiceId] = useState(VOICE_HINTS["en-IN"]);
  const [callScenario, setCallScenario] = useState<CallScenario>("cold_call");
  const [initialTrust, setInitialTrust] = useState(25);
  const [statusQuoStack, setStatusQuoStack] = useState<string[]>([]);
  const [hiddenPainPoints, setHiddenPainPoints] = useState<string[]>([]);
  const [switchingObjections, setSwitchingObjections] = useState<string[]>([]);

  function pickLanguage(mode: LanguageMode) {
    setLanguageMode(mode);
    setVoiceId(VOICE_HINTS[mode]);
  }

  async function submit() {
    if (!name.trim() || !roleTitle.trim() || !companyProfile.trim() || !voiceId.trim()) {
      toast.error("Name, role, company and voice ID are required");
      return;
    }
    setSaving(true);
    try {
      await api.createPersona({
        name: name.trim(),
        role_title: roleTitle.trim(),
        company_profile: companyProfile.trim(),
        language_mode: languageMode,
        sarvam_voice_id: voiceId.trim(),
        status_quo_stack: statusQuoStack,
        hidden_pain_points: hiddenPainPoints,
        switching_objections: switchingObjections,
        call_scenario: callScenario,
        initial_trust_score: initialTrust,
      });
      toast.success(`Persona "${name.trim()}" created`);
      router.push("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create persona");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Persona Builder</h1>
          <p className="text-sm text-muted-foreground">
            Create an ICP buyer with a realistic status quo, hidden bottlenecks and switching fears.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Vikram Mehta"
              />
            </Field>
            <Field label="Role title">
              <Input
                value={roleTitle}
                onChange={(event) => setRoleTitle(event.target.value)}
                placeholder="Head of Operations"
              />
            </Field>
            <Field label="Company profile">
              <Input
                value={companyProfile}
                onChange={(event) => setCompanyProfile(event.target.value)}
                placeholder="250-person Series B logistics SaaS"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Language mode">
              <Select value={languageMode} onValueChange={(value) => pickLanguage(value as LanguageMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-IN">English (en-IN)</SelectItem>
                  <SelectItem value="hi-IN">Hindi (hi-IN)</SelectItem>
                  <SelectItem value="codemix">Hinglish (code-mixed)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Call scenario">
              <Select value={callScenario} onValueChange={(value) => setCallScenario(value as CallScenario)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCENARIOS.map((scenario) => (
                    <SelectItem key={scenario.value} value={scenario.value}>
                      {scenario.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Initial trust — ${initialTrust}/100`}>
              <div className="flex h-8 items-center">
                <Slider
                  value={[initialTrust]}
                  onValueChange={(value) => setInitialTrust(Array.isArray(value) ? value[0] : value)}
                  min={0}
                  max={100}
                  step={5}
                />
              </div>
            </Field>
          </div>

          <Field
            label="Sarvam voice ID"
            hint={
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  bulbul:v4-flash — &lt;name&gt;_&lt;lang&gt;_&lt;style&gt;
                </span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {VOICE_HINTS[languageMode]}
                </Badge>
              </span>
            }
          >
            <Input
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              className="font-mono text-xs"
              placeholder={VOICE_HINTS[languageMode]}
            />
          </Field>

          <Field label="Status quo stack" hint={<span className="text-[10px] text-muted-foreground">Tools they defend today</span>}>
            <TagInput
              value={statusQuoStack}
              onChange={setStatusQuoStack}
              placeholder="Excel, Jira, WhatsApp groups…"
              ariaLabel="Status quo stack"
            />
          </Field>

          <Field
            label="Hidden workflow pain points"
            hint={<span className="text-[10px] text-warning">Revealed only to sharp discovery questions</span>}
          >
            <TagInput
              value={hiddenPainPoints}
              onChange={setHiddenPainPoints}
              placeholder="Billing reconciliation eats 2 days a month…"
              ariaLabel="Hidden pain points"
            />
          </Field>

          <Field label="Switching objections">
            <TagInput
              value={switchingObjections}
              onChange={setSwitchingObjections}
              placeholder="Migration downtime, retraining fatigue…"
              ariaLabel="Switching objections"
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving}>
          Create persona
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {hint}
      </Label>
      {children}
    </div>
  );
}
