import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PipelineStageInspector } from "./PipelineStageInspector";
import type { PipelineInspectorView } from "@/lib/crm/pipeline-inspector";

const inspector: PipelineInspectorView = {
  id: "opp-1",
  opportunityId: "OPP-CODEX-001",
  title: "Modernize revenue workflow",
  account: { id: "acct-1", name: "Acme Ops" },
  contactLabel: "Bea Buyer",
  stage: "proposal",
  stageLabel: "Proposal",
  stageTone: "info",
  stageAgeDays: 20,
  stageAgeLabel: "20 days in stage",
  isStale: true,
  staleLabel: "Stale stage",
  probabilityLabel: "70%",
  expectedValueLabel: "£15,000",
  expectedCloseLabel: "10 Jun 2026",
  sourceEngagement: {
    id: "eng-1",
    label: "Website pricing inquiry",
    detail: "Qualified from web inquiry",
  },
  latestQuote: {
    id: "quote-1",
    quoteNumber: "QUO-2026-0004",
    statusLabel: "Sent",
    statusTone: "info",
    totalLabel: "£15,000",
  },
  recentActivities: [
    {
      id: "act-1",
      label: "Sent proposal",
      detail: "Email / 22 May 2026",
      body: "Proposal and pricing sent.",
    },
  ],
  stageExitCriteria: [
    "Quote or proposal sent",
    "Commercial owner identified",
    "Budget and timeline confirmed",
  ],
  suggestedNextAction: "Follow up on the sent quote and confirm the next buyer commitment.",
  aiTopics: [
    {
      id: "deal-summary",
      label: "Summarize deal",
      description: "Review account, activity, quote, and stage context.",
      prompt: "Summarize this deal.",
      contextSummary: "OPP-CODEX-001 at Proposal.",
      expectedNextStep: "A concise deal summary.",
    },
    {
      id: "follow-up-draft",
      label: "Draft follow-up",
      description: "Draft the next buyer-facing follow-up for approval.",
      prompt: "Draft a follow-up.",
      contextSummary: "Sent quote and latest activity.",
      expectedNextStep: "A draft that must be reviewed before sending.",
    },
  ],
};

describe("PipelineStageInspector", () => {
  it("renders the stage health, next action, source engagement, quote, and guided AI topics", () => {
    const html = renderToStaticMarkup(<PipelineStageInspector inspector={inspector} />);

    expect(html).toContain("Modernize revenue workflow");
    expect(html).toContain("20 days in stage");
    expect(html).toContain("Stale stage");
    expect(html).toContain("Follow up on the sent quote");
    expect(html).toContain("Website pricing inquiry");
    expect(html).toContain("QUO-2026-0004");
    expect(html).toContain("Stage exit criteria");
    expect(html).toContain("Summarize deal");
    expect(html).toContain("Draft follow-up");
  });

  it("uses theme-aware classes instead of raw colors", () => {
    const html = renderToStaticMarkup(<PipelineStageInspector inspector={inspector} />);

    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(html).toContain("var(--dpf-");
  });
});
