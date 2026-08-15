// BI-C41AB195: render a Workroom's activity rows as a teammate "agent session"
// feed — what an AI coworker (or peer) is doing on the work item, in plain
// language. Typed agent activities (thought/action/question/response/error) read
// prominently; lifecycle plumbing is muted context.

import {
  presentAgentSession,
  type CapsuleActivityRow,
  type AgentSessionTone,
} from "@/lib/work-capsules/agent-activity-presenter";

const TONE_DOT: Record<AgentSessionTone, string> = {
  thought: "var(--dpf-muted)",
  action: "var(--dpf-accent)",
  question: "var(--dpf-warning)",
  response: "var(--dpf-accent)",
  error: "var(--dpf-danger)",
  lifecycle: "var(--dpf-border)",
};

const ACTOR_LABEL = { agent: "AI coworker", human: "You", system: "System" } as const;

export function AgentSessionFeed({ activities }: { activities: CapsuleActivityRow[] }) {
  const entries = presentAgentSession(activities);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Activity</h2>
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
