import { describe, expect, it, vi } from "vitest";
import {
  classifyShipRefusal,
  decideShipRefusalRemedy,
  parseShipRefusalRecord,
  remedyRefusedShipBuild,
  shipPrRetryIntervalMs,
  SHIP_REFUSAL_MAX_REMEDIES,
  SHIP_REFUSAL_REMEDY_TOOL,
  type ShipRefusalRecord,
  type ShipRefusalRemedyDeps,
} from "./ship-refusal-remedy";

const HOUR = 60 * 60 * 1000;

// Refusal texts as the live trail recorded them for FB-533EC6E2 (2026-11-12/13).
const STALE = "Pull request not opened; a publication guard refused: Nothing was published for `dpf/x`, because this change has not passed verification.\n\n- Verification has not passed for this exact change (3e2a53adbfa8). Run the checks on it before publishing";
const GUARDS = "Pull request not opened; a publication guard refused: Branch `dpf/x` is published and recoverable, but no pull request was opened.\n\n- Docs Impact Gate (2/2) failed locally: [docs-impact-gate] FAILED — a documented route | Convergence-Impact Gate failed locally: [convergence-impact-gate] FAILED";
const KILLED = "Pull request not opened; a publication guard refused: Branch `dpf/x` is published and recoverable, but no pull request was opened.\n\n- Exact published-tree readiness failed: Error: Sandbox command exited 137: ";
const PRIVATE = "Pull request not opened; a publication guard refused: This change is set to stay on your system, so it was not shared with the community.";
const DIVERGED = "Pull request not opened; a publication guard refused: Sandbox promotion blocked: source is not promotable. Sandbox source is diverged and requires pause";
const TESTS = "Pull request not opened; a publication guard refused: Nothing was published for `dpf/x`, because this change has not passed verification.\n\n- 2 test(s) failed.";

describe("classifyShipRefusal", () => {
  it("names each refusal the ship reconciler has met", () => {
    expect(classifyShipRefusal(STALE)).toEqual({ kind: "stale-verification" });
    expect(classifyShipRefusal(GUARDS)).toEqual({ kind: "guard-finding", failedGuards: ["Docs Impact Gate", "Convergence-Impact Gate"] });
    expect(classifyShipRefusal(KILLED)).toEqual({ kind: "infrastructure" });
    expect(classifyShipRefusal(PRIVATE)).toEqual({ kind: "policy-hold" });
    expect(classifyShipRefusal(DIVERGED)).toEqual({ kind: "behind-main" });
    expect(classifyShipRefusal(TESTS)).toEqual({ kind: "verification-failed" });
    expect(classifyShipRefusal("Pull request not opened; something nobody has seen")).toEqual({ kind: "unknown" });
  });

  it("treats a GitHub rate limit or an unreachable sandbox as infrastructure, not a defect", () => {
    expect(classifyShipRefusal("refused: API rate limit exceeded (403)").kind).toBe("infrastructure");
    expect(classifyShipRefusal("The sandbox is unavailable, so the change being published cannot be identified").kind).toBe("infrastructure");
  });
});

const rec = (kind: ShipRefusalRecord["kind"], action: ShipRefusalRecord["action"]): ShipRefusalRecord => ({ kind, action });

describe("decideShipRefusalRemedy", () => {
  it("re-verifies a stale or failed verification in review", () => {
    expect(decideShipRefusalRemedy({ kind: "stale-verification" }, [])).toEqual({ action: "return-to-review" });
    expect(decideShipRefusalRemedy({ kind: "verification-failed" }, [])).toEqual({ action: "return-to-review" });
  });

  it("refreshes a build behind main and hands a guard finding to repair", () => {
    expect(decideShipRefusalRemedy({ kind: "behind-main" }, [])).toEqual({ action: "refresh-from-main" });
    expect(decideShipRefusalRemedy({ kind: "guard-finding", failedGuards: ["Docs Impact Gate"] }, []))
      .toEqual({ action: "repair", failedGuards: ["Docs Impact Gate"] });
  });

  it("escalates once the remedies that move the build are spent", () => {
    const spent = Array.from({ length: SHIP_REFUSAL_MAX_REMEDIES }, () => rec("stale-verification", "return-to-review"));
    expect(decideShipRefusalRemedy({ kind: "guard-finding", failedGuards: ["X Gate"] }, spent).action).toBe("escalate");
  });

  it("backs infrastructure off and escalates it only after a long run", () => {
    expect(decideShipRefusalRemedy({ kind: "infrastructure" }, [])).toEqual({ action: "wait" });
    const run = Array.from({ length: 6 }, () => rec("infrastructure", "wait"));
    expect(decideShipRefusalRemedy({ kind: "infrastructure" }, run).action).toBe("escalate");
    // A different refusal in between resets the run.
    expect(decideShipRefusalRemedy({ kind: "infrastructure" }, [...run, rec("stale-verification", "return-to-review")]).action).toBe("wait");
  });

  it("waits on an owner's policy decision without ever escalating it", () => {
    const run = Array.from({ length: 30 }, () => rec("policy-hold", "wait"));
    expect(decideShipRefusalRemedy({ kind: "policy-hold" }, run)).toEqual({ action: "wait" });
  });

  it("gives an unknown refusal one more try, then escalates it", () => {
    expect(decideShipRefusalRemedy({ kind: "unknown" }, []).action).toBe("wait");
    expect(decideShipRefusalRemedy({ kind: "unknown" }, [rec("unknown", "wait")]).action).toBe("escalate");
  });
});

describe("shipPrRetryIntervalMs", () => {
  it("is hourly until refusals repeat, then doubles up to a day", () => {
    expect(shipPrRetryIntervalMs([])).toBe(HOUR);
    expect(shipPrRetryIntervalMs([rec("infrastructure", "wait")])).toBe(2 * HOUR);
    expect(shipPrRetryIntervalMs([rec("infrastructure", "wait"), rec("infrastructure", "wait")])).toBe(4 * HOUR);
    expect(shipPrRetryIntervalMs(Array.from({ length: 12 }, () => rec("policy-hold", "wait")))).toBe(24 * HOUR);
    // A remedy that moved the build starts the clock again.
    expect(shipPrRetryIntervalMs([rec("infrastructure", "wait"), rec("behind-main", "refresh-from-main")])).toBe(HOUR);
  });
});

describe("parseShipRefusalRecord", () => {
  it("reads back what the remedy step wrote, and nothing else", () => {
    expect(parseShipRefusalRecord("[stale-verification -> return-to-review] Verification…")).toEqual(rec("stale-verification", "return-to-review"));
    expect(parseShipRefusalRecord("[infrastructure -> wait] retry in 2h")).toEqual(rec("infrastructure", "wait"));
    expect(parseShipRefusalRecord("free text")).toBeNull();
  });
});

function deps(overrides: Partial<ShipRefusalRemedyDeps> = {}): ShipRefusalRemedyDeps {
  return {
    history: vi.fn(async () => []),
    lastRefusal: vi.fn(async () => ({ summary: STALE, at: new Date("2026-11-13T16:05:31Z") })),
    returnToReview: vi.fn(async () => true),
    queueReview: vi.fn(async () => {}),
    refreshFromMain: vi.fn(async () => true),
    routeToRepair: vi.fn(async () => "repair-queued"),
    escalate: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("remedyRefusedShipBuild", () => {
  it("returns a build whose current tree has no verification to review, and records why", async () => {
    const d = deps();
    await expect(remedyRefusedShipBuild("FB-1", d)).resolves.toBe("return-to-review");
    expect(d.returnToReview).toHaveBeenCalledWith("FB-1");
    expect(d.queueReview).toHaveBeenCalledWith("FB-1");
    expect(d.record).toHaveBeenCalledWith("FB-1", expect.stringMatching(/^\[stale-verification -> return-to-review\]/));
  });

  it("sends a guard finding to the coding agent with the guards named", async () => {
    const d = deps({ lastRefusal: vi.fn(async () => ({ summary: GUARDS, at: new Date() })) });
    await expect(remedyRefusedShipBuild("FB-1", d)).resolves.toBe("repair");
    expect(d.returnToReview).toHaveBeenCalledWith("FB-1");
    // The repair job returns the build to review itself; queueing here would race it.
    expect(d.queueReview).not.toHaveBeenCalled();
    expect(d.routeToRepair).toHaveBeenCalledWith("FB-1", ["Docs Impact Gate", "Convergence-Impact Gate"], expect.stringContaining("Docs Impact Gate"));
  });

  it("escalates once the bound is spent and does not touch the build again", async () => {
    const spent = Array.from({ length: SHIP_REFUSAL_MAX_REMEDIES }, () => rec("stale-verification", "return-to-review"));
    const d = deps({ history: vi.fn(async () => spent) });
    await expect(remedyRefusedShipBuild("FB-1", d)).resolves.toBe("escalate");
    expect(d.escalate).toHaveBeenCalledTimes(1);
    expect(d.returnToReview).not.toHaveBeenCalled();
  });

  it("does nothing when there is no refusal to act on", async () => {
    const d = deps({ lastRefusal: vi.fn(async () => null) });
    await expect(remedyRefusedShipBuild("FB-1", d)).resolves.toBe("none");
    expect(d.record).not.toHaveBeenCalled();
  });

  it("records a wait for infrastructure without moving the build", async () => {
    const d = deps({ lastRefusal: vi.fn(async () => ({ summary: KILLED, at: new Date() })) });
    await expect(remedyRefusedShipBuild("FB-1", d)).resolves.toBe("wait");
    expect(d.returnToReview).not.toHaveBeenCalled();
    expect(d.record).toHaveBeenCalledWith("FB-1", expect.stringMatching(/^\[infrastructure -> wait\]/));
  });

  it("uses the tool name the reconciler reads back", () => {
    expect(SHIP_REFUSAL_REMEDY_TOOL).toBe("ship_refusal_remedy");
  });
});
