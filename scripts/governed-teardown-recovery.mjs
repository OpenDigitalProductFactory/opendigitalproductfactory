import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import contract from "./lib/paired-recovery-contract.generated.cjs";
import { verifyUploadsRun } from "./restore-uploads.mjs";

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function sameArtifact(left, right) {
  return right.isFile() && right.nlink === 1n && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.ctimeNs === right.ctimeNs && left.mtimeNs === right.mtimeNs;
}

async function readStableArtifact(path, read) {
  const directory = dirname(path);
  if (await realpath(directory) !== directory) throw new Error("backup directory must be physical");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n) throw new Error("backup artifact is not an ordinary file");
    const result = await read(file, before);
    // Use the bytes already consumed through the descriptor, not a second path
    // read. Check that the verified file still belongs to its physical run.
    if (!sameArtifact(before, await file.stat({ bigint: true }))
      || !sameArtifact(before, await lstat(path, { bigint: true }))
      || await realpath(directory) !== directory) {
      throw new Error("backup artifact changed during verification");
    }
    return result;
  } finally {
    await file.close();
  }
}

function readSmallArtifact(path, limit) {
  return readStableArtifact(path, async (file, before) => {
    if (before.size > BigInt(limit)) throw new Error("backup metadata exceeds its limit");
    const bytes = Buffer.alloc(Number(before.size));
    for (let read = 0; read < bytes.length;) {
      const { bytesRead } = await file.read(bytes, read, bytes.length - read, read);
      if (!bytesRead) throw new Error("backup metadata ended early");
      read += bytesRead;
    }
    return bytes;
  });
}

async function requireCustody(root, upload) {
  const path = join(root, "uploads-custody", `${upload.runId}.json`);
  try {
    const custody = JSON.parse(UTF8.decode(await readSmallArtifact(path, 8192)));
    if (!custody || Array.isArray(custody) || Object.keys(custody).length !== 7 || custody.schemaVersion !== 1
      || custody.runId !== upload.runId || custody.storagePath !== upload.storagePath
      || custody.archiveSha256 !== upload.sha256 || custody.manifestSha256 !== upload.manifestSha256
      || custody.pairedPostgresRunId !== upload.pairedPostgresRunId
      || custody.pairedPostgresSha256 !== upload.pairedPostgresSha256) {
      throw new Error("upload custody differs from signed pair");
    }
  } catch (cause) {
    throw new Error("teardown_upload_custody_invalid", { cause });
  }
}

async function requirePostgres(root, postgres) {
  const directory = join(root, postgres.storagePath);
  let digest;
  let sidecar;
  try {
    sidecar = UTF8.decode(await readSmallArtifact(join(directory, "dpf.dump.sha256"), 1024));
    digest = await readStableArtifact(join(directory, "dpf.dump"), async (file) => {
      const hash = createHash("sha256");
      for await (const buffer of file.createReadStream({ autoClose: false })) hash.update(buffer);
      return hash.digest("hex");
    });
  } catch (cause) {
    throw new Error("teardown_postgres_dump_unverified", { cause });
  }
  if (digest !== postgres.sha256 || sidecar !== `${postgres.sha256}  dpf.dump\n`) {
    throw new Error("teardown_postgres_dump_mismatch");
  }
}

export async function verifyPairedTeardownRecovery(evidenceMount, recovery) {
  const receipt = contract.readPairedRecoveryReceipt(recovery?.receipt);
  if (!receipt) throw new Error("teardown_paired_recovery_required");
  if (!contract.pairedRecoveryTrialMatches(receipt, recovery.trial)) throw new Error("teardown_paired_trial_mismatch");
  const root = resolve(evidenceMount);
  if (await realpath(root) !== root) throw new Error("teardown_evidence_root_unverified");
  await requireCustody(root, receipt.uploads);
  await requirePostgres(root, receipt.postgres);
  try {
    await verifyUploadsRun({
      runDir: join(root, receipt.uploads.storagePath),
      expected: {
        pairedPostgresRunId: receipt.postgres.runId,
        pairedPostgresSha256: receipt.postgres.sha256,
        archiveSha256: receipt.uploads.sha256,
        manifestSha256: receipt.uploads.manifestSha256,
      },
    });
  } catch (cause) {
    throw new Error("teardown_upload_archive_unverified", { cause });
  }
  return { receipt, trial: recovery.trial };
}
