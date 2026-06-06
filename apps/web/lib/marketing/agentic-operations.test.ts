import { describe, expect, it } from "vitest";

import {
  EXTERNAL_MARKETING_SIDE_EFFECT_TOOLS,
  MARKETING_AGENTIC_OPERATIONS_ROUTE,
  buildMarketingAgenticOperationTopics,
} from "./agentic-operations";

const context = {
  marketFocus: "Focused on the United States",
  audienceFocus: "Founder operators",
  routeFocus: "Inbound",
  primaryChannels: "LinkedIn, Email",
  recommendedChannels: "LinkedIn, Email",
  skippedChannels: "Paid social",
  proofFocus: "Founder case study",
  kpiStack: "Qualified replies, demo requests",
  suggestions: [
    "Confirm the first audience before launching campaigns.",
    "Collect one proof asset before outbound work.",
  ],
};

describe("marketing agentic operations topics", () => {
  it("builds the Slice 5 guided-work topic set", () => {
    const topics = buildMarketingAgenticOperationTopics(context);

    expect(topics.map((topic) => topic.id)).toEqual([
      "signal-review",
      "campaign-brief",
      "automation-candidates",
      "integration-recommendations",
    ]);
    expect(topics.map((topic) => topic.label)).toEqual([
      "Signal review",
      "Campaign brief",
      "Automation candidates",
      "Integration fit",
    ]);
  });

  it("grounds prompts in current marketing context and governed internal artifact tools", () => {
    const topics = buildMarketingAgenticOperationTopics(context);
    const combinedPrompt = topics.map((topic) => topic.prompt).join("\n");

    expect(MARKETING_AGENTIC_OPERATIONS_ROUTE).toBe("/customer/marketing");
    expect(topics[0]?.contextSummary).toContain("Founder operators");
    expect(topics[1]?.contextSummary).toContain("LinkedIn, Email");
    expect(combinedPrompt).toContain("save_marketing_review");
    expect(combinedPrompt).toContain("create_marketing_campaign_brief");
    expect(combinedPrompt).toContain("create_marketing_asset_task");
    expect(combinedPrompt).toContain("record_marketing_kpi_checkpoint");
    expect(combinedPrompt).toContain("create_marketing_automation_candidate");
  });

  it("keeps external channel side effects out of launcher prompts", () => {
    const topics = buildMarketingAgenticOperationTopics(context);

    for (const topic of topics) {
      for (const toolName of EXTERNAL_MARKETING_SIDE_EFFECT_TOOLS) {
        expect(topic.prompt).not.toContain(toolName);
      }
      expect(topic.prompt).toContain("Do not publish, send, schedule, place ads, or change autopilot policy");
      expect(topic.expectedNextStep).not.toMatch(/publish|send|schedule|spend/i);
    }
  });
});
