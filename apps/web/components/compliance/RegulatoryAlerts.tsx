"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { dismissAlert, reviewAlert } from "@/lib/actions/regulatory-monitor";

type Alert = {
  id: string;
  alertId: string;
  title: string;
  severity: string;
  alertType: string;
  description: string | null;
  suggestedAction: string | null;
  status: string;
  createdAt: Date;
  regulation: { shortName: string; jurisdiction: string } | null;
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-900/30 text-red-400",
  high: "bg-orange-900/30 text-orange-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  low: "bg-green-900/30 text-green-400",
};

export function RegulatoryAlerts({ alerts }: { alerts: Alert[] }) {
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const pending = alerts.filter((a) => a.status === "pending");

  async function handleDismiss(id: string) {
    setLoading(true);
    await dismissAlert(id);
    setSelectedAlert(null);
    setLoading(false);
    router.refresh();
  }

  async function handleReview(id: string, resolution: string) {
    setLoading(true);
    await reviewAlert(id, resolution);
    setSelectedAlert(null);
    setLoading(false);
    router.refresh();
  }

  if (pending.length === 0) {
    return <p className="text-sm text-[var(--dpf-muted)]">No pending alerts.</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {pending.map((a) => (
          <div key={a.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between cursor-pointer hover:border-[var(--dpf-accent)] transition-colors"
            onClick={() => setSelectedAlert(a)}>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[a.severity] ?? "bg-gray-900/30 text-gray-400"}`}>
                  {a.severity}
                </span>
                <span className="text-sm text-[var(--dpf-text)]">{a.title}</span>
              </div>
              {a.regulation && (
                <span className="text-[9px] text-[var(--dpf-muted)] mt-1 block">{a.regulation.shortName} · {a.regulation.jurisdiction}</span>
              )}
            </div>
            <span className="text-xs text-[var(--dpf-muted)]">{new Date(a.createdAt).toLocaleDateString()}</span>
          </div>
        ))}
      </div>

      <ComplianceModal open={!!selectedAlert} onClose={() => setSelectedAlert(null)} title="Review Alert">
        {selectedAlert && (
          <div className="space-y-4">
            <div>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[selectedAlert.severity] ?? ""}`}>
                {selectedAlert.severity}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] ml-2">{selectedAlert.alertType}</span>
            </div>
            {selectedAlert.description && <p className="text-sm text-[var(--dpf-text)]">{selectedAlert.description}</p>}
            {selectedAlert.suggestedAction && (
              <div className="p-3 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
                <p className="text-xs text-[var(--dpf-muted)] mb-1">Suggested Action</p>
                <p className="text-sm text-[var(--dpf-text)]">{selectedAlert.suggestedAction}</p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={() => handleDismiss(selectedAlert.id)} disabled={loading}
                className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50">
                Dismiss
              </button>
              <button onClick={() => handleReview(selectedAlert.id, "flagged-for-further-review")} disabled={loading}
                className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50">
                Flag for Review
              </button>
              <button onClick={() => handleReview(selectedAlert.id, "regulation-updated")} disabled={loading}
                className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50">
                Mark Reviewed
              </button>
            </div>
          </div>
        )}
      </ComplianceModal>
    </>
  );
}
