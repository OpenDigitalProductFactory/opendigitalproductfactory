import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { S5AdmissionCeiling } from "@/lib/workroom-runtime/s5-admission.server";
import {
  captureS5CredentialCeiling,
  narrowS5CredentialForCurrentAdmission,
  readS5CredentialCeiling,
  prepareS5ControlCredential,
  resolveS5ControlCredential,
  revokeS5ControlCredential,
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
  it("builds a hash-only record for the exact Control audience and absolute admission deadline", () => {
    const prepared = prepareS5ControlCredential({ admission, receiver, userId: "user-a", now, expiresAt: after });
    expect(prepared?.plaintext).toMatch(/^dpfroom_[\w-]{32}$/u);
    const { data, plaintext } = prepared!;
    expect(data).toMatchObject({ kind: S5_WORKROOM_TOKEN_KIND, resource: receiver.resource, userId: "user-a", agentId: admission.agentId,
      workroomRef: locator.workroomId, runRef: locator.sessionRef, scope: "read", capability: "read", authorityBindingId: admission.authorityBindingId,
      tokenHash: createHash("sha256").update(plaintext).digest("hex"), expiresAt: after });
    expect(data.workroomAuthorization).toEqual(captureS5CredentialCeiling(admission));
    expect(data).not.toHaveProperty("secretEnc");
    expect(JSON.stringify(data)).not.toContain(plaintext);
    expect(prepareS5ControlCredential({ admission, receiver: { ...receiver, audience: "other" }, userId: "user-a", now, expiresAt: after })).toBeNull();
    expect(prepareS5ControlCredential({ admission, receiver, userId: "user-a", now, expiresAt: now })).toBeNull();
  });

  it("limits qualified credentials to the live qualification's earlier expiry", () => {
    const validUntil = now.getTime() + 1_000;
    const qualified: S5AdmissionCeiling = { ...admission, jsi: { kind: "eligible", validUntil,
      qualification: { id: "qualification-a", version: 1, statusRevision: 1 },
      selector: { installationId: receiver.issuer, organizationId: "org-a", subject, job: admission.job, activityKey: admission.activityKey,
        scope: { workflow: "fixture", archetype: "fixture", jurisdiction: "US", dataClass: "synthetic", riskClass: "low" },
        profileFingerprint: `sha256:${"a".repeat(64)}`, scheme: { id: "scheme-a", version: "1" } },
      ceiling: { operationKeys: [...admission.operationKeys], excludedOperationKeys: [], oversight: "continuous-supervision" } } };
    const prepared = prepareS5ControlCredential({ admission: qualified, receiver, userId: "user-a", now, expiresAt: after });
    expect(prepared?.data.expiresAt).toEqual(new Date(validUntil));
  });

  it("reads by hash through the scoped carrier only and never refreshes the bearer", async () => {
    const prepared = prepareS5ControlCredential({ admission, receiver, userId: "user-a", now, expiresAt: after })!;
    const findUnique = vi.fn().mockResolvedValue({ ...row(), id: "token-a", userId: "user-a" });
    const update = vi.fn();
    const db = { mcpApiToken: { findUnique, update } };
    const read = () => resolveS5ControlCredential(db, prepared.plaintext, receiver, now);
    expect(await read()).toMatchObject({ tokenId: "token-a", userId: "user-a", ceiling: { projection: locator } });
    expect(findUnique.mock.calls[0]?.[0]).toMatchObject({ where: { tokenHash: prepared.data.tokenHash } });
    expect(findUnique.mock.calls[0]?.[0]?.select).not.toHaveProperty("secretEnc");
    findUnique.mockResolvedValue({ ...row(), id: "token-a", userId: "user-a", kind: "workroom_session" });
    expect(await read()).toBeNull();
    findUnique.mockClear();
    expect(await resolveS5ControlCredential(db, "dpfmcp_invalid", receiver, now)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("fences only the original token, room, session and attempt", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { mcpApiToken: { updateMany } };
    await expect(revokeS5ControlCredential(tx, { tokenId: "token-a", ...locator, now, reason: "attempt-released" })).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "token-a", kind: S5_WORKROOM_TOKEN_KIND, workroomRef: locator.workroomId, runRef: locator.sessionRef, revokedAt: null,
        AND: [{ workroomAuthorization: { path: ["stageAttemptRef"], equals: locator.stageAttemptRef } },
          { workroomAuthorization: { path: ["schemaVersion"], equals: "s5-room-credential.v1" } }] },
      data: { revokedAt: now, revokedReason: "attempt-released" },
    });
    updateMany.mockClear();
    await expect(revokeS5ControlCredential(tx, { tokenId: "", ...locator, now, reason: "attempt-released" })).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });

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
