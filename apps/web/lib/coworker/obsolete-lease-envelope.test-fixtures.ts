import { fingerprintCoworkerInput, fingerprintCoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import type { ObsoleteReleaseEnvelope, ObsoleteReleaseTarget } from "./obsolete-lease-envelope";

export const OBSOLETE_NOW = new Date("2026-11-01T04:00:00Z");
export function obsoleteEnvelope(id = "approval"): ObsoleteReleaseEnvelope {
  const params = { leaseId: "NPEL-unused", ownerSessionId: "this-session" };
  const binding = { actingHumanUserId: "person", actingAgentId: "assistant", chainId: null,
    taskRunId: null, toolName: "release_nonprod_environment_lease", subject: null,
    routeContext: null, inputFingerprint: fingerprintCoworkerInput(params),
    sensitivity: "internal" as const, decisionVersionFingerprint: "policy-version" };
  return { id, status: "proposed", resolvedAt: null, taskRunId: null,
    manifestActionId: binding.toolName, delegatingUserId: "person", coworkerAgentId: "assistant",
    argsJson: { approvalBinding: binding }, inputFingerprint: binding.inputFingerprint,
    approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding),
    toolExecutions: [{ envelopeId: id, agentId: "assistant", taskRunId: null,
      toolName: binding.toolName, userId: "person", parameters: params, success: false,
      result: { success: false, error: "approval_required", data: { envelopeId: id } } }] };
}
export function obsoleteTarget(): ObsoleteReleaseTarget {
  return { leaseId: "NPEL-unused", ownerSessionId: "this-session", environmentKey: "local-integration-ci",
    status: "cancelled", releasedAt: OBSOLETE_NOW, admittedAt: null, activeKey: null, slotKey: null,
    ownerPid: null, ownerProcessIdentity: null, cleanupCommand: null, resourceClass: null,
    expectedMemoryBytes: null, slotManifestVersion: 1 };
}
