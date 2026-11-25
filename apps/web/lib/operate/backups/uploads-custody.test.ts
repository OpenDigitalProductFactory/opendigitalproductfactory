import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureUploadsCustody, readUploadsCustody } from "./uploads-custody";

const archiveSha256 = "a".repeat(64);
const pairedPostgresSha256 = "b".repeat(64);
const fields = {
  runId: "upload-a",
  archiveSha256,
  pairedPostgresRunId: "postgres-a",
  pairedPostgresSha256,
  storagePath: "uploads/run-1",
};
const validManifest = JSON.stringify({
  target: "uploads", archiveSha256, pairedPostgresSha256, pairedPostgresRunId: "postgres-a",
  deletedAfterSnapshot: [],
});
let backups: string;
let manifest: string;
beforeEach(async () => {
  backups = await mkdtemp(join(tmpdir(), "dpf-upload-custody-"));
  const run = join(backups, fields.storagePath);
  await mkdir(run, { recursive: true });
  manifest = join(run, "manifest.json");
  await writeFile(manifest, validManifest);
});
afterEach(async () => { await rm(backups, { recursive: true, force: true }); });

describe("successful upload capture custody", () => {
  it("anchors exact manifest bytes outside the run directory and never overwrites the receipt", async () => {
    const expected = { schemaVersion: 1, ...fields, manifestSha256: createHash("sha256").update(validManifest).digest("hex") };
    await expect(captureUploadsCustody(backups, fields)).resolves.toEqual(expected);
    await expect(readUploadsCustody(backups, fields.runId)).resolves.toEqual(expected);
    await expect(captureUploadsCustody(backups, fields)).resolves.toEqual(expected);
    await writeFile(manifest, validManifest + "\n");
    await expect(captureUploadsCustody(backups, fields)).rejects.toThrow(/changed/i);
    expect(await readFile(join(backups, "uploads-custody", "upload-a.json"), "utf8")).toContain(expected.manifestSha256);
  });

  it("refuses a different Postgres pair and a linked manifest without creating a custody record", async () => {
    await expect(captureUploadsCustody(backups, { ...fields, pairedPostgresRunId: "different" })).rejects.toThrow(/pair/i);
    await expect(readUploadsCustody(backups, fields.runId)).rejects.toMatchObject({ code: "ENOENT" });
    const target = join(backups, "linked-manifest");
    await writeFile(target, validManifest);
    await rm(manifest);
    await symlink(target, manifest);
    await expect(captureUploadsCustody(backups, fields)).rejects.toThrow();
  });
});
