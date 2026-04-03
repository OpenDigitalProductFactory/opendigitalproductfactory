"use client";

import { useState } from "react";
import { acceptAttribution, dismissEntity } from "@/lib/actions/inventory";

type CandidateTaxonomy = {
  nodeId: string;
  name: string;
  score: number;
};

type ExceptionEntity = {
  id: string;
  entityKey: string;
  entityType: string;
  name: string;
  attributionConfidence: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  candidateTaxonomy: CandidateTaxonomy[];
  properties: Record<string, unknown>;
};

type Props = {
  entities: ExceptionEntity[];
};

export function InventoryExceptionQueue({ entities }: Props) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  if (entities.length === 0) return null;

  const visible = entities.filter((e) => !resolved.has(e.id));
  if (visible.length === 0) return null;

  async function handleAccept(entityId: string) {
    setPending((s) => new Set(s).add(entityId));
    const result = await acceptAttribution(entityId);
    setPending((s) => { const n = new Set(s); n.delete(entityId); return n; });
    if (result.ok) setResolved((s) => new Set(s).add(entityId));
  }

  async function handleDismiss(entityId: string) {
    setPending((s) => new Set(s).add(entityId));
    const result = await dismissEntity(entityId);
    setPending((s) => { const n = new Set(s); n.delete(entityId); return n; });
    if (result.ok) setResolved((s) => new Set(s).add(entityId));
  }

  return (
    <div className="bg-[var(--dpf-surface-1)] border border-yellow-500/30 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
        <h3 className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-wider">
          Needs Review
        </h3>
        <span className="text-[10px] text-yellow-500 font-medium">
          {visible.length} item{visible.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="text-[10px] text-[var(--dpf-muted)] mb-3">
        These discovered infrastructure entities could not be confidently placed in the taxonomy. Review and accept the suggested placement, or dismiss.
      </p>

      <div className="flex flex-col gap-2">
        {visible.map((entity) => {
          const topCandidate = entity.candidateTaxonomy[0];
          const isProcessing = pending.has(entity.id);

          return (
            <div
              key={entity.id}
              className="flex items-start justify-between gap-3 px-3 py-2 rounded bg-[var(--dpf-bg)] border border-[var(--dpf-border)]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--dpf-text)]">
                    {entity.name}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                    {entity.entityType}
                  </span>
                  {entity.attributionConfidence != null && (
                    <span className="text-[9px] text-[var(--dpf-muted)]">
                      {Math.round(entity.attributionConfidence * 100)}% conf.
                    </span>
                  )}
                </div>

                {topCandidate && (
                  <div className="mt-1 text-[10px] text-[var(--dpf-muted)]">
                    Suggested: <span className="font-mono">{topCandidate.nodeId.replace(/\//g, " / ")}</span>
                    <span className="ml-1 text-yellow-500">({Math.round(topCandidate.score * 100)}%)</span>
                  </div>
                )}

                {!topCandidate && (
                  <div className="mt-1 text-[10px] text-[var(--dpf-muted)]">
                    No taxonomy match found
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {topCandidate && (
                  <button
                    onClick={() => handleAccept(entity.id)}
                    disabled={isProcessing}
                    className="text-[10px] px-2 py-1 rounded bg-green-600/20 text-green-500 hover:bg-green-600/30 disabled:opacity-50"
                  >
                    {isProcessing ? "..." : "Accept"}
                  </button>
                )}
                <button
                  onClick={() => handleDismiss(entity.id)}
                  disabled={isProcessing}
                  className="text-[10px] px-2 py-1 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
                >
                  {isProcessing ? "..." : "Dismiss"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
