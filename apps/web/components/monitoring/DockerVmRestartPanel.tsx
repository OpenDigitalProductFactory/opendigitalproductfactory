"use client";

// BI-F8F8C383 — the one operator control for a wedged Docker VM.
//
// Shown on the portal's Health tab only while the substrate reconciler reports
// processes stuck in uninterruptible I/O. It states what is stuck and what a
// restart stops, asks once in a danger-tone confirmation, and hands the restart
// to the native Edge agent on the Windows host. Nothing here runs on its own.

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/Dialog";
import { requestDockerVmRestartAction } from "@/lib/actions/docker-vm-restart";
import type { DockerVmRestartCheck } from "@/lib/remote-action/docker-vm-restart-action";

export function DockerVmRestartPanel({ offer }: { offer: DockerVmRestartCheck }) {
  const [pending, startTransition] = useTransition();
  const [queued, setQueued] = useState<{ rfcId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRestart() {
    if (!offer.offered) return;
    const confirmed = await confirmDialog({
      title: "Restart the Docker VM?",
      message: offer.impact,
      confirmLabel: "Restart Docker VM",
      tone: "danger",
    });
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const result = await requestDockerVmRestartAction({ operatorConfirmed: true });
      if (result.ok) setQueued({ rfcId: result.data.rfcId });
      else setError(result.error);
    });
  }

  return (
    <section
      id="docker-vm-restart"
      aria-labelledby="docker-vm-restart-heading"
      className="mb-6 rounded-lg border border-[var(--dpf-error)] bg-[var(--dpf-state-error)] p-4"
    >
      <h2 id="docker-vm-restart-heading" className="text-sm font-semibold text-[var(--dpf-text)]">
        The Docker VM is wedged
      </h2>
      {offer.offered ? (
        <>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">{offer.wedged}</p>
          <p className="mt-2 text-xs text-[var(--dpf-muted)]">{offer.impact}</p>
          {queued ? (
            <p role="status" className="mt-3 text-sm text-[var(--dpf-text)]">
              Restart queued as change {queued.rfcId}. The portal goes offline once the host agent picks it up and
              returns when Docker is back, usually within a few minutes.
            </p>
          ) : (
            <Button type="button" variant="danger" size="sm" className="mt-3" onClick={handleRestart} disabled={pending}>
              {pending ? "Draining the platform…" : "Restart Docker VM…"}
            </Button>
          )}
          {error ? (
            <p role="alert" className="mt-2 text-sm text-[var(--dpf-error)]">{error}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--dpf-text)]">{offer.message}</p>
      )}
    </section>
  );
}
