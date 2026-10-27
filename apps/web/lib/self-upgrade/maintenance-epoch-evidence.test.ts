import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { signMaintenanceEpoch } from "../../../../scripts/lib/maintenance-epoch-receipt.mjs";
vi.mock("@dpf/db", () => ({ prisma: {} }));
import { attachMaintenanceEpochEvidence } from "./maintenance-epoch-evidence";
import { buildPromoterCommand } from "./promoter";

const secret = "a".repeat(64);
const now = new Date("2026-10-16T01:03:00.000Z");
const recoveryPoint = { schemaVersion: 1, status: "ok", trigger: "pre-upgrade-recovery", selfUpgradeRunId: "SUR-EXAMPLE",
  createdAt: "2026-10-16T00:58:00.000Z", members: [{ target: "postgres", runId: "BACKUP-EXAMPLE", status: "ok" }] };
const digest = createHash("sha256").update(canonicalJson(recoveryPoint)).digest("hex");
const payload = () => ({ schemaVersion: 1, runId: "SUR-EXAMPLE", targetSha: "a".repeat(40),
  promoterDigest: `sha256:${"b".repeat(64)}`, recoveryPointDigest: digest, project: "dpf", daemonId: "daemon-example",
  capturedAt: "2026-10-16T01:00:00.000Z", completedAt: "2026-10-16T01:02:00.000Z",
  before: { portal: { id: "1".repeat(64), startedAt: "2026-10-15T00:00:00.000Z" }, sandbox: { id: "2".repeat(64), startedAt: "2026-10-15T00:00:00.000Z" } },
  after: { portal: { id: "3".repeat(64), startedAt: "2026-10-16T01:01:00.000Z" }, sandbox: { id: "4".repeat(64), startedAt: "2026-10-16T01:01:00.000Z" } },
  retiredContainerIds: ["1".repeat(64), "2".repeat(64)], inventoryDigest: "d".repeat(64) });
function run() { return { runId: "SUR-EXAMPLE", status: "succeeded", targetSha: "a".repeat(40), deployedSha: "a".repeat(40),
  startedAt: new Date("2026-10-16T00:59:00.000Z"), updatedAt: now,
  completionEvidence: { recoveryPoint, unrelated: "preserve", readiness: { result: "ready", mode: "enforced", targetSha: "a".repeat(40), imageDigest: `sha256:${"b".repeat(64)}` } } }; }
let row: ReturnType<typeof run>;
const updateMany = vi.fn();
const db = { selfUpgradeRun: { findUnique: vi.fn(async () => row), updateMany } };
const options = () => ({ db, now, readEnvelope: async () => JSON.stringify(signMaintenanceEpoch(payload(), secret)), readSecret: async () => secret });
beforeEach(() => { row = run(); vi.clearAllMocks(); updateMany.mockResolvedValue({ count: 1 }); });

describe("server-only maintenance epoch import", () => {
  it("carries only a validated recovery digest through the existing canonical launcher", () => {
    const base = { hostInstallPath: "/install", targetSha: "a".repeat(40), backupPath: "/backups/test", healthUrl: "http://portal:3000/api/health" };
    expect(buildPromoterCommand({ ...base, maintenanceRecoveryPointDigest: digest }).args)
      .toContain(`DPF_MAINTENANCE_RECOVERY_POINT_DIGEST=${digest}`);
    expect(() => buildPromoterCommand({ ...base, maintenanceRecoveryPointDigest: "untrusted\nSECRET" })).toThrow();
    expect(buildPromoterCommand(base).args.some(value => value.startsWith("DPF_MAINTENANCE_RECOVERY"))).toBe(false);
  });
  it("binds the exact known run and preserves other evidence under CAS", async () => {
    expect(await attachMaintenanceEpochEvidence(options())).toEqual({ status: "attached", runId: "SUR-EXAMPLE" });
    expect(db.selfUpgradeRun.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { runId: "SUR-EXAMPLE" } }));
    const mutation = updateMany.mock.calls[0][0];
    expect(mutation.where).toEqual({ runId: "SUR-EXAMPLE", updatedAt: now, status: "succeeded" });
    expect(mutation.data.completionEvidence.unrelated).toBe("preserve");
    expect(mutation.data.completionEvidence.maintenanceEpochRetirement).toEqual(signMaintenanceEpoch(payload(), secret));
    expect(JSON.stringify(mutation)).not.toMatch(/executionSettled|retryAllowed|terminalWriterWait/);
  });
  it("does not overwrite evidence after a CAS race", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await attachMaintenanceEpochEvidence(options())).toEqual({ status: "raced", runId: "SUR-EXAMPLE" });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
  it("replays identical evidence without rewriting the run", async () => {
    Object.assign(row.completionEvidence, { maintenanceEpochRetirement: signMaintenanceEpoch(payload(), secret) });
    expect(await attachMaintenanceEpochEvidence(options())).toEqual({ status: "replayed", runId: "SUR-EXAMPLE" });
    expect(updateMany).not.toHaveBeenCalled();
  });
  it.each(["different-recovery", "wrong-source", "wrong-promoter", "failed-run", "wrong-deployed", "changed-proof", "legacy-readiness", "failed-backup"])("rejects %s without writes", async fault => {
    if (fault === "different-recovery") row.completionEvidence.recoveryPoint = { ...recoveryPoint, createdAt: now.toISOString() };
    if (fault === "wrong-source") row.targetSha = "9".repeat(40);
    if (fault === "wrong-promoter") row.completionEvidence.readiness.imageDigest = `sha256:${"9".repeat(64)}`;
    if (fault === "failed-run") row.status = "failed";
    if (fault === "wrong-deployed") row.deployedSha = "9".repeat(40);
    if (fault === "changed-proof") Object.assign(row.completionEvidence, { maintenanceEpochRetirement: { unexpected: true } });
    if (fault === "legacy-readiness") row.completionEvidence.readiness.mode = "legacy-bootstrap";
    if (fault === "failed-backup") row.completionEvidence.recoveryPoint = { ...recoveryPoint, members: [{ target: "postgres", runId: "BACKUP", status: "failed" }] };
    expect((await attachMaintenanceEpochEvidence(options())).status).toBe("unavailable");
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("missing, untrusted and unavailable evidence never supplies settlement", async () => {
    for (const readEnvelope of [async () => null, async () => "{}", async () => JSON.stringify(signMaintenanceEpoch(payload(), "z".repeat(64)))]) {
      expect((await attachMaintenanceEpochEvidence({ ...options(), readEnvelope })).status).toBe("unavailable");
    }
    expect(updateMany).not.toHaveBeenCalled();
  });
});
