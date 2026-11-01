import { describe, expect, it, vi } from "vitest";

const { roomReader, actorResolver } = vi.hoisted(() => ({ roomReader: vi.fn(), actorResolver: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: roomReader } } }));
vi.mock("./handler-actor", () => ({ workCapsuleActor: actorResolver }));

import { workCapsulesPack } from "@/lib/mcp/packs/work-capsules-pack";
import { resolveCallConsequence } from "@/lib/tool-consequence";
import { resolveEscalation } from "@/lib/govern/authority/escalation-gate";

const epoch = "00000000-0000-4000-8000-000000000001";
const original = (value = "file.ts", owner = "principal-a") => ({ kind: "path", value, intent: "edit", recordedByPrincipalId: owner, releaseEpoch: epoch });

describe("delegated own-scope release", () => {
  it("classifies removing the caller's exact scope as ordinary, while delegation still decides escalation", async () => {
    const now = new Date("2026-10-14T03:00:00Z");
    actorResolver.mockResolvedValue({ userId: "user-a", agentId: "AGT-EXT-CODEX", principalId: "principal-a" });
    roomReader.mockResolvedValue({
      id: "row-own", capsuleId: "WC-OWN", status: "working", archivedAt: null,
      leaseHolderPrincipalId: "principal-a", leaseExpiresAt: new Date("2026-10-14T03:30:00Z"),
      scopeClaims: [{ kind: "path", value: "apps/web/lib/example.ts", intent: "edit",
        releaseEpoch: epoch, recordedByPrincipalId: "principal-a", recordedAt: now.toISOString() }],
    });
    const tool = workCapsulesPack.definitions.find(entry => entry.name === "release_workroom_scope")!;
    const result = await resolveCallConsequence(tool, {
      toolName: tool.name, userId: "user-a", now,
      context: { agentId: "AGT-EXT-CODEX", authSource: "oauth" },
      params: { capsuleId: "WC-OWN", expectedRoomId: "row-own", claims: [original("apps/web/lib/example.ts")] },
    });
    expect(result.consequence).toBeNull();
    const input = { action: { sideEffect: true, executionMode: "immediate" as const,
      consequence: result.consequence }, dataPolicy: { sensitivity: "internal" as const }, operatorRequiresApproval: true };
    expect(resolveEscalation({ ...input, steering: "connection-delegation" }).verdict).toBe("automated");
    expect(resolveEscalation({ ...input, steering: "none" }).verdict).toBe("human");
  });

  it.each([
    ["foreign claim", { scopeClaims: [{ kind: "path", value: "file.ts", intent: "edit", recordedAt: "2026-10-14T03:00:00Z", recordedByPrincipalId: "other", releaseEpoch: epoch }] }],
    ["unknown owner", { scopeClaims: [{ kind: "path", value: "file.ts", intent: "edit" }] }],
    ["foreign lease", { leaseHolderPrincipalId: "other" }],
    ["expired lease", { leaseExpiresAt: new Date("2026-10-14T02:59:00Z") }],
    ["archived room", { archivedAt: new Date("2026-10-14T02:59:00Z") }],
    ["terminal room", { status: "abandoned" }],
    ["unknown status", { status: "unrecognized" }],
  ])("keeps %s consequential", async (_label, overrides) => {
    actorResolver.mockResolvedValue({ userId: "user-a", agentId: "AGT-EXT-CODEX", principalId: "principal-a" });
    roomReader.mockResolvedValue({ id: "row-own", capsuleId: "WC-OWN", status: "working", archivedAt: null,
      leaseHolderPrincipalId: "principal-a", leaseExpiresAt: new Date("2026-10-14T03:30:00Z"),
      scopeClaims: [{ kind: "path", value: "file.ts", intent: "edit", recordedAt: "2026-10-14T03:00:00Z", recordedByPrincipalId: "principal-a", releaseEpoch: epoch }], ...overrides });
    const tool = workCapsulesPack.definitions.find(entry => entry.name === "release_workroom_scope")!;
    const result = await resolveCallConsequence(tool, { toolName: tool.name, userId: "user-a",
      context: { agentId: "AGT-EXT-CODEX", authSource: "oauth" }, now: new Date("2026-10-14T03:00:00Z"),
      params: { capsuleId: "WC-OWN", expectedRoomId: "row-own", claims: [original("file.ts", _label === "foreign claim" ? "other" : "principal-a")] } });
    expect(result.consequence).toBe("authority");
  });

  it("does not refine incomplete, cross-target or failed-read requests", async () => {
    actorResolver.mockResolvedValue({ userId: "user-a", agentId: "AGT-EXT-CODEX", principalId: "principal-a" });
    const tool = workCapsulesPack.definitions.find(entry => entry.name === "release_workroom_scope")!;
    for (const params of [ { capsuleId: "WC-OWN", claims: [] },
      { capsuleId: "WC-OWN", claims: [{ kind: "unrecognized", value: "file.ts" }] },
      { capsuleId: "WC-OWN", claims: [{ kind: "path", value: "file.ts" }], force: true },
      { capsuleId: "WC-OWN", claims: [{ kind: "path", value: "" }] },
    ]) {
      expect((await resolveCallConsequence(tool, { toolName: tool.name, userId: "user-a", params })).consequence).toBe("authority");
    }
    roomReader.mockResolvedValue(null);
    const call = { toolName: tool.name, userId: "user-a", params: { capsuleId: "WC-UNKNOWN", expectedRoomId: "row-own", claims: [original()] } };
    expect((await resolveCallConsequence(tool, call)).consequence).toBe("authority");
    roomReader.mockRejectedValueOnce(new Error("unavailable"));
    expect(await resolveCallConsequence(tool, call)).toEqual({ consequence: "authority",
      refinement: { declared: "authority", reason: "refinement-unavailable" } });
  });

  it("retains independent policy limits even when an effect is ordinary", async () => {
    const action = { sideEffect: true, executionMode: "immediate" as const, consequence: null };
    const input = { action, dataPolicy: { sensitivity: "internal" as const }, operatorRequiresApproval: true,
      steering: "connection-delegation" as const };
    expect(resolveEscalation({ ...input, proposeBoundary: true }).verdict).toBe("human");
    expect(resolveEscalation({ ...input, dataPolicy: { sensitivity: "restricted" } }).verdict).toBe("human");
    expect(resolveEscalation({ ...input, action: { ...action, workCaseConsequential: true } }).verdict).toBe("human");
    const handoff = workCapsulesPack.definitions.find(entry => entry.name === "reassign_workroom_executor")!;
    expect(handoff.consequence).toBe("authority");
    expect(handoff.consequenceForCall).toBeTypeOf("function");
    await expect(handoff.consequenceForCall!({ toolName: "reassign_workroom_executor", params: { capsuleId: "WC-LEGACY", toExecutorKind: "codex-desktop" }, userId: "user-1" })).resolves.toMatchObject({ consequence: "authority" });
  });
});
