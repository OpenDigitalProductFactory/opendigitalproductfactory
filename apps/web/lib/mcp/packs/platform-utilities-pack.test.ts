import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  digitalProductCreate: vi.fn(),
  getFinancePeriodSummary: vi.fn(),
  formatFinancePeriodSummary: vi.fn(),
  driveBrowserTask: vi.fn(),
  isDestructiveBrowserAction: vi.fn(),
  runEmailSetupTool: vi.fn(),
  getPatchPosture: vi.fn(),
  inngestSend: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    digitalProduct: { create: (...a: unknown[]) => mocks.digitalProductCreate(...a) },
  },
}));
vi.mock("@/lib/finance/period-summary", () => ({
  getFinancePeriodSummary: (...a: unknown[]) => mocks.getFinancePeriodSummary(...a),
  formatFinancePeriodSummary: (...a: unknown[]) => mocks.formatFinancePeriodSummary(...a),
}));
vi.mock("@/lib/browser-drive/drive", () => ({
  driveBrowserTask: (...a: unknown[]) => mocks.driveBrowserTask(...a),
}));
vi.mock("@/lib/browser-drive/envelope", () => ({
  isDestructiveBrowserAction: (...a: unknown[]) => mocks.isDestructiveBrowserAction(...a),
}));
vi.mock("@/lib/shared/email-setup-tool", () => ({
  runEmailSetupTool: (...a: unknown[]) => mocks.runEmailSetupTool(...a),
}));
vi.mock("@/lib/patch/patch-posture", () => ({
  getPatchPosture: (...a: unknown[]) => mocks.getPatchPosture(...a),
}));
vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: (...a: unknown[]) => mocks.inngestSend(...a) },
}));

import { platformUtilitiesPack } from "./platform-utilities-pack";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

// The refuse probe is dispatch-only (test hook) and was never advertised, so it
// registers a handler but no definition.
const DEFINITION_TOOLS = [
  "create_digital_product",
  "get_finance_period_summary",
  "drive_browser_task",
  "setup_email",
  "list_patch_posture",
  "trigger_contributor_inventory_sync",
];
const HANDLER_TOOLS = [...DEFINITION_TOOLS, "dpf_test_kernel_refuse_probe"];

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.DPF_TEST_MCP_REFUSE_PROBE;
});

describe("platform-utilities pack — registration", () => {
  it("advertises the six utility definitions", () => {
    expect(platformUtilitiesPack.definitions.map((d) => d.name).sort()).toEqual([...DEFINITION_TOOLS].sort());
  });

  it("carries a handler for every advertised tool plus the dispatch-only refuse probe", () => {
    expect(Object.keys(platformUtilitiesPack.handlers).sort()).toEqual([...HANDLER_TOOLS].sort());
    for (const def of platformUtilitiesPack.definitions) {
      expect(platformUtilitiesPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("keeps the refuse probe out of the advertised definitions", () => {
    const names = platformUtilitiesPack.definitions.map((d) => d.name);
    expect(names).not.toContain("dpf_test_kernel_refuse_probe");
    expect(platformUtilitiesPack.handlers.dpf_test_kernel_refuse_probe).toBeTypeOf("function");
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of platformUtilitiesPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    // These tools carry no TOOL_TO_GRANTS entry — grants is empty, nothing to drift.
    expect(platformUtilitiesPack.grants).toEqual({});
    for (const [name, grants] of Object.entries(platformUtilitiesPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
  });
});

describe("platform-utilities pack — handler behavior (delegation preserved)", () => {
  it("create_digital_product persists the product and returns its id", async () => {
    mocks.digitalProductCreate.mockResolvedValue({ productId: "PROD-1" });
    const res = await platformUtilitiesPack.handlers.create_digital_product(
      { name: "Widget", productId: "PROD-1", lifecycleStage: "design" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("PROD-1");
    const arg = mocks.digitalProductCreate.mock.calls[0][0] as { data: { lifecycleStage: string; lifecycleStatus: string } };
    expect(arg.data.lifecycleStage).toBe("design");
    expect(arg.data.lifecycleStatus).toBe("draft");
  });

  it("setup_email delegates to the shared email setup tool and maps the result", async () => {
    mocks.runEmailSetupTool.mockResolvedValue({ ok: true, message: "detected", data: { provider: "google" } });
    const res = await platformUtilitiesPack.handlers.setup_email({ action: "detect" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("detected");
    expect(res.data).toEqual({ provider: "google" });
    expect(mocks.runEmailSetupTool).toHaveBeenCalledOnce();
  });

  it("get_finance_period_summary maps a delegation failure to a structured error", async () => {
    mocks.getFinancePeriodSummary.mockRejectedValue(new Error("no ledger"));
    const res = await platformUtilitiesPack.handlers.get_finance_period_summary({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("no ledger");
    expect(res.message).toContain("get_finance_period_summary failed");
  });

  it("drive_browser_task threads acting user + context into the drive call", async () => {
    mocks.isDestructiveBrowserAction.mockReturnValue(false);
    mocks.driveBrowserTask.mockResolvedValue({ status: "completed" });
    const res = await platformUtilitiesPack.handlers.drive_browser_task(
      { task: "fill form", siteKey: "substack", targetDomains: ["substack.com"] },
      "actor-5",
      { agentId: "AGT-9", threadId: "T-7" },
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("Browser task completed.");
    const arg = mocks.driveBrowserTask.mock.calls[0][0] as { userId: string; agentId: string; threadId: string };
    expect(arg.userId).toBe("actor-5");
    expect(arg.agentId).toBe("AGT-9");
    expect(arg.threadId).toBe("T-7");
  });

  it("trigger_contributor_inventory_sync dispatches the inngest event", async () => {
    mocks.inngestSend.mockResolvedValue({ ids: ["evt-1"] });
    const res = await platformUtilitiesPack.handlers.trigger_contributor_inventory_sync({ reason: "pushed" }, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ eventIds: ["evt-1"], status: "queued" });
    const arg = mocks.inngestSend.mock.calls[0][0] as { data: { triggeredBy: string } };
    expect(arg.data.triggeredBy).toBe("mcp:pushed");
  });

  it("dpf_test_kernel_refuse_probe returns the unregistered default when the env hook is off", async () => {
    const res = await platformUtilitiesPack.handlers.dpf_test_kernel_refuse_probe({}, "u1");
    expect(res.success).toBe(false);
    expect(res.message).toContain("tool not registered");
  });

  it("dpf_test_kernel_refuse_probe returns the probe body only when the env hook is on", async () => {
    process.env.DPF_TEST_MCP_REFUSE_PROBE = "1";
    const res = await platformUtilitiesPack.handlers.dpf_test_kernel_refuse_probe({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("probe tool body");
  });
});
