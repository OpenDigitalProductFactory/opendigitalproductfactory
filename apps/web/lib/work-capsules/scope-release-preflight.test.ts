import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import * as preflight from "./scope-release-preflight";
import { commandPayloadBinding } from "./command-receipts";

const epoch = "00000000-0000-4000-8000-000000000001";
const target = { kind: "path", value: "a.ts", intent: "edit", recordedByPrincipalId: "owner", releaseEpoch: epoch };
const request = { capsuleId: "WC-TEST", expectedRoomId: "room-row", claims: [target] };
const stored = { success: true, message: "Original effect committed." };
function fixture() {
  const row = { id: "room-row", scopeClaims: [{ ...target, recordedAt: new Date().toISOString() }] };
  const activity = vi.fn(async (): Promise<unknown> => null);
  const findUnique = vi.fn(async () => row);
  const create = vi.fn();
  const tx = { $queryRaw: vi.fn(async () => [{ id: "room-row" }]), $executeRaw: vi.fn(async () => 0),
    workroom: { findUnique }, workroomActivity: { findFirst: activity, create } };
  const db = { ...tx, $transaction: async <T>(run: (client: typeof tx) => Promise<T>) => run(tx) };
  const approval = vi.fn(async (): Promise<{ envelopeId: string; status: "executed"; result: unknown } | null> => null);
  const execution = { toolName: "release_workroom_scope", rawParams: request,
    userId: "user", context: { agentId: "assistant" } } as unknown as GovernedExecuteArgs;
  const check = (params: Record<string, unknown> = request) => preflight.preflightOriginalScopeRelease(
    { ...execution, rawParams: params }, approval, db as never);
  return { row, activity, create, findUnique, approval, check };
}

beforeEach(() => vi.clearAllMocks());
describe("scope release before new escalation", () => {
  it("refuses legacy requests before receipt reads", async () => {
    const f = fixture();
    expect(await f.check({ capsuleId: "WC-TEST", claims: [{ kind: "path", value: "a.ts" }] })).toMatchObject({ outcome: "reject", rejection: "precondition_denied" });
    expect(f.approval).not.toHaveBeenCalled(); expect(f.activity).not.toHaveBeenCalled();
  });
  it("allows the original complete targets to reach their existing authority floor", async () => {
    expect(await fixture().check()).toBeNull();
  });
  it("refuses a changed target without creating an outcome", async () => {
    const f = fixture(); f.row.scopeClaims[0]!.releaseEpoch = "00000000-0000-4000-8000-000000000002";
    expect(await f.check()).toMatchObject({ outcome: "reject", rejection: "precondition_denied" });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("returns an exact settled approval before target-dependent refusal", async () => {
    const f = fixture(); f.row.scopeClaims = [];
    f.approval.mockResolvedValue({ envelopeId: "old-approval", status: "executed", result: stored });
    expect(await f.check()).toEqual({ outcome: "settled", envelopeId: "old-approval", status: "executed", result: stored });
    expect(f.findUnique).toHaveBeenCalledOnce(); expect(f.create).not.toHaveBeenCalled();
  });
  it("returns an exact bound command outcome without a replacement receipt", async () => {
    const f = fixture(); f.row.scopeClaims = [];
    f.activity.mockResolvedValue({ kind: "command-accepted", payload: { commandType: "release-scope", target: { kind: "workroom", id: request.capsuleId }, payloadBinding: commandPayloadBinding(request), result: stored } });
    expect(await f.check({ ...request, commandId: "cmd" })).toEqual({ outcome: "settled-command", result: stored });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("does not expose historical outcomes through a replacement persistent room", async () => {
    const f = fixture(); f.row.id = "restored-row";
    f.approval.mockResolvedValue({ envelopeId: "old-approval", status: "executed", result: stored });
    expect(await f.check()).toMatchObject({ outcome: "reject", rejection: "precondition_denied" });
    expect(f.approval).not.toHaveBeenCalled(); expect(f.activity).not.toHaveBeenCalled();
  });
  it("does not treat unreadable approval evidence as absence", async () => {
    const f = fixture(); f.approval.mockRejectedValue(new Error("unavailable"));
    expect(await f.check()).toMatchObject({ outcome: "reject", rejection: "authority_evidence_unavailable" });
    expect(f.findUnique).toHaveBeenCalledOnce();
  });
  it("does not rebind an unbound historical command", async () => {
    const f = fixture();
    f.activity.mockResolvedValue({ kind: "command-accepted", payload: { commandType: "release-scope", target: { kind: "workroom", id: request.capsuleId }, result: stored } });
    expect(await f.check({ ...request, commandId: "cmd" })).toMatchObject({ outcome: "reject", rejection: "precondition_denied" });
    expect(f.create).not.toHaveBeenCalled();
  });
});
