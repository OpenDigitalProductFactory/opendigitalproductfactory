"use client";
// EP-GOLDEN-TRIANGLE Slice 2 — a self-contained, stateful host for the posture
// control, suitable for a settings/preview surface. Holds the preference in
// view-local state; persistence per scope (Slice 4) and the receipt view
// (Slice 3b) wire in later.
import { useState } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { preferenceFromPreset } from "./posture-display";

export function GoldenTrianglePriorityPanel() {
  const [pref, setPref] = useState<GoldenTrianglePreference>(preferenceFromPreset("balanced"));
  return (
    <div style={{ maxWidth: 680 }}>
      <GoldenTriangleControl value={pref} onChange={setPref} taskClass="conversation" authorityScopeKind="wwmd" />
      <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 10 }}>
        Preview — your choice is held in this view only for now. Saving a default per scope (Slice 4) and the
        receipt that shows what actually ran (Slice 3b) wire in next.
      </p>
    </div>
  );
}
