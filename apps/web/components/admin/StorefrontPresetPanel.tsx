"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyDpfProductionInstancePreset } from "@/lib/actions/dpf-production-instance";
import { confirmDialog } from "@/components/ui/Dialog";

/**
 * BI-6F9D487C — support/admin-only tooling. This panel is intentionally not
 * reachable from any owner-facing route: it lives under `/admin/storefront/preset`,
 * which is gated by the shell admin layout's `can(..., "view_admin")` check.
 * The mutation is destructive (overwrites organization/business identity), so
 * it requires an explicit in-app confirmation before it runs — no silent
 * single-click apply.
 */
export function StorefrontPresetPanel() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    const confirmed = await confirmDialog({
      title: "Apply DPF production-instance preset?",
      message:
        "Internal support action for converting this install toward Open Digital Product Factory " +
        "customer-zero truth. This overwrites the organization name, slug, contact details, business " +
        "context, and storefront tagline/description with Open Digital Product Factory's own production " +
        "values. This does not change archetype; use the admin archetype reset first when needed.",
      tone: "danger",
      confirmLabel: "Apply preset",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      try {
        await applyDpfProductionInstancePreset();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to apply preset");
      }
    });
  }

  return (
    <div
      style={{
        padding: "16px",
        borderRadius: 8,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--dpf-text)" }}>
        DPF production-instance preset
      </div>
      <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 12 }}>
        Internal support action for converting this install toward Open Digital Product Factory customer-zero
        truth. This does not change archetype; use the admin archetype reset first when needed.
      </p>
      <button
        type="button"
        onClick={handleApply}
        disabled={isPending}
        style={{
          padding: "8px 20px",
          borderRadius: 6,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-2)",
          color: "var(--dpf-text)",
          cursor: isPending ? "wait" : "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {isPending ? "Applying…" : "Apply DPF preset"}
      </button>
      {error && (
        <div style={{ fontSize: 12, color: "var(--dpf-error)", marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
