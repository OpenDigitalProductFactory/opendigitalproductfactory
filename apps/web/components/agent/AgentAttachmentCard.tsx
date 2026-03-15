"use client";

import type { AttachmentInfo } from "@/lib/agent-coworker-types";

const TYPE_ICONS: Record<string, string> = {
  "text/csv": "\u{1F4CA}",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "\u{1F4CA}",
  "application/pdf": "\u{1F4C4}",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "\u{1F4DD}",
};

export function AgentAttachmentCard({ attachment }: { attachment: AttachmentInfo }) {
  const icon = TYPE_ICONS[attachment.mimeType] ?? "\u{1F4CE}";
  const sizeKb = Math.round(attachment.sizeBytes / 1024);
  const sizeLabel = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)}MB` : `${sizeKb}KB`;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-xs mt-1 mb-1">
      <span className="text-base">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-white truncate">{attachment.fileName}</div>
        <div className="text-[var(--dpf-muted)] text-[10px]">
          {sizeLabel}
          {attachment.parsedSummary && <span> &middot; {attachment.parsedSummary}</span>}
        </div>
      </div>
    </div>
  );
}
