"use client";

import { useState } from "react";

type BootstrapBindingsButtonProps = {
  label?: string;
};

export function BootstrapBindingsButton({
  label = "Refresh inferred bindings",
}: BootstrapBindingsButtonProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBootstrap() {
    setPending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/platform/authority-bindings/bootstrap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ writeMode: "commit" }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to infer authority bindings.");
      }

      const payload = (await response.json()) as {
        report?: {
          created?: number;
          skippedExisting?: number;
        };
      };

      setMessage(
        `Inference complete. Created ${payload.report?.created ?? 0} binding(s); skipped ${payload.report?.skippedExisting ?? 0}.`,
      );
      window.location.reload();
    } catch (bootstrapError) {
      setError(bootstrapError instanceof Error ? bootstrapError.message : "Failed to infer authority bindings.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleBootstrap}
        disabled={pending}
        className="rounded-lg border border-[var(--dpf-border)] px-4 py-2 text-sm text-[var(--dpf-text)] disabled:opacity-60"
      >
        {pending ? "Inferring..." : label}
      </button>
      {message ? <span className="text-xs text-[var(--dpf-muted)]">{message}</span> : null}
      {error ? <span className="text-xs text-[var(--dpf-danger,#dc2626)]">{error}</span> : null}
    </div>
  );
}
