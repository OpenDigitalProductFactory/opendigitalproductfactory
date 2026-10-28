import { describe, expect, it, vi } from "vitest";

import {
  applyMissionPrompt,
  renderMissionPromptContent,
  MISSION_PROMPT_CATEGORY,
  MISSION_PROMPT_SLUG,
  type ApplyMissionPromptClient,
} from "./apply-mission-prompt";

function makeDb() {
  const upsert = vi.fn<(args: unknown) => Promise<unknown>>(async () => ({}));
  const db: ApplyMissionPromptClient = { promptTemplate: { upsert } };
  return { db, upsert };
}

describe("renderMissionPromptContent", () => {
  it("bakes the captured mission into the Block-0 content", () => {
    const content = renderMissionPromptContent("  Help families breathe easier.  ");
    expect(content).toContain("Mission: Help families breathe easier.");
    expect(content).toContain("COMPANY MISSION CONTEXT");
    expect(content).not.toContain("[Your company mission");
  });
});

describe("renderMissionPromptContent with the direction (BI-8AB6B4F7 AC-1)", () => {
  it("lists the vision and the outcomes beside the mission", () => {
    const content = renderMissionPromptContent("Help families breathe easier.", {
      vision: "Every home has clean air.",
      outcomes: [
        { statement: "Fewer asthma visits", measure: "ER visits drop 20%" },
        { statement: "Trusted by landlords", measure: null },
      ],
    });
    expect(content).toContain("Vision: Every home has clean air.");
    expect(content).toContain("- Fewer asthma visits (how we'll know: ER visits drop 20%)");
    expect(content).toContain("- Trusted by landlords");
  });

  it("says outcomes are not recorded rather than inventing any", () => {
    const content = renderMissionPromptContent("M", { vision: null, outcomes: [] });
    expect(content).not.toContain("Vision:");
    expect(content).toContain("Top-level outcomes: not recorded yet");
  });
});

describe("applyMissionPrompt", () => {
  it("passes the direction through to Block 0 and marks who wrote it", async () => {
    const { db, upsert } = makeDb();
    await applyMissionPrompt({
      mission: "M",
      direction: { vision: "V", outcomes: [{ statement: "O", measure: null }] },
      updatedBy: "owner",
      db,
      invalidate: false,
    });
    const args = upsert.mock.calls[0][0] as any;
    expect(args.update.content).toContain("Vision: V");
    expect(args.update.updatedBy).toBe("owner");
  });

  it("upserts the global company-mission template with the mission", async () => {
    const { db, upsert } = makeDb();

    const result = await applyMissionPrompt({
      mission: "Help families breathe easier.",
      db,
      invalidate: false,
    });

    expect(result.applied).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0] as any;
    expect(args.where.category_slug).toEqual({
      category: MISSION_PROMPT_CATEGORY,
      slug: MISSION_PROMPT_SLUG,
    });
    expect(args.update.content).toContain("Help families breathe easier.");
    expect(args.update.isOverridden).toBe(true);
    expect(args.update.updatedBy).toBe("setup");
    expect(args.create.content).toContain("Help families breathe easier.");
  });

  it("is a no-op when the mission is blank", async () => {
    const { db, upsert } = makeDb();

    expect((await applyMissionPrompt({ mission: "", db, invalidate: false })).applied).toBe(false);
    expect((await applyMissionPrompt({ mission: "   ", db, invalidate: false })).applied).toBe(false);
    expect((await applyMissionPrompt({ mission: null, db, invalidate: false })).applied).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
