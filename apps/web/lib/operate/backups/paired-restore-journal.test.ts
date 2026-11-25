import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fixtureId = "restore-1";
const journalName = "recovery.json";
const SHA = "4".repeat(64);
const otherSHA = "5".repeat(64);
const intent = {
  operationId: fixtureId,
  installationId: "fixture-install",
  selected: {
    postgres: { runId: "pg-source", storagePath: "postgres/source", sha256: SHA },
    uploads: { runId: "uploads-source", storagePath: "uploads/source", sha256: SHA, manifestSha256: otherSHA },
  },
  safety: {
    postgres: { runId: "pg-safety", storagePath: "postgres/safety", sha256: otherSHA },
    uploads: { runId: "uploads-safety", storagePath: "uploads/safety", sha256: otherSHA, manifestSha256: SHA },
  },
  receiver: [{ name: "upload-store", path: "/fixture/uploads", dev: "5", ino: "10" }],
  collisionSetSha256: SHA,
};

let backupsRoot: string;
const journal = () => import("./paired-restore-journal");

beforeEach(async () => {
  backupsRoot = await mkdtemp(join(await realpath(tmpdir()), "dpf-restore-journal-"));
});
afterEach(async () => {
  await rm(backupsRoot, { recursive: true, force: true });
});

describe("paired restore host journal", () => {
  it("persists and reads back the exact pair before a database can be replaced", async () => {
    const { prepareRestoreJournal, readRestoreJournal } = await journal();
    const receipt = await prepareRestoreJournal(backupsRoot, intent);
    expect(receipt.stage).toBe("prepared");
    expect(await readRestoreJournal(backupsRoot, fixtureId)).toEqual(receipt);
    expect(receipt.selected).toEqual(intent.selected);
    expect(receipt.safety).toEqual(intent.safety);
    expect(receipt.receiver).toEqual(intent.receiver);
    await expect(prepareRestoreJournal(backupsRoot, intent)).rejects.toThrow();
  });

  it("refuses reordered, stale or skipped stage changes", async () => {
    const { prepareRestoreJournal, advanceRestoreJournal, readRestoreJournal } = await journal();
    await prepareRestoreJournal(backupsRoot, intent);
    await expect(advanceRestoreJournal(backupsRoot, fixtureId, "prepared", "uploads-started")).rejects.toThrow(/stage/i);
    await advanceRestoreJournal(backupsRoot, fixtureId, "prepared", "postgres-started");
    await expect(advanceRestoreJournal(backupsRoot, fixtureId, "prepared", "postgres-started")).rejects.toThrow(/stage/i);
    expect((await readRestoreJournal(backupsRoot, fixtureId)).stage).toBe("postgres-started");
  });

  it("survives fixture process death between Postgres replacement and upload publication", async () => {
    const journalModule = new URL("./paired-restore-journal.ts", import.meta.url);
    const simulatedDb = join(backupsRoot, "fixture-db-audit");
    const simulatedUpload = join(backupsRoot, "fixture-upload");
    await writeFile(simulatedDb, "old db had these rows");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { rm, writeFile } from "node:fs/promises";
      import { prepareRestoreJournal, advanceRestoreJournal } from ${JSON.stringify(journalModule.href)};
      const [root, input, db, upload] = process.argv.slice(1);
      await prepareRestoreJournal(root, JSON.parse(input));
      await advanceRestoreJournal(root, "restore-1", "prepared", "postgres-started");
      await rm(db);
      await advanceRestoreJournal(root, "restore-1", "postgres-started", "postgres-restored");
      process.exit(86);
      await writeFile(upload, "would have published");
    `, backupsRoot, JSON.stringify(intent), simulatedDb, simulatedUpload], { encoding: "utf8" });
    assert.equal(child.status, 86, child.stderr);
    await expect(readFile(simulatedDb)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(simulatedUpload)).rejects.toMatchObject({ code: "ENOENT" });
    const { readRestoreJournal, advanceRestoreJournal } = await journal();
    const recovered = await readRestoreJournal(backupsRoot, fixtureId);
    expect(recovered).toMatchObject({ stage: "postgres-restored", selected: intent.selected, safety: intent.safety });
    await advanceRestoreJournal(backupsRoot, fixtureId, "postgres-restored", "uploads-started");
    expect((await readRestoreJournal(backupsRoot, fixtureId)).stage).toBe("uploads-started");
  });

  it("refuses a linked journal or a path outside the backup root", async () => {
    const { prepareRestoreJournal, readRestoreJournal } = await journal();
    await expect(prepareRestoreJournal(backupsRoot, { ...intent, operationId: "../escape" })).rejects.toThrow(/operation/i);
    await prepareRestoreJournal(backupsRoot, intent);
    const path = join(backupsRoot, "restore", fixtureId, journalName);
    const substitute = join(backupsRoot, "substitute.json");
    await writeFile(substitute, await readFile(path));
    await rm(path);
    await symlink(substitute, path);
    await expect(readRestoreJournal(backupsRoot, fixtureId)).rejects.toThrow();
  });

  it("retains the forward progress when the exact safety pair is selected", async () => {
    const { prepareRestoreJournal, advanceRestoreJournal, selectRestoreSafetyPair } = await journal();
    await prepareRestoreJournal(backupsRoot, intent);
    await advanceRestoreJournal(backupsRoot, fixtureId, "prepared", "postgres-started");
    await expect(selectRestoreSafetyPair(backupsRoot, fixtureId, intent.selected)).rejects.toThrow(/safety/i);
    await expect(selectRestoreSafetyPair(backupsRoot, fixtureId, intent.safety)).resolves.toMatchObject({
      mode: "safety", stage: "prepared", forwardStage: "postgres-started", selected: intent.selected, safety: intent.safety,
    });
    await advanceRestoreJournal(backupsRoot, fixtureId, "prepared", "postgres-started");
    await expect(selectRestoreSafetyPair(backupsRoot, fixtureId, intent.safety)).resolves.toMatchObject({
      mode: "safety", stage: "postgres-started", forwardStage: "postgres-started",
    });
  });

  it("finds unfinished operations independently of Postgres and refuses unknown journal values", async () => {
    const { prepareRestoreJournal, advanceRestoreJournal, listUnfinishedRestoreJournals } = await journal();
    await expect(listUnfinishedRestoreJournals(backupsRoot)).resolves.toEqual([]);
    await prepareRestoreJournal(backupsRoot, intent);
    await expect(listUnfinishedRestoreJournals(backupsRoot)).resolves.toMatchObject([{ operationId: fixtureId }]);
    for (const [from, to] of [["prepared", "postgres-started"], ["postgres-started", "postgres-restored"],
      ["postgres-restored", "uploads-started"], ["uploads-started", "uploads-restored"], ["uploads-restored", "completed"]] as const) {
      await advanceRestoreJournal(backupsRoot, fixtureId, from, to);
    }
    await expect(listUnfinishedRestoreJournals(backupsRoot)).resolves.toEqual([]);
    const path = join(backupsRoot, "restore", fixtureId, journalName);
    const data = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...data, stage: "future" }));
    await expect(listUnfinishedRestoreJournals(backupsRoot)).rejects.toThrow(/stage/i);
    await writeFile(path, JSON.stringify({ ...data, unknown: true }));
    await expect(listUnfinishedRestoreJournals(backupsRoot)).rejects.toThrow(/journal/i);
  });

  it("does not mistake a dangling host journal directory link for absence", async () => {
    const { listUnfinishedRestoreJournals } = await journal();
    await symlink(join(backupsRoot, "missing"), join(backupsRoot, "restore"));
    await expect(listUnfinishedRestoreJournals(backupsRoot)).rejects.toThrow(/physical/i);
  });

  it("refuses distinct receiver names that resolve within another receiver root", async () => {
    const { prepareRestoreJournal } = await journal();
    await expect(prepareRestoreJournal(backupsRoot, { ...intent, receiver: [
      ...intent.receiver, { name: "voice", path: "/fixture/uploads/nested", dev: "5", ino: "11" },
    ] })).rejects.toThrow(/root/i);
  });

  it("persists an immutable inspected destination and a separately verified publication result", async () => {
    const { prepareRestoreJournal, advanceRestoreJournal, recordRestoreFileIntent, listRestoreFileIntents, markRestoreFilePublished } = await journal();
    const file = { rootName: "upload-store", relativePath: "documents/file.pdf", beforeSha256: null, afterSha256: SHA };
    await prepareRestoreJournal(backupsRoot, intent);
    await expect(recordRestoreFileIntent(backupsRoot, fixtureId, "selected", file)).rejects.toThrow(/stage/i);
    await advanceRestoreJournal(backupsRoot, fixtureId, "prepared", "postgres-started");
    await advanceRestoreJournal(backupsRoot, fixtureId, "postgres-started", "postgres-restored");
    await advanceRestoreJournal(backupsRoot, fixtureId, "postgres-restored", "uploads-started");
    await expect(recordRestoreFileIntent(backupsRoot, fixtureId, "selected", { ...file, relativePath: "../escape" })).rejects.toThrow();
    await expect(recordRestoreFileIntent(backupsRoot, fixtureId, "selected", file)).resolves.toMatchObject({ ...file, stage: "pending" });
    await expect(listRestoreFileIntents(backupsRoot, fixtureId, "selected")).resolves.toMatchObject([{ ...file, stage: "pending" }]);
    await expect(recordRestoreFileIntent(backupsRoot, fixtureId, "selected", { ...file, beforeSha256: otherSHA })).rejects.toThrow(/changed/i);
    await expect(markRestoreFilePublished(backupsRoot, fixtureId, "selected", file, otherSHA)).rejects.toThrow(/digest/i);
    await expect(markRestoreFilePublished(backupsRoot, fixtureId, "selected", file, SHA)).resolves.toMatchObject({ ...file, stage: "published" });
    await expect(recordRestoreFileIntent(backupsRoot, fixtureId, "selected", file)).resolves.toMatchObject({ stage: "published" });
  });
});
