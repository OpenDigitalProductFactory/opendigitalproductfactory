import { describe, expect, it, vi } from "vitest";
import { expireLapsedEnvelopes } from "./envelope-expiry";
import { fingerprintCoworkerInput, fingerprintCoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";

// BI-3C0F7A92: reproduce the actual cleanup used by the concierge on main.
// The window is still open; the action ceased to be needed for another reason.
describe("obsolete release approval lifecycle", () => {
  it("stops offering a fresh release request after its unused reservation is cancelled", async () => {
    const now = new Date("2026-11-01T04:00:00Z");
    const params = { leaseId: "NPEL-unused", ownerSessionId: "this-session" };
    const binding = { actingHumanUserId: "person", actingAgentId: "assistant", chainId: null,
      taskRunId: null, toolName: "release_nonprod_environment_lease", subject: null,
      routeContext: null, inputFingerprint: fingerprintCoworkerInput(params),
      sensitivity: "internal" as const, decisionVersionFingerprint: "policy-version" };
    const envelope = { id: "approval", status: "proposed", resolvedAt: null as Date | null,
      expiresAt: new Date(now.getTime() + 60_000), taskRunId: null,
      manifestActionId: binding.toolName, delegatingUserId: "person", coworkerAgentId: "assistant",
      argsJson: { approvalBinding: binding }, inputFingerprint: binding.inputFingerprint,
      approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding),
      toolExecutions: [{ toolName: binding.toolName, userId: "person", parameters: params }] };
    const db = {
      coworkerActionEnvelope: {
        findMany: vi.fn(async ({ where }: { where: { expiresAt?: unknown } }) => where.expiresAt && envelope.expiresAt > now ? [] : [envelope]),
        updateMany: vi.fn(async ({ data }: { data: object }) => { Object.assign(envelope, data); return { count: 1 }; }),
      },
      nonProductionEnvironmentLease: { findUnique: vi.fn(async () => ({
        leaseId: "NPEL-unused", ownerSessionId: "this-session", environmentKey: "local-integration-ci",
        status: "cancelled", releasedAt: now, admittedAt: null, activeKey: null, slotKey: null,
        ownerPid: null, ownerProcessIdentity: null, cleanupCommand: null, resourceClass: null,
        expectedMemoryBytes: null,
      })) },
      $executeRaw: vi.fn(async () => 1),
      $transaction: async <T,>(run: (tx: unknown) => Promise<T>): Promise<T> => run(db),
    };
    await expireLapsedEnvelopes(db, now);
    expect(envelope.status).toBe("cancelled");
  });
});
