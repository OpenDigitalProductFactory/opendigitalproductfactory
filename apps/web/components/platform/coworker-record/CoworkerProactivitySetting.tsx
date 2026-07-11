"use client";
// EP-26E528F5 P1 (BI-98329D0C): the record-side mount of the SAME proactivity
// control the chat dock uses (CoworkerPriorityDock), wired to the SAME per-user
// preference actions — one behavior, one component, two altitudes. Proactivity
// is a per-viewer UserFact, not an org-global, so the label says "your" setting.
// BI-AB7CD55B: below the dial, list ONLY what the level actually changes at
// runtime for THIS coworker — no advertised-but-unenforced monitoring/approval/
// escalation promises.
import { useEffect, useRef, useState } from "react";

import {
  getCoworkerProactivityPreference,
  getCoworkerSelfTaskCadenceInfo,
  saveCoworkerProactivityPreference,
} from "@/lib/actions/proactivity";
import { ProactivityLevelControl } from "@/components/proactivity/ProactivityLevelControl";
import { getProactivityLevelCopy } from "@/lib/proactivity/proactivity-copy";
import {
  describeProactivityEffects,
  type CoworkerSelfTaskCadenceInfo,
} from "@/lib/proactivity/proactivity-effects";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";

export function CoworkerProactivitySetting({ agentId }: { agentId: string }) {
  const [level, setLevel] = useState<ProactivityLevel>("balanced");
  const [selfTaskInfo, setSelfTaskInfo] = useState<CoworkerSelfTaskCadenceInfo>({
    registered: false,
    cadence: null,
  });
  // Don't let the async load overwrite a choice made while it was in flight —
  // the same clobber guard the chat dock carries (founder report 2026-07-06).
  const editedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    getCoworkerProactivityPreference(agentId)
      .then((saved) => {
        if (alive && saved && !editedRef.current) setLevel(saved);
      })
      .catch(() => {});
    getCoworkerSelfTaskCadenceInfo(agentId)
      .then((info) => {
        if (alive) setSelfTaskInfo(info);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [agentId]);

  function onChange(next: ProactivityLevel) {
    editedRef.current = true;
    setLevel(next);
    saveCoworkerProactivityPreference(agentId, next).catch(() => {});
  }

  const copy = getProactivityLevelCopy(level);
  const effects = describeProactivityEffects(level, selfTaskInfo);

  return (
    <div
      style={{
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        background: "color-mix(in srgb, var(--dpf-surface-2) 70%, transparent)",
        maxWidth: 680,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ProactivityLevelControl value={level} onChange={onChange} />
        <span style={{ fontSize: 11, color: "var(--dpf-muted)", lineHeight: 1.45, padding: "8px 12px 8px 0" }}>
          {copy.description}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          padding: "0 12px 10px",
          borderTop: "1px solid var(--dpf-border)",
          paddingTop: 8,
        }}
      >
        {effects.map((effect) => (
          <div key={effect.label} style={{ display: "flex", gap: 8, fontSize: 11, lineHeight: 1.4 }}>
            <span style={{ color: "var(--dpf-muted)", flex: "0 0 auto", minWidth: 140 }}>{effect.label}</span>
            <span style={{ color: "var(--dpf-text)" }}>{effect.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
