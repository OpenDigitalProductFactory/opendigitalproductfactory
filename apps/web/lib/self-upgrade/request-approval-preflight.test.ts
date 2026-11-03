import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import { buildCoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { coworkerAuthorityInputFixture } from "@/test-support/coworker-authority-input-fixture";

const io = vi.hoisted(() => ({ read: vi.fn(), grants: vi.fn(), prior: vi.fn() }));
vi.mock("@/lib/coworker/authority-approval-envelope", () => ({ hasCurrentAuthorityApproval: io.prior }));
vi.mock("./request", () => ({ readSelfUpgradeAdmission: io.read }));
vi.mock("@/lib/tak/agent-grants", async original => ({ ...await original<object>(), getAgentToolGrantsAsync: io.grants }));
import { preflightUnadmittedUpgrade } from "./request-approval-preflight";

const execution = (): GovernedExecuteArgs => ({ toolName: "request_self_upgrade", rawParams: {}, userId: "user-1", userContext: { platformRole: "HR-000", isSuperuser: true }, source: "external-jsonrpc", context: { agentId: "AGT-100", apiTokenId: "TOKEN-1", tokenScope: "admin", tokenGrantScopes: ["release_plan_read"] } });
const binding = buildCoworkerApprovalBinding(coworkerAuthorityInputFixture());
const noUpdate = { kind: "terminal", result: { success: true, status: "batch_below_threshold", message: "2 updates; threshold 10.", pendingPrCount: 2 } };
beforeEach(() => { vi.clearAllMocks(); io.grants.mockResolvedValue(["release_plan_read"]); io.prior.mockResolvedValue(false); io.read.mockResolvedValue(noUpdate); });

describe("bounded extra queue observation", () => {
  it("leaves an existing bound approval or historical outcome on its original path", async () => {
    io.prior.mockResolvedValue(true);
    expect(await preflightUnadmittedUpgrade(execution(), binding)).toBeNull(); expect(io.read).not.toHaveBeenCalled();
  });
  it("retains the original path when existing approval metadata cannot be established", async () => {
    io.prior.mockRejectedValueOnce(new Error("unavailable"));
    expect(await preflightUnadmittedUpgrade(execution(), binding)).toBeNull(); expect(io.read).not.toHaveBeenCalled();
  });
  it("returns the existing terminal result with current read authority", async () => {
    expect(await preflightUnadmittedUpgrade(execution(), binding)).toMatchObject({ success: true, data: noUpdate.result });
    expect(io.read).toHaveBeenCalledOnce();
  });
  it.each([
    ["extra arguments", (e: GovernedExecuteArgs) => { e.rawParams.force = true; }],
    ["nonstring reason", (e: GovernedExecuteArgs) => { e.rawParams.reason = 42; }],
    ["another tool", (e: GovernedExecuteArgs) => { e.toolName = "repair_promoter_image"; }],
    ["missing coworker", (e: GovernedExecuteArgs) => { e.context = {}; }],
    ["missing human read capability", (e: GovernedExecuteArgs) => { e.userContext = { platformRole: null, isSuperuser: false }; }],
    ["token without read scope", (e: GovernedExecuteArgs) => { e.context!.tokenGrantScopes = ["backlog_read"]; }],
    ["token without declared scopes", (e: GovernedExecuteArgs) => { delete e.context!.tokenGrantScopes; }],
  ])("does not read the admission state for %s", async (_name, mutate) => {
    const e = execution(); mutate(e);
    expect(await preflightUnadmittedUpgrade(e, binding)).toBeNull(); expect(io.read).not.toHaveBeenCalled();
  });
  it("does not let an originating token widen the coworker's current grants", async () => {
    io.grants.mockResolvedValue(["backlog_read"]);
    expect(await preflightUnadmittedUpgrade(execution(), binding)).toBeNull(); expect(io.read).not.toHaveBeenCalled();
  });
  it.each(["already_active", "unsupported_install_mode", "human_override_required", "deferred_to_window", "queued"])("retains the original governed path for %s", async status => {
    io.read.mockResolvedValue({ kind: "terminal", result: { success: true, status } });
    expect(await preflightUnadmittedUpgrade(execution(), binding)).toBeNull();
  });
  it("retains the original path for eligible admission or unavailable observation", async () => {
    io.read.mockResolvedValueOnce({ kind: "ready" }).mockRejectedValueOnce(new Error("unavailable"));
    expect(await preflightUnadmittedUpgrade(execution(), binding)).toBeNull();
    expect(await preflightUnadmittedUpgrade(execution(), binding)).toBeNull();
  });
});
