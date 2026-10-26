import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
const io = vi.hoisted(() => ({
    access: vi.fn(), assess: vi.fn(), lineage: vi.fn(), actor: vi.fn(), grants: vi.fn(), can: vi.fn()
}));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: io.access, resolveHumanWorkroomAccess: io.access }));
vi.mock("./bounded-handoff", () => ({ assessBoundedHandoff: io.assess, readBoundedHandoffLineage: io.lineage }));
vi.mock("./handler-actor", () => ({ workCapsuleActor: io.actor }));
vi.mock("@/lib/permissions", () => ({ can: io.can }));
vi.mock("@/lib/tak/agent-grants", async (original) => ({ ...await original<typeof import("@/lib/tak/agent-grants")>(), getAgentToolGrantsAsync: io.grants }));
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { loadWorkroomFailedHandoffRecovery } from "./workroom-failed-handoff-recovery.server";
const now = new Date("2026-10-20T12:00:00.000Z");
function fixture() {
    const command = {
        phase: "request", commandId: "original-failed-command", capsuleId: "WC-ORIGINAL", expectedLeaseHolderPrincipalId: "human", expectedExecutorKind: "codex-desktop", expectedExecutorRef: "source-chat", targetAgentId: "AGT-EXT-CODEX", toExecutorKind: "codex-desktop", toExecutorRef: "receiver-chat", handoffManifest: { nextAction: "Continue the same accepted source." }
    };
    const fingerprint = fingerprintCoworkerInput(command);
    const envelope = {
        id: "original-envelope", status: "failed", delegatingUserId: "owner", coworkerAgentId: "AGT-EXT-CODEX", threadId: "original-thread", manifestActionId: "reassign_workroom_executor", inputFingerprint: fingerprint, createdAt: new Date(now.getTime() - 60000), argsJson: { approvalBinding: {
                actingHumanUserId: "owner", actingAgentId: "AGT-EXT-CODEX", toolName: "reassign_workroom_executor", inputFingerprint: fingerprint, taskRunId: null, chainId: null, routeContext: null
            } }
    };
    const run = {
        id: "original-execution", envelopeId: envelope.id, userId: "owner", agentId: "AGT-EXT-CODEX", threadId: "original-thread", taskRunId: null, toolName: "reassign_workroom_executor", executionMode: "external-jsonrpc", createdAt: new Date(now.getTime() - 30000), durationMs: 1, parameters: command, success: false, result: {
            success: false, error: "handoff-transaction-required", message: "PRIVATE RAW HANDLER TEXT"
        }
    };
    const room = {
        id: "room-row", capsuleId: "WC-ORIGINAL", status: "blocked", executorKind: "codex-desktop", executorRef: "source-chat", leaseHolderPrincipalId: "human", leaseExpiresAt: new Date(now.getTime() + 60000)
    };
    const db = {
        workroom: { findUnique: vi.fn(async () => room) }, coworkerActionEnvelope: { findMany: vi.fn(async () => [envelope]) }, toolExecution: { findMany: vi.fn(async () => [run]) }
    };
    const input = {
        workroomRowId: room.id, userId: "owner", now, context: {
            agentId: "AGT-EXT-CODEX", authSource: "oauth", apiTokenId: "own-token", tokenScope: "write", tokenGrantScopes: ["work_capsule_write"], userContext: { userId: "owner" }, governedRoomAuthority: () => null
        }
    };
    return {
        command, envelope, run, room, db, input, read: () => loadWorkroomFailedHandoffRecovery(input as never, db as never)
    };
}
beforeEach(() => { vi.clearAllMocks(); io.access.mockResolvedValue({ decision: { level: "content" }, authorityContext: { humanPrincipal: { id: "human" }, agentPrincipal: { id: "assistant" } } }); io.assess.mockResolvedValue({}); io.lineage.mockResolvedValue(null); io.actor.mockResolvedValue({
    userId: "owner", agentId: "AGT-EXT-CODEX", principalId: "human", agentPrincipalId: "assistant"
}); io.grants.mockResolvedValue(["work_capsule_write"]); io.can.mockReturnValue(true); });
describe("current-authority recovery of an original failed bounded handoff", () => {
    it("names the bound source assistant and prepares a fresh normal request without replaying the failed command", async () => {
        const f = fixture();
        const result = await f.read();
        expect(result).toMatchObject({
            state: "ready", owner: {
                userId: "owner", agentId: "AGT-EXT-CODEX", executorRef: "source-chat"
            }, original: { envelopeId: "original-envelope", executionId: "original-execution" }, action: { toolName: "reassign_workroom_executor", args: {
                    phase: "request", capsuleId: "WC-ORIGINAL", toExecutorRef: "receiver-chat"
                } }
        });
        expect(result?.action?.args.commandId).not.toBe(f.command.commandId);
        expect(io.assess).toHaveBeenCalledWith(expect.objectContaining({ actor: expect.objectContaining({ agentId: "AGT-EXT-CODEX" }), command: expect.objectContaining({ expectedExecutorRef: "source-chat" }) }));
        expect(JSON.stringify(result)).not.toContain("PRIVATE RAW");
        expect(JSON.stringify(result)).not.toContain("approvalBinding");
    });
    it("permits a human observer to see proven responsibility but never impersonates its source assistant", async () => {
        const f = fixture();
        f.input.context = undefined as never;
        expect(await f.read()).toMatchObject({
            state: "blocked", owner: { agentId: "AGT-EXT-CODEX" }, reason: "authenticated-source-assistant-required", action: null
        });
        expect(io.actor).not.toHaveBeenCalled();
        expect(io.assess).not.toHaveBeenCalled();
    });
    it("checks current exact-room content admission before querying failure history", async () => {
        const f = fixture();
        io.access.mockResolvedValue({ decision: { level: "discover" } });
        expect(await f.read()).toBeNull();
        expect(f.db.coworkerActionEnvelope.findMany).not.toHaveBeenCalled();
        expect(f.db.toolExecution.findMany).not.toHaveBeenCalled();
    });
    it.each(["fingerprint", "actor", "room", "ambiguous", "success", "legacy"])("withholds unproven original %s", async (kind) => {
        const f = fixture();
        if (kind === "fingerprint")
            f.run.parameters = { ...f.command, toExecutorRef: "changed" };
        if (kind === "actor")
            f.run.agentId = "foreign";
        if (kind === "room")
            f.run.parameters.capsuleId = "WC-FOREIGN";
        if (kind === "ambiguous")
            f.db.coworkerActionEnvelope.findMany.mockResolvedValue([f.envelope, f.envelope]);
        if (kind === "success")
            f.run.success = true;
        if (kind === "legacy")
            delete (f.run.parameters as Partial<typeof f.command>).phase;
        const result = await f.read();
        expect(result?.action ?? null).toBeNull();
        expect(io.assess).not.toHaveBeenCalled();
    });
    it.each(["read-token", "foreign-assistant", "agent-grant", "token-grant", "human-capability", "room-boundary"])("withholds action after %s refusal", async (kind) => {
        const f = fixture();
        if (kind === "read-token")
            f.input.context.tokenScope = "read";
        if (kind === "foreign-assistant")
            f.input.context.agentId = "AGT-EXT-GROK";
        if (kind === "agent-grant")
            io.grants.mockResolvedValue([]);
        if (kind === "token-grant")
            f.input.context.tokenGrantScopes = [];
        if (kind === "human-capability")
            io.can.mockReturnValue(false);
        if (kind === "room-boundary")
            f.input.context.governedRoomAuthority = () => ({ authorizedGrants: [] } as never);
        expect((await f.read())?.action ?? null).toBeNull();
        expect(io.assess).not.toHaveBeenCalled();
    });
    it("keeps a changed source historical without offering a stale retry", async () => { const f = fixture(); f.room.executorRef = "another-chat"; expect(await f.read()).toMatchObject({
        state: "blocked", reason: "handoff-source-changed", action: null
    }); expect(io.assess).not.toHaveBeenCalled(); });
    it("withholds all action on an unavailable dependency check without exposing raw errors", async () => { const f = fixture(); io.assess.mockRejectedValue(new Error("PRIVATE DATABASE DETAILS")); const result = await f.read(); expect(result).toMatchObject({
        state: "blocked", reason: "handoff-verification-unavailable", action: null
    }); expect(JSON.stringify(result)).not.toContain("PRIVATE"); });
    it("resolves an original refusal only through the validated subsequent completion and actual current destination", async () => {
        const f = fixture();
        f.room.executorRef = "receiver-chat";
        io.lineage.mockResolvedValue({
            state: "completed", requestId: "real-later-request", activityId: "canonical-completion", recordedAt: now.toISOString(), fromExecutorKind: "codex-desktop", fromExecutorRef: "source-chat", toExecutorKind: "codex-desktop", toExecutorRef: "receiver-chat", receivingAgentId: "AGT-EXT-CODEX"
        });
        expect(await f.read()).toMatchObject({
            state: "resolved", resolution: { requestId: "real-later-request", activityId: "canonical-completion" }, action: null
        });
        expect(io.assess).not.toHaveBeenCalled();
        expect(f.envelope.status).toBe("failed");
    });
});
it("waits on the actual receipted pending request instead of preparing another one", async () => { const f = fixture(); io.lineage.mockResolvedValue({
    state: "pending", requestId: "real-pending-request", requestDigest: "a".repeat(64), receiverRef: "receiver-chat"
}); expect(await f.read()).toMatchObject({
    state: "waiting", pending: { requestId: "real-pending-request", receiverRef: "receiver-chat" }, action: null
}); expect(io.assess).not.toHaveBeenCalled(); });
it("does not treat unreadable or conflicting lineage as no existing request", async () => { const f = fixture(); io.lineage.mockRejectedValue(new Error("PRIVATE LINEAGE DETAILS")); const result = await f.read(); expect(result).toMatchObject({
    state: "unavailable", reason: "handoff-lineage-unavailable", action: null
}); expect(io.assess).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("PRIVATE"); });
it("constructs the preview actor from canonical access without identity synchronization", async () => { const f = fixture(); expect(await f.read()).toMatchObject({ state: "ready" }); expect(io.actor).not.toHaveBeenCalled(); expect(io.assess).toHaveBeenCalledWith(expect.objectContaining({ actor: {
        userId: "owner", agentId: "AGT-EXT-CODEX", principalId: "human", agentPrincipalId: "assistant", taskAuthorityTokenId: "own-token"
    } })); });
it("withholds a candidate when content admission has no canonical actor IDs", async () => { const f = fixture(); io.access.mockResolvedValue({ decision: { level: "content" } }); expect(await f.read()).toMatchObject({ action: null, reason: "handoff-canonical-identity-unavailable" }); expect(io.actor).not.toHaveBeenCalled(); expect(io.assess).not.toHaveBeenCalled(); });

it("prepares a fresh assessed packet after a proven stale lease without replaying the old request",async()=>{const f=fixture();f.room.leaseExpiresAt=new Date(now.getTime()+120000);io.lineage.mockResolvedValue({state:"stale",requestId:"old-real-request",reason:"handoff-lease-snapshot-changed"});const result=await f.read();expect(result).toMatchObject({state:"ready",staleRequest:{requestId:"old-real-request"},action:{args:{expectedLeaseHolderPrincipalId:"human",expectedExecutorRef:"source-chat"},requiresExecutionRecheck:true}});expect(result?.action?.args.commandId).not.toBe(f.command.commandId);expect(result?.action?.args).not.toHaveProperty("expectedLeaseExpiresAt");expect(io.assess).toHaveBeenCalledWith(expect.objectContaining({db:f.db,command:result?.action?.args}));expect(io.actor).not.toHaveBeenCalled();});

it("passes only the actual canonical OAuth source into current pending-boundary assessment",async()=>{const f=fixture();io.lineage.mockResolvedValue({state:"stale",reason:"handoff-boundary-changed",requestId:"old-protected-request"});expect(await f.read()).toMatchObject({state:"ready",staleRequest:{requestId:"old-protected-request",reason:"handoff-boundary-changed"}});expect(io.lineage).toHaveBeenCalledWith(f.db,expect.objectContaining({capsuleId:"WC-ORIGINAL"}),expect.objectContaining({approvalId:"original-envelope"}),{actor:{userId:"owner",agentId:"AGT-EXT-CODEX",principalId:"human",agentPrincipalId:"assistant",taskAuthorityTokenId:"own-token"}});});
it("does not synthesize an assistant when a human reads pending history",async()=>{const f=fixture();f.input.context=undefined as never;io.lineage.mockResolvedValue({state:"pending",requestId:"real-request",requestDigest:"a".repeat(64),receiverRef:"receiver-chat"});expect(await f.read()).toMatchObject({state:"waiting",action:null});expect(io.lineage).toHaveBeenCalledWith(f.db,expect.anything(),expect.anything(),{actor:undefined});expect(io.assess).not.toHaveBeenCalled();expect(io.actor).not.toHaveBeenCalled();});
