import {
  AgentWorkLauncher,
  type AgentWorkLauncherTopic,
} from "@/components/agent/AgentWorkLauncher";

const EMPTY_PIPELINE_TOPICS: AgentWorkLauncherTopic[] = [
  {
    id: "qualify-engagements",
    label: "Find qualified pipeline",
    description: "Review engagement signals and shape the first opportunity candidates.",
    prompt:
      "Review the customer engagement and pipeline context for this route. Identify the strongest candidates to become qualified opportunities, list missing qualification facts, and propose the first opportunity records for approval.",
    contextSummary: "Uses the customer pipeline route and current CRM engagement state.",
    expectedNextStep: "A short qualification checklist and proposed opportunity records.",
  },
  {
    id: "starter-outreach",
    label: "Plan starter outreach",
    description: "Prepare the first buyer-facing follow-up for approved opportunities.",
    prompt:
      "Prepare a starter outreach plan for newly qualified opportunities. Include the next buyer question, proof to attach, and the approval checkpoint before anything is sent.",
    contextSummary: "Uses the empty pipeline route, engagement context, and sales process.",
    expectedNextStep: "A reviewable outreach plan with no automatic sending.",
  },
];

export function EmptyPipelineGuidance() {
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm font-medium text-[var(--dpf-text)]">No opportunities yet</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Turn qualified engagement signals into the first pipeline records.
        </p>
      </section>

      <AgentWorkLauncher
        agentName="Revenue Coworker"
        primaryActionLabel="Start guided pipeline work"
        routeContext="/customer/opportunities"
        topics={EMPTY_PIPELINE_TOPICS}
      />
    </div>
  );
}
