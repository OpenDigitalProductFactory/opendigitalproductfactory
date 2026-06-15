"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleProviderStatus } from "@/lib/actions/ai-providers";

type Props = {
  providerId: string;
  /** Short label for the button, e.g. "Claude" / "Codex". */
  label: string;
};

/**
 * Inline "Enable" action for a configured-but-disabled code runner on the
 * Build Studio capability gate. Flips ModelProvider.status inactive → active
 * via toggleProviderStatus, then refreshes the route so the gate re-evaluates
 * and the build flow opens — no navigation to /platform/ai/providers.
 */
export function EnableRunnerButton({ providerId, label }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleEnable() {
    setError(null);
    startTransition(async () => {
      try {
        await toggleProviderStatus(providerId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not enable this runner.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleEnable}
        disabled={isPending}
        className="inline-block rounded px-4 py-2 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {isPending ? "Enabling…" : `Enable ${label}`}
      </button>
      {error ? (
        <span role="alert" className="max-w-[16rem] text-right text-xs text-[var(--dpf-warning)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
