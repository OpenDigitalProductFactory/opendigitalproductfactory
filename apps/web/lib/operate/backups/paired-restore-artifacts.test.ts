import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// A legacy install, stated rather than read from the host's /proc, which the
// fail-closed mount rule would otherwise make platform-dependent.
vi.mock("@/lib/platform-runtime/actuator-client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/platform-runtime/actuator-client")>(),
  usesPrivateActuator: async () => false,
  usesPrivateActuatorSync: () => false,
}));
import { validatePairedRestoreArtifacts } from "./paired-restore-artifacts";
import { captureUploadsCustody } from "./uploads-custody";
import { captureRestoreUploadRoots, inspectRestoreUploadDestinations } from "./restore-upload-destinations";
import { runManagedPairedArchiveRestore } from "./uploads-restore-runner";
import { readRestoreJournal, type RestoreJournalPair } from "./paired-restore-journal";

let root: string;
const sha = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const writerUrl = new URL("../../../../../scripts/backup-uploads.mjs", import.meta.url);
const readerPath = fileURLToPath(new URL("../../../../../scripts/restore-uploads.mjs", import.meta.url));
beforeEach(async () => { root = await mkdtemp(join(await realpath(tmpdir()), "paired-restore-artifacts-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function fixture(tag = "src", contents: Array<[string, string]> = [["file", "fixture payload"]]) {
  const { buildManifest, serializeManifest, writeArchive } = await import(writerUrl.href);
  await mkdir(join(root, "uploads", tag), { recursive: true });
  await mkdir(join(root, "postgres", tag), { recursive: true });
  const uploadPath = join(root, "uploads", tag);
  const pg = { runId: `pg-${tag}`, storagePath: `postgres/${tag}`, sha256: sha("dump") };
  const dump = join(root, pg.storagePath, "dpf.dump");
  await writeFile(dump, "dump");
  const entries = await Promise.all(contents.map(async ([path, content], index) => {
    const abs = join(root, `payload-${tag}-${index}`);
    await writeFile(abs, content);
    return { root: "upload-store", path, abs, size: Buffer.byteLength(content) };
  }));
  const artifact = writeArchive({
    entries,
    tarPath: join(uploadPath, "uploads.tar"), ndjsonPath: join(uploadPath, "files.ndjson"),
  });
  const date = "2026-11-24T00:00:00.000Z";
  const manifest = serializeManifest(buildManifest({
    ...artifact, roots: [{ name: "upload-store", path: "/source-only", resolvedFrom: "env" }],
    pairedPostgresRunId: pg.runId, pairedPostgresSha256: pg.sha256, deletedAfterSnapshot: [],
    startedAt: date, finishedAt: date, durationMs: 0,
  }));
  await writeFile(join(uploadPath, "manifest.json"), manifest);
  await writeFile(join(uploadPath, "uploads.tar.sha256"), `${artifact.archiveSha256}  uploads.tar\n`);
  const upload = { runId: `up-${tag}`, storagePath: `uploads/${tag}`, sha256: artifact.archiveSha256, manifestSha256: sha(manifest) };
  return { dump, pair: { postgres: pg, uploads: upload }, manifest, uploadPath };
}

async function anchor(pair: RestoreJournalPair, backupsRoot = root) {
  await captureUploadsCustody(backupsRoot, { runId: pair.uploads.runId, storagePath: pair.uploads.storagePath,
    archiveSha256: pair.uploads.sha256, pairedPostgresRunId: pair.postgres.runId, pairedPostgresSha256: pair.postgres.sha256 });
}

describe("managed paired restore source", () => {
  it("requires external custody, then admits the exact writer-generated upload archive and dump", async () => {
    const { pair } = await fixture();
    await expect(validatePairedRestoreArtifacts({ backupsRoot: root, pair, readerPath })).rejects.toThrow();
    await anchor(pair);
    await expect(validatePairedRestoreArtifacts({ backupsRoot: root, pair, readerPath })).resolves.toMatchObject({
      rootNames: ["upload-store"], members: [{ path: "file", sha256: sha("fixture payload") }],
    });
    await expect(validatePairedRestoreArtifacts({
      backupsRoot: root, readerPath, pair: { ...pair, postgres: { ...pair.postgres, runId: "other-dump" } },
    })).rejects.toThrow(/custody/i);
  });

  it("refuses changed dump bytes or an archive that changed after capture", async () => {
    const { pair, dump, uploadPath } = await fixture();
    await anchor(pair);
    await writeFile(dump, "forged");
    await expect(validatePairedRestoreArtifacts({ backupsRoot: root, pair, readerPath })).rejects.toThrow(/dump.*digest/i);
    await writeFile(dump, "dump");
    const tar = join(uploadPath, "uploads.tar");
    const changed = await readFile(tar);
    changed[512] = 0x62;
    await writeFile(tar, changed);
    await expect(validatePairedRestoreArtifacts({ backupsRoot: root, pair, readerPath })).rejects.toThrow(/payload digest/i);
  });
});

it.skipIf(process.platform !== "linux")("revalidates receiver review before Postgres and restores writer-made archives without touching unlisted files", async () => {
  const operationId = "paired-fixture";
  const installationId = "fixture-installation";
  const originalRoot = root;
  const backupsRoot = join(originalRoot, "backups");
  root = backupsRoot;
  try {
    const receiverPath = join(originalRoot, "receiver");
    await mkdir(receiverPath);
    await writeFile(join(receiverPath, "changed"), "original");
    await writeFile(join(receiverPath, "same"), "same");
    await writeFile(join(receiverPath, "unlisted"), "untouched");
    const { pair: selected } = await fixture("selected", [["changed", "new content"], ["created", "added"], ["same", "same"]]);
    const { pair: safety } = await fixture("safety", [["changed", "original"], ["same", "same"], ["unlisted", "untouched"]]);
    await Promise.all([anchor(selected), anchor(safety)]);
    const receiver = await captureRestoreUploadRoots([{ name: "upload-store", path: receiverPath }]);
    const archive = await validatePairedRestoreArtifacts({ backupsRoot, pair: selected, readerPath });
    const { collisionSetSha256 } = await inspectRestoreUploadDestinations(receiver, archive.members);
    const postgresScriptPath = join(originalRoot, "fixture-postgres.sh");
    const marker = join(originalRoot, "pg-was-called");
    await writeFile(postgresScriptPath, `#!/bin/sh\nset -eu\n[ "$EXPECTED_DUMP_SHA256" = "${selected.postgres.sha256}" ]\n[ "$(cat "$DUMP_PATH")" = dump ]\nprintf 'replaced' > "${marker}"\n`);
    const args = { operationId, installationId, backupsRoot, readerPath, postgresScriptPath, request: { kind: "start" as const } };
    const boundary = {
      bindWriterFence: async () => {},
      finishFence: async () => {},
      prepare: async () => ({ operationId, installationId, selected, safety, receiver, collisionSetSha256 }),
      projectResult: async () => {
        expect(await readFile(marker, "utf8")).toBe("replaced");
        expect((await readRestoreJournal(backupsRoot, operationId)).stage).toBe("uploads-restored");
      },
    };
    await writeFile(join(receiverPath, "created"), "unexpected");
    await expect(runManagedPairedArchiveRestore(args, boundary)).rejects.toThrow(/approved collision set/i);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(join(receiverPath, "created"));
    await expect(runManagedPairedArchiveRestore(args, boundary)).resolves.toMatchObject({ stage: "completed" });
    await expect(readFile(join(receiverPath, "changed"), "utf8")).resolves.toBe("new content");
    await expect(readFile(join(receiverPath, "created"), "utf8")).resolves.toBe("added");
    await expect(readFile(join(receiverPath, "same"), "utf8")).resolves.toBe("same");
    await expect(readFile(join(receiverPath, "unlisted"), "utf8")).resolves.toBe("untouched");
  } finally {
    root = originalRoot;
  }
});
