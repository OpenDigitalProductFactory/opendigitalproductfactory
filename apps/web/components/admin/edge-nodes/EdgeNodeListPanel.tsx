"use client";

import { useState, useTransition } from "react";

import { IssueBootstrapTokenModal } from "./IssueBootstrapTokenModal";
import { EdgeNodeRow } from "./EdgeNodeRow";

import type { EdgeNodeRow as EdgeNodeRowData } from "@/lib/actions/edge-node-actions";

export function EdgeNodeListPanel({
  initialNodes,
}: {
  initialNodes: EdgeNodeRowData[];
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [nodes, setNodes] = useState(initialNodes);

  function refreshAfter(action: () => void) {
    startTransition(() => {
      action();
      // The server actions call revalidatePath, so the next render
      // streams in the updated list. For the immediate UX we drop the
      // optimistic in-state copy; the page reload picks up the fresh
      // data on next navigation.
      setNodes(nodes);
    });
  }

  return (
    <section
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      aria-busy={isPending}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          {nodes.length === 0
            ? "No Edge Nodes enrolled"
            : `${nodes.length} Edge Node${nodes.length === 1 ? "" : "s"}`}
        </h3>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          Issue bootstrap token
        </button>
      </div>

      {nodes.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">
          Nothing here yet. To enroll a node, click <b>Issue bootstrap token</b>,
          copy the token, then run the Edge Node binary with
          <code className="mx-1 text-xs">DPF_BOOTSTRAP_TOKEN=&lt;token&gt;</code>
          set in its environment. The node will appear here after its
          first heartbeat.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--dpf-border)] text-left text-xs text-[var(--dpf-muted)]">
                <th className="pb-2 pr-3">Name</th>
                <th className="pb-2 pr-3">Node ID</th>
                <th className="pb-2 pr-3">Platform</th>
                <th className="pb-2 pr-3">Trust</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Last seen</th>
                <th className="pb-2 pr-3">Capabilities</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <EdgeNodeRow
                  key={node.id}
                  node={node}
                  onActionComplete={() => refreshAfter(() => {})}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <IssueBootstrapTokenModal onClose={() => setIsModalOpen(false)} />
      )}
    </section>
  );
}
