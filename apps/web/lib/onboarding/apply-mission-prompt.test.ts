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

describe("applyMissionPrompt", () => {
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
