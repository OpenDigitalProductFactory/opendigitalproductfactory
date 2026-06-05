"use client";

import { useState, useTransition } from "react";
import type { CapabilityActivationChoice } from "@dpf/storefront-templates";
import { updateCapabilityActivation } from "@/lib/actions/capability-activation";

/**
 * The admin "add it later" toggle for an offered capability (EP-PARTNER-CHANNEL
 * Phase 1b). Flips the org's persisted OrganizationCapabilityActivation choice.
 */
export function CapabilityActivationToggle({
  capabilityKey,
  active,
}: {
  capabilityKey: string;
  active: boolean;
}) {
  const [on, setOn] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next: CapabilityActivationChoice = on ? "disabled" : "enabled";
    setError(null);
    startTransition(async () => {
      const result = await updateCapabilityActivation(capabilityKey, next);
      if (result.ok) {
        setOn(next === "enabled");
      } else {
        setError(result.error ?? "Could not update");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? "Turn off" : "Turn on"}
        disabled={pending}
        onClick={toggle}
        className={[
          "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
          on ? "bg-[var(--dpf-accent)] border-[var(--dpf-accent)]" : "bg-[var(--dpf-surface-2)] border-[var(--dpf-border)]",
          pending ? "opacity-60" : "",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-4 w-4 transform rounded-full bg-[var(--dpf-surface-1)] transition-transform",
            on ? "translate-x-6" : "translate-x-1",
          ].join(" ")}
        />
      </button>
      {error && <span className="text-[10px] text-[var(--dpf-muted)]">{error}</span>}
    </div>
  );
}
