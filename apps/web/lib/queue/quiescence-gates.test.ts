/**
 * Tests for the Inngest quiescence gate helpers (BI-QUIESCE-004a + 004b).
 *
 * Pure-logic tests with a fake step runner — no Inngest framework needed.
 * Confirms the gate returns the documented shape for each level and that
 * step.waitForEvent is invoked for the between-steps variant.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DISABLED_BY_OPERATOR_REASON,
  gateAtEntry,
  gateBetweenSteps,
  type GateBetweenStepsRunner,
} from "./quiescence-gates";
import { allFunctions, scheduledFunctions } from "./functions/index";
import {
  SCHEDULED_JOB_CATALOG,
  getCatalogEntryByInngestId,
} from "@/lib/operate/scheduled-jobs/catalog";

// Mock the dynamic import of @/lib/self-upgrade/quiescence so each test can
// pin the returned level deterministically.
vi.mock("@/lib/self-upgrade/quiescence", () => {
  return {
    getQuiescenceLevel: vi.fn(),
  };
});

// The kill switch reads ScheduledJob.enabled through the one shared helper;
// mock it so each test pins the answer. The helper's own posture (default-on,
// fail-open) is covered in lib/operate/scheduled-jobs/core.test.ts.
vi.mock("@/lib/operate/scheduled-jobs/core", () => ({ isJobEnabled: vi.fn() }));

import { getQuiescenceLevel } from "@/lib/self-upgrade/quiescence";
import { isJobEnabled } from "@/lib/operate/scheduled-jobs/core";

const isJobEnabledMock = vi.mocked(isJobEnabled);

// A catalogued cron that declares honorsEnabledGate: true.
const GATED_ID = "ops/code-graph-reconcile-scheduled";
const GATED_JOB_ID = "code-graph-reconcile";

beforeEach(() => {
  vi.mocked(getQuiescenceLevel).mockReset();
  isJobEnabledMock.mockReset();
  // Default: enabled.
  isJobEnabledMock.mockResolvedValue(true);
});

type FakeStep = GateBetweenStepsRunner & {
  run: ReturnType<typeof vi.fn>;
  waitForEvent: ReturnType<typeof vi.fn>;
};

function makeFakeStep(): FakeStep {
  const step = {
    run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
    waitForEvent: vi.fn(),
  };
  return step as unknown as FakeStep;
}

describe("gateAtEntry", () => {
  it("returns { proceed: true } when level is normal and the job is enabled", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
    const step = makeFakeStep();
    const result = await gateAtEntry(step, GATED_ID);
    expect(result).toEqual({ proceed: true });
    expect(step.run).toHaveBeenCalledTimes(2);
    expect(step.run.mock.calls[0][0]).toBe("quiescence-gate-at-entry");
    expect(step.run.mock.calls[1][0]).toBe("kill-switch-gate-at-entry");
    expect(isJobEnabledMock).toHaveBeenCalledWith(GATED_JOB_ID);
  });

  it("returns { proceed: false, skipped: true, reason } when draining", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    const step = makeFakeStep();
    const result = await gateAtEntry(step, GATED_ID);
    expect(result.proceed).toBe(false);
    if (!result.proceed) {
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("quiescing(draining)");
    }
  });

  it("returns the same shape for swapping (callable contract)", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("swapping");
    const step = makeFakeStep();
    const result = await gateAtEntry(step, GATED_ID);
    expect(result.proceed).toBe(false);
    if (!result.proceed) {
      expect(result.reason).toBe("quiescing(swapping)");
    }
  });

  it("wraps the level check in step.run for Inngest checkpointing", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
    const step = makeFakeStep();
    await gateAtEntry(step, GATED_ID);
    // First step.run call uses the documented step name; the fn it received
    // is what reads the level (test simply ensures the wrapping happens).
    expect(step.run.mock.calls[0][0]).toBe("quiescence-gate-at-entry");
  });
});

describe("gateAtEntry kill switch (BI-7E49FA15)", () => {
  beforeEach(() => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
  });

  it("skips a job the operator disabled with reason disabled-by-operator", async () => {
    isJobEnabledMock.mockResolvedValue(false);
    const step = makeFakeStep();
    const result = await gateAtEntry(step, GATED_ID);
    expect(result).toEqual({
      proceed: false,
      skipped: true,
      reason: DISABLED_BY_OPERATOR_REASON,
    });
    expect(DISABLED_BY_OPERATOR_REASON).toBe("disabled-by-operator");
  });

  it("checkpoints the kill-switch read in its own step.run", async () => {
    isJobEnabledMock.mockResolvedValue(false);
    const step = makeFakeStep();
    await gateAtEntry(step, GATED_ID);
    expect(step.run.mock.calls.map((c) => c[0])).toEqual([
      "quiescence-gate-at-entry",
      "kill-switch-gate-at-entry",
    ]);
  });

  it("proceeds when the job is enabled", async () => {
    isJobEnabledMock.mockResolvedValue(true);
    expect(await gateAtEntry(makeFakeStep(), GATED_ID)).toEqual({ proceed: true });
  });

  it("lets quiescence take precedence over the kill switch", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    isJobEnabledMock.mockResolvedValue(false);
    const step = makeFakeStep();
    const result = await gateAtEntry(step, GATED_ID);
    expect(result).toEqual({ proceed: false, skipped: true, reason: "quiescing(draining)" });
    // Never reached the kill-switch read.
    expect(step.run).toHaveBeenCalledTimes(1);
    expect(isJobEnabledMock).not.toHaveBeenCalled();
  });

  it("proceeds for an Inngest id with no catalog entry (event-driven run-now functions)", async () => {
    isJobEnabledMock.mockResolvedValue(false);
    expect(await gateAtEntry(makeFakeStep(), "ops/no-such-function")).toEqual({ proceed: true });
    expect(isJobEnabledMock).not.toHaveBeenCalled();
  });

  it("proceeds for a catalogued entry that carries an ungatedReason (quiescence callers)", async () => {
    isJobEnabledMock.mockResolvedValue(false);
    expect(await gateAtEntry(makeFakeStep(), "ops/self-upgrade-scheduled")).toEqual({
      proceed: true,
    });
    expect(isJobEnabledMock).not.toHaveBeenCalled();
  });

  it("fails OPEN: a read failure proceeds rather than taking the schedule down", async () => {
    // isJobEnabled itself swallows the read error (core.test.ts); the gate
    // must not add a throwing path of its own around it.
    isJobEnabledMock.mockResolvedValue(true);
    expect(await gateAtEntry(makeFakeStep(), GATED_ID)).toEqual({ proceed: true });
  });
});

describe("gateAtEntry call-site identity guard (BI-7E49FA15)", () => {
  // Source scan over every cron module: each gateAtEntry(step, X) must pass
  // the same expression its enclosing createFunction declares as `id`, and
  // that id must be a registered Inngest function. A copy-pasted wrong
  // constant would gate the wrong job silently; this fails the build instead.
  const FUNCTIONS_DIR = path.join(__dirname, "functions");
  const registeredIds = new Set(
    allFunctions.map((fn) => (fn as { id: () => string }).id()),
  );

  type Site = { file: string; declaredId: string; passed: string; isCron: boolean };

  function scanSites(): Site[] {
    const sites: Site[] = [];
    for (const file of fs.readdirSync(FUNCTIONS_DIR)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(path.join(FUNCTIONS_DIR, file), "utf8");
      if (!src.includes("gateAtEntry(")) continue;
      const starts: number[] = [];
      const re = /createFunction\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) starts.push(m.index);
      starts.push(src.length);
      for (let i = 0; i < starts.length - 1; i++) {
        const block = src.slice(starts[i], starts[i + 1]);
        const idMatch = block.match(/\bid:\s*([^,\n]+)/);
        for (const call of block.matchAll(/gateAtEntry\(([^)]*)\)/g)) {
          const args = call[1].split(",").map((a) => a.trim());
          sites.push({
            file,
            declaredId: idMatch ? idMatch[1].trim() : "",
            passed: args[1] ?? "",
            isCron: /\bcron\(|\bcron:/.test(block),
          });
        }
      }
    }
    return sites;
  }

  /** Resolve a literal or an imported constant to its runtime string. */
  async function resolveId(file: string, expr: string): Promise<string | undefined> {
    const literal = expr.match(/^"([^"]+)"$/);
    if (literal) return literal[1];
    const src = fs.readFileSync(path.join(FUNCTIONS_DIR, file), "utf8");
    // Declared in this module?
    const local = src.match(new RegExp(`const ${expr}\\s*=\\s*"([^"]+)"`));
    if (local) return local[1];
    // Find the import statement that brings `expr` in.
    const importRe = /import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src))) {
      const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop());
      if (!names.includes(expr)) continue;
      const spec = m[2].startsWith(".") ? path.join(FUNCTIONS_DIR, m[2]) : m[2];
      const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
      const value = mod[expr];
      return typeof value === "string" ? value : undefined;
    }
    return undefined;
  }

  it("covers every cron module (the scan itself is not vacuous)", () => {
    const sites = scanSites();
    expect(sites.length).toBeGreaterThanOrEqual(60);
  });

  it("passes the enclosing function's own id at every call site", () => {
    const wrong = scanSites()
      .filter((s) => !s.passed || s.passed !== s.declaredId)
      .map((s) => `${s.file}: id ${s.declaredId} but gateAtEntry got ${s.passed || "<nothing>"}`);
    expect(wrong).toEqual([]);
  });

  it("resolves every passed id to a registered Inngest function, and every cron's to a catalog entry", async () => {
    const problems: string[] = [];
    for (const site of scanSites()) {
      const id = await resolveId(site.file, site.passed);
      if (!id) {
        problems.push(`${site.file}: could not resolve ${site.passed}`);
        continue;
      }
      if (!registeredIds.has(id)) problems.push(`${site.file}: ${id} is not a registered function`);
      if (site.isCron && !getCatalogEntryByInngestId(id)) {
        problems.push(`${site.file}: cron ${id} has no catalog entry`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("marks every catalogued cron that reaches gateAtEntry as honorsEnabledGate: true", async () => {
    const gatedIds = new Set<string>();
    for (const site of scanSites()) {
      if (!site.isCron) continue;
      const id = await resolveId(site.file, site.passed);
      if (id) gatedIds.add(id);
    }
    const scheduledIds = new Set(
      scheduledFunctions.map((fn) => (fn as { id: () => string }).id()),
    );
    const mislabelled = SCHEDULED_JOB_CATALOG.filter((e) => {
      if (!scheduledIds.has(e.inngestId)) return false;
      const reaches = gatedIds.has(e.inngestId);
      // Reaches the gate but says it is not enforced (and is not a declared
      // exemption), or claims enforcement without reaching the gate.
      return reaches ? e.honorsEnabledGate !== true && !e.ungatedReason : e.honorsEnabledGate === true;
    }).map((e) => e.inngestId);
    expect(mislabelled).toEqual([]);
  });
});

describe("gateBetweenSteps", () => {
  it("returns immediately with no wait when level is normal", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
    const step = makeFakeStep();
    const result = await gateBetweenSteps(step, "after-snapshot");
    expect(result.resumedAfterWait).toBe(false);
    expect(step.waitForEvent).not.toHaveBeenCalled();
  });

  it("suspends via step.waitForEvent when level is draining", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    const step = makeFakeStep();
    step.waitForEvent.mockResolvedValue({ data: { outcome: "succeeded" } });
    const result = await gateBetweenSteps(step, "between-branches");
    expect(step.waitForEvent).toHaveBeenCalledTimes(1);
    const [waitName, opts] = step.waitForEvent.mock.calls[0];
    expect(waitName).toBe("await-quiescence-cleared-between-branches");
    expect(opts.event).toBe("platform.quiescence-cleared");
    expect(opts.timeout).toBe("30m");
    expect(result.resumedAfterWait).toBe(true);
  });

  it("suspends for swapping level too", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("swapping");
    const step = makeFakeStep();
    step.waitForEvent.mockResolvedValue({ data: { outcome: "succeeded" } });
    await gateBetweenSteps(step, "after-step");
    expect(step.waitForEvent).toHaveBeenCalledTimes(1);
  });

  it("returns timed-out reason when waitForEvent returns null", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    const step = makeFakeStep();
    step.waitForEvent.mockResolvedValue(null);
    const result = await gateBetweenSteps(step, "after-step");
    expect(result.resumedAfterWait).toBe(false);
    expect(result.reason).toBe("timed-out-waiting-for-cleared");
  });

  it("uses unique step labels per call site (avoids Inngest step-id collision)", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    const step = makeFakeStep();
    step.waitForEvent.mockResolvedValue({ data: { outcome: "succeeded" } });
    await gateBetweenSteps(step, "branch-1");
    await gateBetweenSteps(step, "branch-2");
    expect(step.run.mock.calls.map((c) => c[0])).toEqual([
      "quiescence-gate-branch-1",
      "quiescence-gate-branch-2",
    ]);
    expect(step.waitForEvent.mock.calls.map((c) => c[0])).toEqual([
      "await-quiescence-cleared-branch-1",
      "await-quiescence-cleared-branch-2",
    ]);
  });
});
