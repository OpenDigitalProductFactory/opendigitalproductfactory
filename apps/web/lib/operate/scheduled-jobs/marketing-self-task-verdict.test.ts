// BI-DB179A8D — the marketing self-task's own prompt must not make a correct
// "keep the current brief" run a failure.
//
// The scheduler treats every side-effect tool a scheduled prompt NAMES as a
// write the run must make (classifyScheduledRequiredTools). The marketing
// prompt named create_marketing_campaign_brief and then told the coworker to
// stop when a brief was current, so a right decision was recorded as
// "required governed tool create_marketing_campaign_brief executed zero times"
// — live on the vendor install every day, beside 16 accumulated draft briefs.
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { classifyScheduledRequiredTools } from "@/lib/tak/scheduled-task-runs";
import { COWORKER_SELF_TASKS } from "./coworker-self-tasks";

const marketing = COWORKER_SELF_TASKS["marketing-specialist"]!;

// The marketing writes the coworker is granted (all side-effecting).
const AUTHORIZED = [
  "save_marketing_review",
  "create_marketing_campaign_brief",
  "create_marketing_asset_task",
  "draft_marketing_asset",
].map((name) => ({ name, sideEffect: true }));

const ok = (name: string) => ({ name, result: { success: true } });

describe("marketing self-task verdict (BI-DB179A8D)", () => {
  it("a run that reviews the plan and keeps the current brief is a success", () => {
    const outcome = classifyScheduledRequiredTools({
      prompt: marketing.prompt,
      authorizedTools: AUTHORIZED,
      executedTools: [ok("save_marketing_review")],
    });
    expect(outcome).toEqual({ kind: "executed" });
  });

  it("a run that records no decision at all is still a failure", () => {
    const outcome = classifyScheduledRequiredTools({
      prompt: marketing.prompt,
      authorizedTools: AUTHORIZED,
      executedTools: [],
    });
    expect(outcome).toEqual({ kind: "absent", toolName: "save_marketing_review" });
  });

  it("the cadence authorizes exactly the writes its prompt asks for", () => {
    expect([...(marketing.mandatedTools ?? [])].sort()).toEqual(
      ["create_marketing_asset_task", "create_marketing_campaign_brief", "draft_marketing_asset", "save_marketing_review"],
    );
  });
});
