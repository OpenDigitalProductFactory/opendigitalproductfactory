"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approvePromotion,
  rejectPromotion,
  markDeployed,
  executePromotionAction,
  acknowledgeDestructiveOps,
  getPromotionWindowStatus,
} from "@/lib/actions/promotions";

type Promotion = {
  id: string;
  promotionId: string;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rationale: string | null;
  deployedAt: string | null;
  deploymentLog: string | null;
  rollbackReason: string | null;
  destructiveAcknowledged: boolean;
  createdAt: string;
  productVersion: {
    version: string;
    gitTag: string;
    gitCommitHash: string;
    shippedBy: string;
    shippedAt: string;
    changeCount: number;
    changeSummary: string | null;
    digitalProduct: { productId: string; name: string } | null;
  };
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  approved: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  deployed: "bg-green-500/20 text-green-300 border-green-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
  failed: "bg-red-500/20 text-red-300 border-red-500/30",
  rolled_back: "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

export default function PromotionsClient({ promotions }: { promotions: Promotion[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<string>("all");
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [deployResult, setDeployResult] = useState<{ promotionId: string; success: boolean; message: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);

  const filtered = filter === "all" ? promotions : promotions.filter((p) => p.status === filter);

  function handleApprove(promotionId: string) {
    startTransition(async () => {
      await approvePromotion(promotionId, rationale);
      setActionTarget(null);
      setRationale("");
      router.refresh();
    });
  }

  function handleReject(promotionId: string) {
    startTransition(async () => {
      await rejectPromotion(promotionId, rationale);
      setActionTarget(null);
      setRationale("");
      router.refresh();
    });
  }

  function handleDeploy(promotionId: string, override?: string) {
    setDeployResult(null);
    startTransition(async () => {
      const result = await executePromotionAction(promotionId, override || undefined);
      setDeployResult({ promotionId, success: result.success, message: result.message });
      setShowOverride(false);
      setOverrideReason("");
      router.refresh();

      // If promoter started, poll for status updates every 5s
      if (result.success && result.step === "started") {
        setDeployResult({ promotionId, success: true, message: "Deployment in progress..." });
        const poll = setInterval(() => { router.refresh(); }, 5_000);
        // Stop polling after 10 minutes (promoter timeout)
        setTimeout(() => clearInterval(poll), 10 * 60 * 1000);
      }
    });
  }

  function handleAcknowledgeDestructive(promotionId: string) {
    startTransition(async () => {
      await acknowledgeDestructiveOps(promotionId);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {["all", "pending", "approved", "deployed", "rejected"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filter === s
                ? "bg-[var(--dpf-accent)]/20 text-[var(--dpf-accent)] border-[var(--dpf-accent)]/40"
                : "bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] border-[var(--dpf-border)] hover:text-[var(--dpf-text)]"
            }`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            {s !== "all" && ` (${promotions.filter((p) => p.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Promotion list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-[var(--dpf-muted)]">
          No promotions {filter !== "all" ? `with status "${filter}"` : "yet"}.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--dpf-text)]">
                      {p.productVersion.digitalProduct?.name ?? "Unknown Product"}
                    </span>
                    <span className="text-sm font-mono text-[var(--dpf-accent)]">
                      {p.productVersion.gitTag}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--dpf-muted)] mt-1 space-x-3">
                    <span>{p.promotionId}</span>
                    <span>{p.productVersion.changeCount} change{p.productVersion.changeCount !== 1 ? "s" : ""}</span>
                    <span>shipped {new Date(p.productVersion.shippedAt).toLocaleDateString()}</span>
                  </div>
                  {p.productVersion.changeSummary && (
                    <p className="text-xs text-[var(--dpf-muted)] mt-2 line-clamp-2">
                      {p.productVersion.changeSummary}
                    </p>
                  )}
                  {p.rationale && (
                    <p className="text-xs text-[var(--dpf-text)]/70 mt-2 italic">
                      Rationale: {p.rationale}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 shrink-0">
                  {p.status === "pending" && (
                    <>
                      <button
                        onClick={() => setActionTarget(actionTarget === p.promotionId ? null : p.promotionId)}
                        disabled={isPending}
                        className="px-3 py-1.5 text-xs rounded-lg bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                      >
                        Review
                      </button>
                    </>
                  )}
                  {p.status === "approved" && (
                    <button
                      onClick={() => handleDeploy(p.promotionId)}
                      disabled={isPending}
                      className="px-3 py-1.5 text-xs rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
                    >
                      {isPending ? "Deploying..." : "Deploy Now"}
                    </button>
                  )}
                </div>
              </div>

              {/* Deploy result feedback */}
              {deployResult?.promotionId === p.promotionId && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${
                  deployResult.success
                    ? "bg-green-500/10 text-green-300 border border-green-500/20"
                    : "bg-red-500/10 text-red-300 border border-red-500/20"
                }`}>
                  {deployResult.message}
                </div>
              )}

              {/* Rollback info */}
              {p.status === "rolled_back" && p.rollbackReason && (
                <div className="mt-3 p-3 rounded-lg bg-orange-500/10 text-orange-300 border border-orange-500/20 text-sm">
                  Rolled back: {p.rollbackReason}
                </div>
              )}

              {/* Deployment log */}
              {p.deploymentLog && (p.status === "deployed" || p.status === "rolled_back") && (
                <details className="mt-2">
                  <summary className="text-xs text-[var(--dpf-muted)] cursor-pointer hover:text-[var(--dpf-text)]">
                    Deployment log
                  </summary>
                  <pre className="mt-1 p-2 rounded bg-[var(--dpf-surface-2)] text-xs text-[var(--dpf-muted)] whitespace-pre-wrap overflow-x-auto">
                    {p.deploymentLog}
                  </pre>
                </details>
              )}

              {/* Window override panel (shown when Deploy Now is blocked by window) */}
              {showOverride && actionTarget === p.promotionId && p.status === "approved" && (
                <div className="mt-3 pt-3 border-t border-[var(--dpf-border)]">
                  <p className="text-xs text-[var(--dpf-muted)] mb-2">
                    Not in a deployment window. Provide a reason to override:
                  </p>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Emergency override reason (required)..."
                    className="w-full p-2 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] resize-none"
                    rows={2}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleDeploy(p.promotionId, overrideReason)}
                      disabled={isPending || !overrideReason.trim()}
                      className="px-4 py-1.5 text-xs rounded-lg bg-orange-500/20 text-orange-300 border border-orange-500/30 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
                    >
                      {isPending ? "Deploying..." : "Emergency Deploy"}
                    </button>
                    <button
                      onClick={() => { setShowOverride(false); setOverrideReason(""); setActionTarget(null); }}
                      className="px-4 py-1.5 text-xs rounded-lg text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Approval/Rejection panel */}
              {actionTarget === p.promotionId && p.status === "pending" && (
                <div className="mt-3 pt-3 border-t border-[var(--dpf-border)]">
                  <textarea
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="Rationale (optional but recommended for audit trail)..."
                    className="w-full p-2 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] resize-none"
                    rows={2}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleApprove(p.promotionId)}
                      disabled={isPending}
                      className="px-4 py-1.5 text-xs rounded-lg bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                    >
                      {isPending ? "..." : "Approve"}
                    </button>
                    <button
                      onClick={() => handleReject(p.promotionId)}
                      disabled={isPending}
                      className="px-4 py-1.5 text-xs rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    >
                      {isPending ? "..." : "Reject"}
                    </button>
                    <button
                      onClick={() => { setActionTarget(null); setRationale(""); }}
                      className="px-4 py-1.5 text-xs rounded-lg text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
