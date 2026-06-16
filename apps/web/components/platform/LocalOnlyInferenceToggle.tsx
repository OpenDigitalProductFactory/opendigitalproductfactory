"use client";

import { useState, useTransition } from "react";
import { setLocalOnlyInferenceSetting } from "@/lib/actions/build-studio";

type Props = {
  initialEnabled: boolean;
  canWrite: boolean;
};

/**
 * "Local-only inference (disable cloud)" switch for Providers & Routing.
 *
 * When ON, every routed AI call is pinned to the local provider; calls no local
 * model can serve fail loudly rather than silently using a configured cloud
 * provider. The discoverable, one-switch alternative to disabling each cloud
 * provider by hand (which leaves a silent-fallback footgun if one is missed).
 */
export function LocalOnlyInferenceToggle({ initialEnabled, canWrite }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    const prev = enabled;
    setEnabled(next); // optimistic
    startTransition(async () => {
      try {
        await setLocalOnlyInferenceSetting(next);
      } catch (err) {
        setEnabled(prev); // revert on failure
        setError((err as Error).message);
      }
    });
  }

  return (
    <div
      style={{
        marginBottom: 24,
        border: `1px solid ${enabled ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
        borderRadius: 8,
        padding: "12px 14px",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 640 }}>
          <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            Local-only inference
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--dpf-text)" }}>
            Route every AI call to your local model and <strong>never fall back to cloud</strong>.
            When on, a call that no local model can serve fails loudly (&ldquo;no eligible local
            model&rdquo;) instead of silently using a cloud provider — so a fully-local Build Studio
            run executes every phase (ideate / plan / review / build) on local.
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--dpf-muted)" }}>
            This is the one-switch guarantee; you don&rsquo;t have to disable each cloud provider by
            hand. Disabled providers below still stay excluded.
          </p>
          {error && <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--dpf-error)" }}>⚠ {error}</p>}
        </div>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: canWrite ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canWrite || isPending}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: enabled ? "var(--dpf-accent)" : "var(--dpf-muted)" }}>
            {enabled ? "On — cloud disabled" : "Off — cloud allowed"}
          </span>
        </label>
      </div>
    </div>
  );
}
