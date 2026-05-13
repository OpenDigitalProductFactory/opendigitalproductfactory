"use client";

import { useState, useTransition } from "react";

import {
  approveEdgeNode,
  quarantineEdgeNode,
  revokeEdgeNode,
  unquarantineEdgeNode,
  type EdgeNodeRow as EdgeNodeRowData,
} from "@/lib/actions/edge-node-actions";

const TRUST_BADGE_CLASS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-700 border-yellow-500/40",
  trusted: "bg-green-500/10 text-green-700 border-green-500/40",
  quarantined: "bg-orange-500/10 text-orange-700 border-orange-500/40",
  revoked: "bg-red-500/10 text-red-700 border-red-500/40",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function EdgeNodeRow({
  node,
  onActionComplete,
}: {
  node: EdgeNodeRowData;
  onActionComplete: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const badgeClass =
    TRUST_BADGE_CLASS[node.trustState] ?? "bg-gray-500/10 text-[var(--dpf-text)]";

  function withConfirm(label: string, run: () => Promise<void>) {
    return () => {
      if (!window.confirm(`${label} this Edge Node?`)) return;
      setError(null);
      startTransition(async () => {
        try {
          await run();
          onActionComplete();
        } catch (err) {
          setError((err as Error).message);
        }
      });
    };
  }

  function withReason(label: string, run: (reason: string) => Promise<void>) {
    return () => {
      const reason = window.prompt(`${label} reason:`)?.trim();
      if (!reason) return;
      setError(null);
      startTransition(async () => {
        try {
          await run(reason);
          onActionComplete();
        } catch (err) {
          setError((err as Error).message);
        }
      });
    };
  }

  return (
    <tr className="border-b border-[var(--dpf-border)]/60 align-top">
      <td className="py-2 pr-3 text-[var(--dpf-text)]">{node.displayName}</td>
      <td className="py-2 pr-3 font-mono text-xs text-[var(--dpf-muted)]">
        {node.nodeId}
      </td>
      <td className="py-2 pr-3 text-xs text-[var(--dpf-muted)]">
        {node.platform} / {node.installMode}
      </td>
      <td className="py-2 pr-3">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}
        >
          {node.trustState}
        </span>
      </td>
      <td className="py-2 pr-3 text-xs text-[var(--dpf-muted)]">
        {node.status}
        {node.quarantineReason && (
          <span className="block mt-0.5 italic">
            {node.quarantineReason}
          </span>
        )}
        {node.revokedAt && (
          <span className="block mt-0.5 italic">revoked</span>
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-[var(--dpf-muted)]">
        {formatRelative(node.lastSeenAt)}
      </td>
      <td className="py-2 pr-3 text-xs text-[var(--dpf-muted)]">
        {node.capabilities.length === 0 ? "—" : node.capabilities.join(", ")}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-1 text-xs">
          {node.trustState === "pending" && (
            <button
              type="button"
              disabled={isPending}
              onClick={withConfirm("Approve", async () => {
                await approveEdgeNode({ edgeNodeId: node.id });
              })}
              className="rounded border border-green-500/40 px-2 py-1 text-green-700 hover:bg-green-500/10 disabled:opacity-50"
            >
              Approve
            </button>
          )}
          {node.trustState === "quarantined" && (
            <button
              type="button"
              disabled={isPending}
              onClick={withConfirm("Unquarantine", async () => {
                await unquarantineEdgeNode({ edgeNodeId: node.id });
              })}
              className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
            >
              Unquarantine
            </button>
          )}
          {(node.trustState === "pending" || node.trustState === "trusted") && (
            <button
              type="button"
              disabled={isPending}
              onClick={withReason("Quarantine", async (reason) => {
                await quarantineEdgeNode({ edgeNodeId: node.id, reason });
              })}
              className="rounded border border-orange-500/40 px-2 py-1 text-orange-700 hover:bg-orange-500/10 disabled:opacity-50"
            >
              Quarantine
            </button>
          )}
          {node.trustState !== "revoked" && (
            <button
              type="button"
              disabled={isPending}
              onClick={withReason("Revoke", async (reason) => {
                await revokeEdgeNode({ edgeNodeId: node.id, reason });
              })}
              className="rounded border border-red-500/40 px-2 py-1 text-red-700 hover:bg-red-500/10 disabled:opacity-50"
            >
              Revoke
            </button>
          )}
        </div>
        {error && (
          <p className="mt-1 text-xs text-red-700">{error}</p>
        )}
      </td>
    </tr>
  );
}
