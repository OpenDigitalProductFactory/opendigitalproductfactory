"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { provisionBuildEngineAction } from "@/lib/actions/build-engine-actions";

type Props = {
  /** Engine id: "claude" | "codex" | "grok". */
  engineId: string;
  /** Short display label, e.g. "Grok". */
  label: string;
};

/**
 * Inline "Provision" action for a build engine that is selectable but not
 * installed in the sandbox (its readiness badge shows "Not installed"). Runs the
 * engine's registry recipe via the governed provisionBuildEngineAction, then
 * refreshes so the readiness badge re-renders — closing the
 * "select → provision → green" loop without hand-editing Dockerfile.sandbox.
 */
export function ProvisionEngineButton({ engineId, label }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleProvision() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await provisionBuildEngineAction(engineId);
        if (outcome.kind === "no-recipe") {
          setError(outcome.reason);
        } else if (outcome.kind === "verify-failed") {
          setError(`Still not installed after the ${outcome.recipe} recipe.`);
        } else if (outcome.kind === "error") {
          setError(outcome.error);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not provision this engine.");
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
      <button
        type="button"
        onClick={handleProvision}
        disabled={isPending}
        style={{
          alignSelf: "flex-start",
          borderRadius: 4,
          padding: "2px 8px",
          fontSize: 10,
          fontWeight: 600,
          background: "var(--dpf-accent)",
          color: "white",
          border: "none",
          cursor: isPending ? "wait" : "pointer",
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? `Provisioning ${label}…` : `Provision ${label} in sandbox`}
      </button>
      {error ? (
        <span role="alert" style={{ fontSize: 10, color: "var(--dpf-warning)", maxWidth: "16rem" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
