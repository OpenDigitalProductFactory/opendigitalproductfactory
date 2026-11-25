import { describe, expect, it } from "vitest";
import type { S5AdmissionCeiling } from "@/lib/workroom-runtime/s5-admission.server";
import {
  captureS5CredentialCeiling,
  narrowS5CredentialForCurrentAdmission,
  readS5CredentialCeiling,
  S5_WORKROOM_TOKEN_KIND,
  type S5CredentialCarrier,
} from "./s5-room-credential.server";

const now = new Date("2026-11-25T00:00:00Z");
const before = new Date(now.getTime() - 10_000);
const after = new Date(now.getTime() + 30_000);
const subject = { principalId: "PRN-FIXTURE", gaid: "gaid:priv:fixture:actor" };
const authority = { bindingRef: "binding-a", permitRef: "permit-a", grantKeys: ["file_read", "work_room_read"] };
const locator = { workroomId: "WC-FIXTURE", sessionRef: "session-a", stageAttemptRef: "attempt-11" };
const receiver = { issuer: "installation-a", audience: "control-a", hostRef: "host-a", resource: "https://fixture.invalid/api/mcp/v1" };

const admission: S5AdmissionCeiling = {
  kind: "composed", subject, locator, ...authority, agentId: "AGT-FIXTURE", issuer: receiver.issuer,
  authorityBindingId: "relational-binding-id", activityKey: "coding-fixture", job: { id: "engineer", version: "1" },
  stageKey: "development", caseKey: "backlog-item:BI-FIXTURE", operationKeys: ["read_project_file", "get_workroom"],
  host: { mode: "bounded-coding", hostRef: receiver.hostRef, receiverRef: receiver.audience, worktreeRef: "worktree-a" },
  jsi: { kind: "not-applicable" },
};

function row(): S5CredentialCarrier {
  return { kind: S5_WORKROOM_TOKEN_KIND, workroomRef: locator.workroomId, runRef: locator.sessionRef, agentId: admission.agentId,
    scope: "read", capability: "read", resource: receiver.resource, authorityBindingId: "relational-binding-id", createdAt: before,
    expiresAt: after, revokedAt: null, scopes: [...authority.grantKeys], workroomAuthorization: captureS5CredentialCeiling(admission) };
}

describe("S5 credential ceiling", () => {
  it("accepts only the exact private v1 ceiling scoped to the authenticated Control receiver", () => {
    const value = readS5CredentialCeiling(row(), receiver, now);
    expect(value).toMatchObject({ projection: { ...locator, subject, stageKey: "development", operationKeys: admission.operationKeys },
      authorityBindingId: "relational-binding-id", expiresAt: after });
    expect(value?.projection).not.toHaveProperty("credential");
    expect(value?.projection).not.toHaveProperty("profileFingerprint");
  });

  it.each([
    { kind: "workroom_session" }, { workroomAuthorization: null }, { scope: "write" }, { capability: "write" },
    { authorityBindingId: null }, { workroomRef: "WC-OTHER" }, { runRef: "session-b" }, { agentId: "AGT-OTHER" },
    { expiresAt: now }, { expiresAt: null }, { revokedAt: now }, { resource: "https://other.invalid/api/mcp/v1" },
  ])("refuses stale, broad or incompatible carriers %j", (mutation) => {
    expect(readS5CredentialCeiling({ ...row(), ...mutation }, receiver, now)).toBeNull();
  });

  it.each([{ issuer: "other-install" }, { audience: "other-control" }, { hostRef: "other-host" }])("refuses a different authenticated receiver or host %j", (mutation) => {
    expect(readS5CredentialCeiling(row(), { ...receiver, ...mutation }, now)).toBeNull();
  });

  it("refuses malformed or legacy projection data without falling back to token grants", () => {
    const projection = captureS5CredentialCeiling(admission);
    for (const change of [{ schemaVersion: "s5-room-credential.v2" }, { operationKeys: ["get_workroom", "get_work_capsule"] },
      { bearer: "forbidden" }, { subject: null }, { permitRef: "" }]) {
      expect(readS5CredentialCeiling({ ...row(), workroomAuthorization: { ...projection, ...change } }, receiver, now)).toBeNull();
    }
  });

  it("does not expand at use time when the current job and grants grew", () => {
    const issued = readS5CredentialCeiling(row(), receiver, now)!;
    const current: S5AdmissionCeiling = { ...admission, operationKeys: ["get_workroom", "read_room_messages"], grantKeys: ["work_room_read", "new_grant"] };
    expect(narrowS5CredentialForCurrentAdmission(issued, current, now)).toEqual({ operationKeys: ["get_workroom"], grantKeys: ["work_room_read"] });
  });

  it.each([
    { locator: { ...locator, stageAttemptRef: "attempt-12" } }, { stageKey: "review" }, { bindingRef: "binding-b" }, { permitRef: "permit-b" },
    { authorityBindingId: "different-binding-row" }, { job: { ...admission.job, version: "2" } },
    { subject: { ...subject, gaid: "gaid:priv:fixture:other" } }, { host: { ...admission.host, worktreeRef: "foreign-tree" } },
  ])("refuses a changed live attempt, binding, permit, identity or source scope %j", (mutation) => {
    const issued = readS5CredentialCeiling(row(), receiver, now)!;
    expect(narrowS5CredentialForCurrentAdmission(issued, { ...admission, ...mutation }, now)).toBeNull();
  });
});
