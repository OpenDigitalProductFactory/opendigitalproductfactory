import { describe, expect, it, vi } from "vitest";
const currentAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/identity/load-effective-auth-context", () => ({ loadEffectiveAuthContext: currentAuth }));
import { contributionHivePack } from "./packs/contribution-hive-pack";
import { shouldProposeToolCall } from "@/lib/proactivity/propose-interception";
import { buildCoworkerApprovalBinding, evaluateCoworkerAuthority, type CoworkerAuthorityInput } from "@/lib/govern/authority/coworker-authority-decision";
import { deriveCoworkerApprovalPolicy, proposeBoundaryAuthority, resolveSteering, resolveCoworkerToolAuthorityInput } from "@/lib/govern/authority/resolve-coworker-tool-authority";

const tool = contributionHivePack.definitions.find(value => value.name === "propose_improvement")!;
function authority(policy: string | null = null, candidateImmediate = false): CoworkerAuthorityInput {
  return {
    authContext: {
      principalId: "human-principal", principalAliases: [], population: "workforce", platformRole: null,
      isSuperuser: false, employeeId: null, managerScope: { directReportIds: [], indirectReportIds: [] },
      teamIds: [], accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
      sensitivityClearance: ["public", "internal"], authentication: { source: "session", methods: [], contextClassReference: null },
      actingHumanUserId: "owner", actingAgentId: "assistant", delegationGrantIds: [], grantedCapabilities: [],
    },
    action: {
      toolName: tool.name, requiredCapability: tool.requiredCapability, agentGrantAllowed: true,
      sideEffect: tool.sideEffect === true, executionMode: candidateImmediate ? "immediate" : tool.executionMode ?? "immediate",
      routeContext: "/build", approvalPolicy: deriveCoworkerApprovalPolicy({ hitlTierDefault: 1, hitlPolicy: policy }),
      ...proposeBoundaryAuthority({}, policy), consequence: null,
    },
    steering: resolveSteering(Object.assign({ initiativeReviewBinding: null, roomAuthority: null, agentId: "assistant",
      connectionDelegation: { authorityBindingId: "current-consent", agentId: "assistant" } }, { hitlPolicy: policy })),
    subject: { kind: "platform", id: "dpf" }, delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: { sensitivity: "internal", maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true },
    task: null, rawParams: { title: "Learning", description: "Measured finding", category: "performance" },
  };
}

describe("real learning draft declaration through canonical authority", () => {
  it("completes an internal recommendation under current recorded delegation without a proposal boundary", () => {
    expect(evaluateCoworkerAuthority(authority())).toMatchObject({ outcome: "allow" });
    expect(shouldProposeToolCall(tool, true)).toBe(false);
    expect(tool.sideEffect).toBe(true);
  });
  it("preserves explicit always approval even for the candidate immediate draft under recorded delegation", () => {
    expect(evaluateCoworkerAuthority(authority("always", true))).toMatchObject({ outcome: "require-approval" });
  });
  it("keeps ordinary read behavior while preserving the current data and grant intersection", () => {
    const read = authority("always", true); read.action.sideEffect = false;
    expect(evaluateCoworkerAuthority(read)).toMatchObject({ outcome: "allow" });
    read.action.agentGrantAllowed = false;
    expect(evaluateCoworkerAuthority(read)).toMatchObject({ outcome: "deny", reasonCode: "agent-grant-denied" });
  });
  it("honors an exact current approval without accepting expired or changed input bindings", () => {
    const input = authority("always", true);
    input.approval = { envelopeId: "approved-draft", status: "approved", expiresAt: new Date(Date.now() + 60_000), binding: buildCoworkerApprovalBinding(input) };
    expect(evaluateCoworkerAuthority(input)).toMatchObject({ outcome: "allow" });
    const changed = { ...input, rawParams: { ...input.rawParams, description: "Different requested content" } };
    expect(evaluateCoworkerAuthority(changed)).toMatchObject({ outcome: "deny", reasonCode: "approval-binding-mismatch" });
    expect(evaluateCoworkerAuthority({ ...input, approval: { ...input.approval, expiresAt: new Date(0) } })).toMatchObject({ outcome: "deny", reasonCode: "approval-expired" });
    expect(evaluateCoworkerAuthority({ ...input, approval: { ...input.approval, status: "cancelled" } })).toMatchObject({ outcome: "deny", reasonCode: "approval-not-active" });
  });
  it("rereads the current policy through the real production resolver before each immediate write", async () => {
    currentAuth.mockResolvedValue(authority().authContext);
    let policy: string | null = null;
    const agent = vi.fn(async () => ({ id: "agent-row", agentId: "assistant", sensitivity: "internal", hitlTierDefault: 1,
      governanceProfile: policy === null ? null : { hitlPolicy: policy, updatedAt: new Date("2026-10-29T00:00:00Z") } }));
    const db = { agent: { findFirst: agent }, coworkerActionEnvelope: { findFirst: vi.fn().mockResolvedValue(null) } };
    const execution = { toolName: tool.name, rawParams: authority().rawParams, userId: "owner",
      userContext: { userId: "owner", platformRole: null, isSuperuser: true }, source: "agentic-loop" as const,
      context: { agentId: "assistant", routeContext: "/build", connectionDelegation: { authorityBindingId: "current-consent", agentId: "assistant" } } };
    const resolve = () => resolveCoworkerToolAuthorityInput({ execution, tool: { ...tool, executionMode: "immediate" }, agentGrantAllowed: true }, db as never);
    expect(evaluateCoworkerAuthority(await resolve())).toMatchObject({ outcome: "allow" });
    policy = "always";
    expect(evaluateCoworkerAuthority(await resolve())).toMatchObject({ outcome: "require-approval" });
    policy = null;
    expect(evaluateCoworkerAuthority(await resolve())).toMatchObject({ outcome: "allow" });
    expect(agent).toHaveBeenCalledTimes(3);
  });
  it("keeps grant, stale authority and restricted data refusals ahead of artifact classification", () => {
    const grant = authority(null, true); grant.action.agentGrantAllowed = false;
    expect(evaluateCoworkerAuthority(grant)).toMatchObject({ outcome: "deny", reasonCode: "agent-grant-denied" });
    const stale = authority(null, true); stale.dataPolicy.decisionVersionsCurrent = false;
    expect(evaluateCoworkerAuthority(stale)).toMatchObject({ outcome: "deny", reasonCode: "policy-version-stale" });
    const restricted = authority(null, true); restricted.dataPolicy.sensitivity = "restricted";
    expect(evaluateCoworkerAuthority(restricted)).toMatchObject({ outcome: "deny", reasonCode: "sensitivity-clearance-denied" });
  });
  it("retains review for outward, irreversible, authority and consequential real actions", () => {
    for (const consequence of ["outward", "irreversible", "authority"] as const) {
      const input = authority(null, true); input.action.consequence = consequence;
      expect(evaluateCoworkerAuthority(input)).toMatchObject({ outcome: "require-approval" });
    }
    const harmful = authority(null, true); harmful.action.workCaseConsequential = true;
    expect(evaluateCoworkerAuthority(harmful)).toMatchObject({ outcome: "require-approval" });
    for (const name of ["contribute_to_hive", "propose_skill_improvement"]) {
      expect(contributionHivePack.definitions.find(value => value.name === name)?.executionMode).toBe("proposal");
    }
  });
});
