import { describe, expect, it } from "vitest";
import { hydrateS5JsiSelector, s5LaunchProjectionSchema } from "@dpf/validators/workroom/s5-launch";
import fixture from "../../../../packages/validators/src/workroom/s5-launch.v1.coordination.fixture.json";
import type { S5AdmissionCeiling } from "./s5-admission.server";
import { projectS5Launch, type S5LaunchRouteFacts } from "./s5-launch-projection.server";

const launch = s5LaunchProjectionSchema.parse(fixture.launch);
if (launch.mode !== "read-only-coordination") throw new Error("Expected the v1 coordination fixture.");
const { issuer, audience, hostRef, workroomId, sessionRef, stageAttemptRef, caseKey, stageKey, subject, issuedAt, expiresAt } = launch;
const locator = { workroomId, sessionRef, stageAttemptRef };
const selector = hydrateS5JsiSelector(launch);
const admission: S5AdmissionCeiling = {
  kind: "composed", locator, issuer, subject, caseKey, stageKey, agentId: "AGT-FIXTURE", authorityBindingId: "binding-row",
  activityKey: selector.activityKey, job: selector.job, ...launch.authority, operationKeys: launch.permittedOperations,
  host: { mode: launch.mode, hostRef, receiverRef: audience, worktreeRef: null },
  jsi: { ...launch.jsi, selector, ceiling: { operationKeys: launch.permittedOperations, excludedOperationKeys: [], oversight: "review-before-effect" } },
};
const route: S5LaunchRouteFacts = { issuer, audience, hostRef, expiresAt, operationKeys: launch.permittedOperations, budget: launch.budget,
  metering: { kind: "verified", proofRef: "proof:fixture-cap-enforcement", expiresAt } };
const coordinationTarget = { caseKey, recipient: launch.coordination.recipient };
const input = { admission, route, issuedAt, permitExpiresAt: expiresAt, coordinationTarget };

describe("S5 launch projection adapter", () => {
  it("matches the published read-only fixture and carries no bearer, proof metadata or duplicated subject", () => {
    const result = projectS5Launch(input);
    expect(result).toEqual(launch);
    expect(result).not.toHaveProperty("authorityBindingId");
    expect(result).not.toHaveProperty("metering");
    expect(result).not.toHaveProperty("jsi.selector.subject");
  });

  it("can narrow to the actually supported wire and ends at the first authority deadline", () => {
    const result = projectS5Launch({ ...input, permitExpiresAt: issuedAt + 10,
      route: { ...route, operationKeys: ["post_room_message", "read_project_file"] } });
    expect(result).toMatchObject({ permittedOperations: ["post_room_message"], expiresAt: issuedAt + 10 });
  });

  it.each([
    { ...route, metering: { kind: "unverified" as const } },
    { ...route, metering: { kind: "verified" as const, proofRef: "proof:fixture", expiresAt: issuedAt } },
    { ...route, operationKeys: ["read_project_file"] },
    { ...route, audience: "another-receiver" },
    { ...route, budget: { ...route.budget, maxInputTokens: 10_001 } },
  ])("holds unknown metering, wrong route, unsupported operation or unbounded budget", (changedRoute) => {
    expect(projectS5Launch({ ...input, route: changedRoute })).toBeNull();
  });

  it("holds a mismatched qualification subject, presence of no scheme for coordination and a foreign case", () => {
    if (admission.jsi.kind !== "eligible") throw new Error("Expected an eligible fixture");
    expect(projectS5Launch({ ...input, admission: { ...admission, jsi: { ...admission.jsi, selector: { ...selector, subject: { ...subject, principalId: "other" } } } } })).toBeNull();
    expect(projectS5Launch({ ...input, admission: { ...admission, jsi: { kind: "not-applicable" } } })).toBeNull();
    expect(projectS5Launch({ ...input, coordinationTarget: { ...coordinationTarget, caseKey: "backlog-item:BI-OTHER" } })).toBeNull();
  });

  it("does not serialize the rehearsal waiver into a v1 launch even with a verified route", () => {
    const rehearsal: S5AdmissionCeiling = { ...admission, jsi: { kind: "rehearsal-qualification", approvalRef: "approval-a",
      ownerPrincipalId: "PRN-OWNER", approvalRevision: 1, statusRevision: 1, validUntil: expiresAt,
      syntheticTarget: { environment: "non-production", fixtureRef: "fixture-a", databaseRef: "fixture-db",
        destinationRef: "fixture-relay", ...coordinationTarget } } };
    expect(projectS5Launch({ ...input, admission: rehearsal })).toBeNull();
    expect(projectS5Launch({ ...input, admission: { ...rehearsal, host: { ...rehearsal.host,
      mode: "bounded-coding", worktreeRef: "other" } } })).toBeNull();
  });

  it("preserves an explicit no-scheme verdict only on a bounded coding launch with an admitted worktree", () => {
    const activityKey = "coding-fixture";
    const coding: S5AdmissionCeiling = { ...admission, activityKey, operationKeys: ["read_project_file"],
      host: { ...admission.host, mode: "bounded-coding", worktreeRef: "worktree:fixture" }, jsi: { kind: "not-applicable" } };
    const codingInput = { admission: coding, route: { ...route, operationKeys: coding.operationKeys }, issuedAt, permitExpiresAt: expiresAt };
    expect(projectS5Launch(codingInput)).toMatchObject({ mode: "bounded-coding", worktreeRef: "worktree:fixture",
      jsi: { kind: "not-applicable", activityKey }, permittedOperations: ["read_project_file"] });
    expect(projectS5Launch({ ...codingInput, admission: { ...coding, host: { ...coding.host, worktreeRef: null } } })).toBeNull();
    expect(projectS5Launch({ ...codingInput, coordinationTarget })).toBeNull();
  });
});
