import { describe, expect, it } from "vitest";
import { formatScheduledTurnPrompt, SCHEDULED_TURN_FIRST_ACTION } from "./scheduled-turn-prompt";

describe("formatScheduledTurnPrompt", () => {
  it("puts the first-action instruction ahead of the stored task", () => {
    const prompt = formatScheduledTurnPrompt("Refresh the brief", "Review the campaign.");
    expect(prompt.startsWith("[Scheduled task: Refresh the brief]")).toBe(true);
    expect(prompt).toContain(SCHEDULED_TURN_FIRST_ACTION);
    expect(prompt.endsWith("Review the campaign.")).toBe(true);
    expect(prompt.indexOf(SCHEDULED_TURN_FIRST_ACTION)).toBeLessThan(prompt.indexOf("Review the campaign."));
  });
});
