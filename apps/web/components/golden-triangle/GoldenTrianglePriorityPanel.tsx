"use client";
// EP-GOLDEN-TRIANGLE Slice 2/4 — stateful host for the posture control on the
// /platform/ai/priority surface. Seeds from the saved WWMD/platform default and
// saves edits back via the server action (migration-free; stored on the platform
// DecisionPerspectiveProfile's autonomyPolicy JSON).
import { useState } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { saveGoldenTrianglePlatformDefault } from "@/lib/actions/golden-triangle";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { preferenceFromPreset } from "./posture-display";

export function GoldenTrianglePriorityPanel({ initial }: { initial?: GoldenTrianglePreference }) {
  const [pref, setPref] = useState<GoldenTrianglePreference>(initial ?? preferenceFromPreset("balanced"));
  const [saved, setSaved] = useState<"idle" | "saved" | "error">("idle");
  const [pending, setPending] = useState(false);

  function onChange(next: GoldenTrianglePreference) {
    setPref(next);
    setSaved("idle");
  }

  async function save() {
    setPending(true);
    setSaved("idle");
    try {
      const res = await saveGoldenTrianglePlatformDefault(pref);
      setSaved(res.ok ? "saved" : "error");
    } catch {
      setSaved("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <GoldenTriangleControl value={pref} onChange={onChange} taskClass="conversation" authorityScopeKind="wwmd" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-[13px] font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save as platform default"}
        </button>
        {saved === "saved" && <span style={{ fontSize: 12, color: "var(--dpf-success)" }}>Saved</span>}
        {saved === "error" && <span style={{ fontSize: 12, color: "var(--dpf-error)" }}>Could not save</span>}
      </div>
    </div>
  );
}
