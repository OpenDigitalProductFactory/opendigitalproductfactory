import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRestoreJournal, type RestoreFileReceipt, type RestoreJournalIntent } from "./paired-restore-journal";
import { digestUploadDestinationInspection } from "./restore-upload-destinations";
import { planSelectedUploads, planSafetyUploads, runManagedPairedRestore } from "./uploads-restore-runner";

const operationId = "fixture-operation";
const digest = "a".repeat(64);
const pair = (tag: string) => ({
  postgres: { runId: `postgres-${tag}`, storagePath: `postgres/${tag}`, sha256: digest },
  uploads: { runId: `uploads-${tag}`, storagePath: `uploads/${tag}`, sha256: digest, manifestSha256: digest },
});
const intent: RestoreJournalIntent = {
  operationId,
  installationId: "fixture-installation",
  selected: pair("source"),
  safety: pair("safety"),
  receiver: [{ name: "upload-store", path: "/fixture/uploads", dev: "1", ino: "2" }],
  collisionSetSha256: digest,
};

let backupsRoot: string;
beforeEach(async () => { backupsRoot = await mkdtemp(join(await realpath(tmpdir()), "dpf-paired-restore-")); });
afterEach(async () => { await rm(backupsRoot, { recursive: true, force: true }); });

function fixture() {
  const events: string[] = [];
  return {
    events,
    bindWriterFence: vi.fn(async () => { events.push("fence"); }),
    prepare: vi.fn(async () => {
      events.push("preflight-and-safety");
      return intent;
    }),
    verifyRecovery: vi.fn(async () => { events.push("revalidate"); }),
    restorePostgres: vi.fn(async () => {
      expect((await readRestoreJournal(backupsRoot, operationId)).stage).toBe("postgres-started");
      events.push("postgres");
    }),
    restoreUploads: vi.fn(async () => {
      expect((await readRestoreJournal(backupsRoot, operationId)).stage).toBe("uploads-started");
      events.push("uploads");
    }),
    projectResult: vi.fn(async () => { events.push("audit"); }),
    finishFence: vi.fn(async () => { events.push("reopen"); }),
  };
}

describe("managed paired restore lifecycle", () => {
  it("preflights and durably journals the pair before Postgres, then publishes uploads and verifies completion", async () => {
    const deps = fixture();
    await expect(runManagedPairedRestore({ backupsRoot, operationId, request: { kind: "start" } }, deps))
      .resolves.toMatchObject({ stage: "completed", mode: "selected" });
    expect(deps.events).toEqual(["fence", "preflight-and-safety", "postgres", "uploads", "audit", "reopen"]);
  });

  it("does not replace the database or leave an unfinished journal when preflight refuses", async () => {
    const deps = fixture();
    deps.prepare.mockRejectedValueOnce(new Error("archive invalid"));
    await expect(runManagedPairedRestore({ backupsRoot, operationId, request: { kind: "start" } }, deps))
      .rejects.toThrow("archive invalid");
    expect(deps.events).toEqual(["fence", "reopen"]);
    await expect(readRestoreJournal(backupsRoot, operationId)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the receiver fenced and resumes uploads without replacing a proven Postgres stage again", async () => {
    const deps = fixture();
    deps.restoreUploads.mockRejectedValueOnce(new Error("fixture stop after Postgres"));
    await expect(runManagedPairedRestore({ backupsRoot, operationId, request: { kind: "start" } }, deps))
      .rejects.toThrow("fixture stop");
    expect(deps.finishFence).not.toHaveBeenCalled();
    await expect(runManagedPairedRestore({ backupsRoot, operationId, request: { kind: "start" } }, deps))
      .rejects.toThrow(/unfinished/i);
    await expect(runManagedPairedRestore({ backupsRoot, operationId, request: { kind: "resume", confirmed: intent.selected } }, deps))
      .resolves.toMatchObject({ stage: "completed" });
    expect(deps.restorePostgres).toHaveBeenCalledTimes(1);
    expect(deps.restoreUploads).toHaveBeenCalledTimes(2);
    expect(deps.finishFence).toHaveBeenCalledTimes(1);
  });

  it("revalidates the explicitly confirmed safety pair after an uncertain database application", async () => {
    const deps = fixture();
    deps.restorePostgres.mockRejectedValueOnce(new Error("fixture database interrupt"));
    await expect(runManagedPairedRestore({ backupsRoot, operationId, request: { kind: "start" } }, deps)).rejects.toThrow();
    await expect(runManagedPairedRestore({ backupsRoot, operationId, request: { kind: "safety", confirmed: intent.selected } }, deps))
      .rejects.toThrow(/confirmed/i);
    expect(deps.verifyRecovery).not.toHaveBeenCalled();
    await expect(runManagedPairedRestore({ backupsRoot, operationId, request: { kind: "safety", confirmed: intent.safety } }, deps))
      .resolves.toMatchObject({ mode: "safety", forwardStage: "postgres-started", stage: "completed" });
    expect(deps.restorePostgres).toHaveBeenCalledTimes(2);
    expect(deps.verifyRecovery).toHaveBeenCalledWith(expect.objectContaining({ stage: "postgres-started" }), intent.safety, "safety");
  });
});

const root = "upload-store";
const beforeSha256 = "b".repeat(64);
const afterSha256 = "c".repeat(64);
const inspected = (path: string, sha256: string, observedSha256: string | null) => ({ root, path, sha256, observedSha256 });
const changed: RestoreFileReceipt = { rootName: root, relativePath: "existing", beforeSha256, afterSha256, stage: "pending", schemaVersion: 1 };
const created: RestoreFileReceipt = { ...changed, relativePath: "created", beforeSha256: null };

describe("upload journal replay", () => {
  it("reconstructs the operator-approved receiver from original digests after partial publication", () => {
    const reviewed = [inspected("existing", afterSha256, beforeSha256), inspected("created", afterSha256, null)];
    const approved = digestUploadDestinationInspection(reviewed);
    const current = [inspected("existing", afterSha256, afterSha256), inspected("created", afterSha256, null)];
    expect(planSelectedUploads(current, [changed], approved)).toEqual([
      { rootName: root, relativePath: "existing", beforeSha256, afterSha256 },
      { rootName: root, relativePath: "created", beforeSha256: null, afterSha256 },
    ]);
    expect(() => planSelectedUploads([current[0]!, inspected("created", afterSha256, beforeSha256)], [changed], approved))
      .toThrow(/approved/i);
  });

  it("undoes only exact journaled writes and never treats a changed new file as safe to delete", () => {
    const safetyImage = [inspected("existing", beforeSha256, afterSha256), inspected("untouched", beforeSha256, beforeSha256)];
    const createdCheck = [inspected("created", afterSha256, afterSha256)];
    expect(planSafetyUploads(safetyImage, createdCheck, [changed, created], [])).toEqual([
      { rootName: root, relativePath: "existing", beforeSha256: afterSha256, afterSha256: beforeSha256 },
      { rootName: root, relativePath: "created", beforeSha256: afterSha256, afterSha256: null },
    ]);
    expect(() => planSafetyUploads(safetyImage, [inspected("created", afterSha256, digest)], [changed, created], []))
      .toThrow(/changed/i);
    expect(() => planSafetyUploads([safetyImage[0]!, inspected("untouched", beforeSha256, digest)], createdCheck, [changed, created], []))
      .toThrow(/changed/i);
  });
});
