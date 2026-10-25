/**
 * Live-call HUD state (FRONTEND.md F9).
 * BUYER_STATE_UPDATE RTVI server messages fire at high frequency mid-call, so they
 * land in this zustand store instead of React state near the layout root.
 */
import { create } from "zustand";

import type { Disposition } from "@/lib/api";

export interface BuyerStateEvent {
  type?: string;
  trust_score?: number;
  trust_delta?: number;
  disposition?: Disposition;
  active_objection?: string | null;
  internal_monologue?: string;
  objections_resolved?: string[];
}

interface CallHudState {
  trustScore: number;
  lastDelta: number | null;
  deltaAt: number | null; // Date.now() of last delta, for the flash animation
  disposition: Disposition;
  activeObjection: string | null;
  internalMonologue: string;
  objectionsResolved: string[];

  reset: (initialTrust: number) => void;
  applyServerMessage: (data: BuyerStateEvent) => void;
}

export const useCallHudStore = create<CallHudState>((set) => ({
  trustScore: 0,
  lastDelta: null,
  deltaAt: null,
  disposition: "guarded",
  activeObjection: null,
  internalMonologue: "",
  objectionsResolved: [],

  reset: (initialTrust) =>
    set({
      trustScore: initialTrust,
      lastDelta: null,
      deltaAt: null,
      disposition: "guarded",
      activeObjection: null,
      internalMonologue: "",
      objectionsResolved: [],
    }),

  applyServerMessage: (data) => {
    if (data.type !== "BUYER_STATE_UPDATE") return;
    set((state) => ({
      trustScore: data.trust_score ?? state.trustScore,
      lastDelta: data.trust_delta ?? null,
      deltaAt: data.trust_delta != null ? Date.now() : state.deltaAt,
      disposition: data.disposition ?? state.disposition,
      activeObjection:
        data.active_objection === null ? null : (data.active_objection ?? state.activeObjection),
      internalMonologue: data.internal_monologue ?? state.internalMonologue,
      objectionsResolved: data.objections_resolved ?? state.objectionsResolved,
    }));
  },
}));
