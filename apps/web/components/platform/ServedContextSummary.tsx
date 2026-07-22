"use client";

// Resource-aware served-context summary for Platform > AI > Build Runtime
// (BI-3E614946). Makes the previously-invisible local served window + hardware
// ceiling + reasoning-phase cloud-only SPOF legible in one plain-language line —
// all auto-derived from the persisted host profile, never a raw number the
// operator must interpret. Self-fetching so it stays out of the BuildStudioConfigForm
// module (size ceiling) and refreshes when the probed endpoint changes.

import { useEffect, useState } from "react";
import { getLocalServedContextInfo } from "@/lib/actions/build-studio";

export type ServedContextInfo = {
  served: number | null;
  ceiling: number;
  reasoningEnvelope: number;
  reasoningEligible: boolean;
  vramGb: number | null;
  selectedModel: string | null;
};

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`;

/** `refreshKey` — bump (e.g. the last endpoint-check result) to re-read after the
 *  operator changes the model/endpoint or applies a new context window. */
export function ServedContextSummary({ refreshKey }: { refreshKey?: unknown }) {
  const [info, setInfo] = useState<ServedContextInfo | null>(null);
  useEffect(() => {
    let live = true;
    getLocalServedContextInfo()
      .then((i) => live && setInfo(i))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (!info) return null;
  return (
    <p role="status" style={{ fontSize: 10, color: "var(--dpf-muted)", margin: 0 }}>
      Local serves{" "}
      <strong style={{ color: "var(--dpf-text)" }}>{info.served != null ? k(info.served) : "—"}</strong> ·
      hardware ceiling <strong style={{ color: "var(--dpf-text)" }}>{k(info.ceiling)}</strong>
      {info.vramGb != null ? ` (${info.vramGb} GB VRAM` : " (VRAM unknown"}
      {info.selectedModel ? `, ${info.selectedModel})` : ")"} ·{" "}
      {info.reasoningEligible ? (
        <span style={{ color: "var(--dpf-success)" }}>local can run reasoning phases (plan/review)</span>
      ) : (
        <span style={{ color: "var(--dpf-warning, var(--dpf-muted))" }}>
          reasoning phases (plan/review, ~{k(info.reasoningEnvelope)}) run in the cloud on this hardware — raise VRAM
          or run a smaller model to make local a fallback
        </span>
      )}
      .
    </p>
  );
}
