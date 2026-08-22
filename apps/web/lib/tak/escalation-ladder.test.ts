import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ESCALATION_LADDER_BLOCK,
  UNESCALATED_FILE_OFFER,
  classifyLadderActivity,
  applyEscalationLadderGuard,
  ESCALATION_RUNGS,
  buildHumanHandoff,
} from "./escalation-ladder";

const ok = (name: string) => ({ name, result: { success: true, entityId: "BI-FBDF739F" } });
const failed = (name: string) => ({ name, result: { success: false, error: "denied" } });

afterEach(() => vi.restoreAllMocks());

describe("classifyLadderActivity", () => {
  it("flags the observed failure: filed a BI with no peer attempt", () => {
    // The BI-FBDF739F turn — a delivery-process coworker answered a platform
    // deploy failure by filing, never calling find_coworker/request_coworker.
    const activity = classifyLadderActivity([ok("create_backlog_item")]);
    expect(activity.filed).toBe(true);
    expect(activity.attemptedRungs).toEqual([]);
    expect(activity.filedWithoutEscalating).toBe(true);
  });

  it("does not flag a file that followed a re-route attempt", () => {
    const activity = classifyLadderActivity([
      ok("find_coworker"),
      ok("create_backlog_item"),
    ]);
    expect(activity.attemptedRungs).toEqual(["reroute"]);
    expect(activity.filedWithoutEscalating).toBe(false);
  });

  it("counts a DENIED handoff as an attempt — the coworker still tried the peer door", () => {
    const activity = classifyLadderActivity([
      failed("request_coworker"),
      ok("create_backlog_item"),
    ]);
    expect(activity.attemptedRungs).toEqual(["consult"]);
    expect(activity.filedWithoutEscalating).toBe(false);
  });

  it("does not treat an UNSUCCESSFUL create as a filed dead end", () => {
    const activity = classifyLadderActivity([failed("create_backlog_item")]);
    expect(activity.filed).toBe(false);
    expect(activity.filedWithoutEscalating).toBe(false);
  });

  it("reports attempted rungs in ladder order regardless of call order", () => {
    const activity = classifyLadderActivity([
      ok("summon_coworker"),
      ok("find_coworker"),
      ok("request_coworker"),
    ]);
    expect(activity.attemptedRungs).toEqual(["reroute", "consult", "convene"]);
  });

  it("treats work-room tools as the convene rung", () => {
    for (const tool of ["invite_room_participant", "post_room_message", "spawn_work_thread"]) {
      expect(classifyLadderActivity([ok(tool)]).attemptedRungs).toEqual(["convene"]);
    }
  });

  it("ignores unrelated tools", () => {
    const activity = classifyLadderActivity([ok("query_backlog"), ok("search_knowledge")]);
    expect(activity.attemptedRungs).toEqual([]);
    expect(activity.filed).toBe(false);
  });
});

describe("applyEscalationLadderGuard", () => {
  it("offers escalation instead of leaving the user with a dead-end id", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = applyEscalationLadderGuard("I've logged this as BI-FBDF739F.", [
      ok("create_backlog_item"),
    ]);
    expect(out).toContain(UNESCALATED_FILE_OFFER);
  });

  it("does NOT scold the user — the appended text is an offer, not a correction", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = applyEscalationLadderGuard("Logged it.", [ok("create_backlog_item")]);
    expect(out).not.toMatch(/correction|should have|failed to/i);
  });

  it("leaves content untouched when the ladder was worked", () => {
    const content = "I've asked our platform engineer to pick this up.";
    expect(
      applyEscalationLadderGuard(content, [ok("find_coworker"), ok("create_backlog_item")]),
    ).toBe(content);
  });

  it("leaves content untouched when nothing was filed", () => {
    const content = "Here's what the page shows.";
    expect(applyEscalationLadderGuard(content, [])).toBe(content);
  });

  it("is idempotent across the loop's multiple return points", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tools = [ok("create_backlog_item")];
    const once = applyEscalationLadderGuard("Logged it.", tools);
    expect(applyEscalationLadderGuard(once, tools)).toBe(once);
  });
});

describe("ESCALATION_LADDER_BLOCK", () => {
  it("names every peer door so no coworker is left with filing as its only rung", () => {
    for (const tool of ["find_coworker", "request_coworker", "summon_coworker"]) {
      expect(ESCALATION_LADDER_BLOCK).toContain(tool);
    }
  });

  it("states that filing is last, not first", () => {
    expect(ESCALATION_LADDER_BLOCK).toMatch(/LAST rung, not the first/);
  });

  it("keeps operating-principle 5 intact — peers are described to users by role, not id", () => {
    expect(ESCALATION_LADDER_BLOCK).toMatch(/never a tool name or an internal id/);
  });
});

describe("rung 4 — hand off to the human (BI-33F1EA72)", () => {
  it("tells coworkers not to route or file a blocker only a person can clear", () => {
    expect(ESCALATION_LADDER_BLOCK).toMatch(/HAND OFF/);
    expect(ESCALATION_LADDER_BLOCK).toMatch(/do not route it and do not file it/);
  });

  it("keeps FILE as the last rung after the hand-off is inserted", () => {
    const handoffAt = ESCALATION_LADDER_BLOCK.indexOf("HAND OFF");
    const fileAt = ESCALATION_LADDER_BLOCK.indexOf("FILE —");
    expect(handoffAt).toBeGreaterThan(-1);
    expect(fileAt).toBeGreaterThan(handoffAt);
  });

  it("does NOT count a hand-off as a peer attempt", () => {
    // The guard exists to catch "filed without asking a colleague". A hand-off
    // involves the human, so counting it here would let a coworker satisfy the
    // guard by telling the user to fix it themselves and filing anyway.
    expect(ESCALATION_RUNGS).not.toContain("handoff");
  });

  it("renders the blocker, numbered steps, and what gets re-checked", () => {
    const message = buildHumanHandoff({
      blocker: "I can't sign in to the billing portal from here.",
      steps: ["Open the billing portal.", "Approve the pending access request."],
      verify: "retry the sync",
    });

    expect(message).toContain("I can't sign in to the billing portal from here.");
    expect(message).toContain("1. Open the billing portal.");
    expect(message).toContain("2. Approve the pending access request.");
    expect(message).toContain("I'll retry the sync");
  });

  it("never ends on the limitation — the last line hands the work back", () => {
    // The failure this rung exists to fix: naming what could not be done and
    // stopping there. The closing line must be the resumption, not the blocker.
    const message = buildHumanHandoff({
      blocker: "Blocked.",
      steps: ["Do the thing."],
      verify: "check it took",
    });

    const lastLine = message.trimEnd().split("\n").pop() ?? "";
    expect(lastLine).toMatch(/pick this straight back up/);
    expect(lastLine).not.toMatch(/^Blocked\.$/);
  });
});
