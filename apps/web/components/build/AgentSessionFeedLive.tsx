"use client";

import { useMemo, useState } from "react";

import { useResilientEventSource } from "@/lib/hooks/useResilientEventSource";
import {
  WORK_CAPSULE_ACTIVITY_EVENT,
  type WorkCapsuleActivityStreamEntry,
} from "@/lib/work-capsules/activity-stream";
import type { AgentSessionTone } from "@/lib/work-capsules/agent-activity-presenter";

const TONE_DOT: Record<AgentSessionTone, string> = {
  thought: "var(--dpf-muted)",
  action: "var(--dpf-accent)",
  question: "var(--dpf-warning)",
  response: "var(--dpf-accent)",
  error: "var(--dpf-danger)",
  lifecycle: "var(--dpf-border)",
};

const ACTOR_LABEL = { agent: "AI coworker", human: "You", system: "System" } as const;

function mergeEntries(
  current: WorkCapsuleActivityStreamEntry[],
  incoming: WorkCapsuleActivityStreamEntry[],
): WorkCapsuleActivityStreamEntry[] {
  const byId = new Map<string, WorkCapsuleActivityStreamEntry>();
  for (const entry of [...incoming, ...current]) {
    byId.set(entry.id, entry);
  }
  return Array.from(byId.values()).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

function parseStreamPayload(raw: string):
  | { type: "snapshot"; entries: WorkCapsuleActivityStreamEntry[] }
  | { type: "activity"; entry: WorkCapsuleActivityStreamEntry }
  | null {
  try {
    const parsed = JSON.parse(raw) as {
      type?: unknown;
      entries?: unknown;
      entry?: unknown;
    };
    if (parsed.type === "snapshot" && Array.isArray(parsed.entries)) {
      return { type: "snapshot", entries: parsed.entries as WorkCapsuleActivityStreamEntry[] };
    }
    if (parsed.type === "activity" && parsed.entry && typeof parsed.entry === "object") {
      return { type: "activity", entry: parsed.entry as WorkCapsuleActivityStreamEntry };
    }
    return null;
  } catch {
    return null;
  }
}

export function AgentSessionFeedLive({
  capsuleId,
  initialEntries,
}: {
  capsuleId: string;
  initialEntries: WorkCapsuleActivityStreamEntry[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const streamUrl = useMemo(
    () => `/api/work-capsules/${encodeURIComponent(capsuleId)}/activity-stream`,
    [capsuleId],
  );

  useResilientEventSource(streamUrl, {
    onMessage: () => {},
    onNamed: {
      [WORK_CAPSULE_ACTIVITY_EVENT]: (event) => {
        const payload = parseStreamPayload(event.data);
        if (!payload) return;
        if (payload.type === "snapshot") {
          setEntries((current) => mergeEntries(current, payload.entries));
        } else {
          setEntries((current) => mergeEntries(current, [payload.entry]));
        }
      },
    },
  });

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Activity</h2>
        <span className="text-[11px] text-[var(--dpf-muted)]">Live</span>
      </div>
      {entries.length === 0 ? (
        <p className="m-0 text-xs text-[var(--dpf-muted)]">
          No activity yet — updates from whoever is working this item will appear here.
        </p>
      ) : (
        <ol className="m-0 list-none space-y-2 p-0">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: TONE_DOT[entry.tone] }}
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-[var(--dpf-text)]">{entry.label}</span>
                  <span className="text-[11px] text-[var(--dpf-muted)]">{ACTOR_LABEL[entry.actor]}</span>
                </div>
                <p className="m-0 text-sm text-[var(--dpf-text)]">{entry.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
