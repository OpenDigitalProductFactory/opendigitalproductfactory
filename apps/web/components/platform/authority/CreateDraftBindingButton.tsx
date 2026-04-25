"use client";

import { useState } from "react";

type CreateDraftBindingButtonProps = {
  detailQueryBase: string;
  warning: {
    resourceRef: string;
    agentId: string | null;
    reason: "ungated-route" | "missing-agent" | "missing-subjects";
  };
};

export function CreateDraftBindingButton({ detailQueryBase, warning }: CreateDraftBindingButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateDraft() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/platform/authority-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draftFromWarning: warning,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to create authority binding draft.");
      }

      const payload = (await response.json()) as { bindingId?: string };
      if (!payload.bindingId) {
        throw new Error("Draft binding was created without a binding id.");
      }

      window.location.assign(`${detailQueryBase}?binding=${payload.bindingId}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create authority binding draft.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleCreateDraft}
        disabled={pending}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-text)] disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create draft binding"}
      </button>
      {error ? <span className="text-[10px] text-[var(--dpf-danger,#dc2626)]">{error}</span> : null}
    </div>
  );
}
