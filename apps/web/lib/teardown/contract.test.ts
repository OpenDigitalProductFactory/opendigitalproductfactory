import { describe, expect, it } from "vitest";

import {
  buildTeardownStages,
  isDestructiveScope,
  isNestedPath,
  validateTeardownEnvelope,
  type TeardownEnvelope,
} from "./contract";
import { signTeardownEnvelope, verifyTeardownEnvelopeSignature } from "./signing";

const BASE_TIME = Date.UTC(2026, 7, 22, 12);
const iso = (offsetMs: number) => new Date(BASE_TIME + offsetMs).toISOString();

const envelope = (overrides: Partial<TeardownEnvelope> = {}): TeardownEnvelope => ({
  schemaVersion: 1,
  kind: "installation-teardown",
  runId: "TDR-ABC12345",
  issuedAt: iso(0),
  expiresAt: iso(5 * 60_000),
  scope: "everything",
  actorRef: "user-1",
  installPath: "D:\\DPF",
  backupsPath: "D:\\DPF-backups",
  composeProject: "dpf",
  composeFiles: ["docker-compose.yml", "docker-compose.windows.yml"],
  previewDigest: "a".repeat(64),
  salvageDigest: "b".repeat(64),
  recovery: {
    backupRunId: "backup-1",
    backupSha256: "c".repeat(64),
    trialRestoreId: "restore-1",
    trialStatus: "ok",
  },
  confirmation: {
    mode: "pointer-hold",
    challengeId: "challenge-1",
    heldForMs: 2400,
  },
  ...overrides,
});

describe("governed teardown contract", () => {
  it("maps each scope to a bounded, ordered stage list", () => {
    expect(buildTeardownStages("containers")).toEqual(["planned", "stopping", "completed"]);
    expect(buildTeardownStages("volumes")).toEqual([
      "planned",
      "stopping",
      "deleting-volumes",
      "completed",
    ]);
    expect(buildTeardownStages("source")).toEqual([
      "planned",
      "salvaging",
      "stopping",
      "deleting-source",
      "completed",
    ]);
    expect(buildTeardownStages("everything")).toEqual([
      "planned",
      "salvaging",
      "stopping",
      "deleting-volumes",
      "deleting-source",
      "completed",
    ]);
    expect(isDestructiveScope("containers")).toBe(false);
    expect(isDestructiveScope("volumes")).toBe(true);
  });

  it("signs canonical JSON, not caller key insertion order", () => {
    const secret = "s".repeat(64);
    const first = signTeardownEnvelope(envelope(), secret);
    const reordered = Object.fromEntries(Object.entries(envelope()).reverse()) as unknown as TeardownEnvelope;
    expect(signTeardownEnvelope(reordered, secret)).toBe(first);
    expect(verifyTeardownEnvelopeSignature(reordered, first, secret)).toBe(true);
    expect(verifyTeardownEnvelopeSignature({ ...reordered, scope: "source" }, first, secret)).toBe(false);
  });

  it("refuses expired, overlong, unverified, and evidence-nested plans", () => {
    expect(validateTeardownEnvelope(envelope(), BASE_TIME + 2 * 60_000)).toEqual({ valid: true });
    expect(validateTeardownEnvelope(envelope(), BASE_TIME + 6 * 60_000)).toMatchObject({ valid: false, code: "teardown_plan_expired" });
    expect(validateTeardownEnvelope(envelope({ expiresAt: iso(10 * 60_000) }), BASE_TIME + 1_000)).toMatchObject({ valid: false, code: "teardown_plan_ttl_exceeded" });
    expect(validateTeardownEnvelope(envelope({ recovery: { backupRunId: "backup-1", backupSha256: null, trialRestoreId: "restore-1", trialStatus: "failed" } }), BASE_TIME + 2 * 60_000)).toMatchObject({ valid: false, code: "teardown_recovery_unverified" });
    expect(validateTeardownEnvelope(envelope({ backupsPath: "D:\\DPF\\backups" }), BASE_TIME + 2 * 60_000)).toMatchObject({ valid: false, code: "teardown_evidence_inside_source" });
    expect(validateTeardownEnvelope(envelope({ installPath: "C:\\Users\\owner" }), BASE_TIME + 2 * 60_000)).toMatchObject({ valid: false, code: "teardown_host_path_unsafe" });
    expect(validateTeardownEnvelope(envelope({ installPath: "/home/owner" }), BASE_TIME + 2 * 60_000)).toMatchObject({ valid: false, code: "teardown_host_path_unsafe" });
  });

  it("compares Windows and POSIX paths without prefix confusion", () => {
    expect(isNestedPath("D:\\DPF", "d:\\dpf\\backups")).toBe(true);
    expect(isNestedPath("D:\\DPF", "D:\\DPF-backups")).toBe(false);
    expect(isNestedPath("/opt/dpf", "/opt/dpf/backups")).toBe(true);
    expect(isNestedPath("/opt/dpf", "/opt/dpf-backups")).toBe(false);
  });
});
