// apps/web/components/build/FeatureBriefPanel.tsx
"use client";

import { type FeatureBrief, type BuildPhase, type FeatureBuildRow } from "@/lib/feature-build-types";
import type { AttachmentInfo } from "@/lib/agent-coworker-types";
import { AgentAttachmentCard } from "@/components/agent/AgentAttachmentCard";
import { EvidenceSummary } from "./EvidenceSummary";

type Props = {
  brief: FeatureBrief | null;
  phase: BuildPhase;
  diffSummary: string | null;
  attachments?: AttachmentInfo[];
  build?: FeatureBuildRow;
};

export function FeatureBriefPanel({ brief, phase, diffSummary, attachments, build }: Props) {
  if (phase === "review" || phase === "ship" || phase === "complete") {
    return (
      <div className="p-4">
        <h3 className="text-sm font-bold text-[var(--dpf-text)] mb-3">Build Summary</h3>
        {diffSummary ? (
          <pre className="text-xs text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed bg-[var(--dpf-surface-2)] p-3 rounded-md border border-[var(--dpf-border)]">
            {diffSummary}
          </pre>
        ) : (
          <p className="text-[13px] text-[var(--dpf-muted)]">No changes recorded.</p>
        )}
        {phase === "review" && build && (
          <div className="mt-4">
            <EvidenceSummary build={build} />
          </div>
        )}
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="p-4">
        <p className="text-[13px] text-[var(--dpf-muted)]">
          Describe your feature idea in the conversation panel. The AI will build a Feature Brief from your description.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <h3 className="text-sm font-bold text-[var(--dpf-text)]">Feature Brief</h3>
      <Section label="Title" value={brief.title} />
      <Section label="Description" value={brief.description} />
      <Section label="Portfolio" value={brief.portfolioContext || "Not set"} />
      <Section label="Target Roles" value={brief.targetRoles.join(", ") || "Not set"} />
      <Section label="Data Needs" value={brief.dataNeeds || "Not set"} />
      {brief.acceptanceCriteria.length > 0 && (
        <div>
          <span className="text-[11px] text-[var(--dpf-muted)] uppercase tracking-wider">
            Acceptance Criteria
          </span>
          <ul className="mt-1 pl-4 list-disc">
            {brief.acceptanceCriteria.map((c, i) => (
              <li key={i} className="text-[13px] text-[#ccc] leading-relaxed">{c}</li>
            ))}
          </ul>
        </div>
      )}
      {attachments && attachments.length > 0 && (
        <div>
          <span className="text-[11px] text-[var(--dpf-muted)] uppercase tracking-wider">
            Attachments
          </span>
          <div className="mt-1">
            {attachments.map((att) => (
              <AgentAttachmentCard key={att.id} attachment={att} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[11px] text-[var(--dpf-muted)] uppercase tracking-wider">{label}</span>
      <p className="text-[13px] text-[#ccc] mt-0.5 leading-snug">{value}</p>
    </div>
  );
}
