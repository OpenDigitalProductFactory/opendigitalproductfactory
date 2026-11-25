import { acquireRestoreLock, RestoreIntegrityError } from "./managed-restore";
import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import {
  advanceRestoreJournal,
  listRestoreFileIntents,
  listUnfinishedRestoreJournals,
  markRestoreFilePublished,
  prepareRestoreJournal,
  readRestoreJournal,
  recordRestoreFileIntent,
  selectRestoreSafetyPair,
  type RestoreFileIntent,
  type RestoreFileReceipt,
  type RestoreJournalIntent,
  type RestoreJournalPair,
  type RestoreJournalReceipt,
} from "./paired-restore-journal";
import {
  assertCoveredUploadCollisions,
  digestUploadDestinationInspection,
  inspectRestoreUploadDestinations,
  publishRestoreUploadFile,
  type RestoreUploadInspection,
  type RestoreUploadMember,
} from "./restore-upload-destinations";
import { applyVerifiedPairedPostgres, validatePairedRestoreArtifacts, withPairedRestoreArchive } from "./paired-restore-artifacts";

type PairMode = RestoreJournalReceipt["mode"];
type RestoreRequest = { kind: "start" } | { kind: "resume" | "safety"; confirmed: RestoreJournalPair };

export interface ManagedPairedRestoreEffects {
  /** Drain writers before new effects and reclaim the operation's fence on restart. */
  bindWriterFence(operationId: string): Promise<void>;
  /** Verify both pairs and the approved receiver/collisions, and create the safety pair. */
  prepare(): Promise<RestoreJournalIntent>;
  /** Revalidate the exact artifacts and receiver, including any partial publication. */
  verifyRecovery(receipt: RestoreJournalReceipt, pair: RestoreJournalPair, mode: PairMode): Promise<void>;
  /** A pending Postgres phase may be replayed after an uncertain prior execution. */
  restorePostgres(pair: RestoreJournalPair, receipt: RestoreJournalReceipt): Promise<void>;
  /** Verify all bytes after publication. Replay must respect persisted per-file intents. */
  restoreUploads(pair: RestoreJournalPair, receipt: RestoreJournalReceipt): Promise<void>;
  /** Reflect durable evidence in the restored database. Replaying must be safe. */
  projectResult(receipt: RestoreJournalReceipt): Promise<void>;
  /** Release only this operation's fence. Failure must not release any other operation. */
  finishFence(operationId: string): Promise<void>;
}

function samePair(a: RestoreJournalPair, b: RestoreJournalPair): boolean {
  return a.postgres.runId === b.postgres.runId && a.postgres.storagePath === b.postgres.storagePath
    && a.postgres.sha256 === b.postgres.sha256 && a.uploads.runId === b.uploads.runId
    && a.uploads.storagePath === b.uploads.storagePath && a.uploads.sha256 === b.uploads.sha256
    && a.uploads.manifestSha256 === b.uploads.manifestSha256;
}

export async function runManagedPairedRestore(
  args: { backupsRoot: string; operationId: string; request: RestoreRequest },
  effects: ManagedPairedRestoreEffects,
): Promise<RestoreJournalReceipt> {
  const { backupsRoot, operationId, request } = args;
  const release = acquireRestoreLock(operationId);
  try {
    const unfinished = await listUnfinishedRestoreJournals(backupsRoot);
    if (unfinished.some((operation) => request.kind === "start" || operation.operationId !== operationId)) {
      throw new RestoreIntegrityError("Resolve the unfinished paired restore before starting another.");
    }

    let receipt: RestoreJournalReceipt;
    if (request.kind === "start") {
      await effects.bindWriterFence(operationId);
      let verified;
      try {
        verified = await effects.prepare();
        if (verified.operationId !== operationId) throw new RestoreIntegrityError("Paired restore operation identity changed.");
      } catch (error) {
        // No journal or restore effects have started. Once prepareRestoreJournal
        // is attempted, even an error may have left durable evidence to inspect.
        await effects.finishFence(operationId);
        throw error;
      }
      receipt = await prepareRestoreJournal(backupsRoot, verified);
    } else {
      receipt = await readRestoreJournal(backupsRoot, operationId);
      const mode = request.kind === "safety" ? "safety" : receipt.mode;
      const expected = receipt[mode];
      if (!samePair(request.confirmed, expected)) {
        throw new RestoreIntegrityError("The confirmed pair does not match the unfinished host restore journal.");
      }
      if (receipt.stage === "completed" && request.kind === "safety") {
        throw new RestoreIntegrityError("The completed operation cannot switch to its safety pair.");
      }
      await effects.bindWriterFence(operationId);
      await effects.verifyRecovery(receipt, expected, mode);
      if (request.kind === "safety" && receipt.mode !== "safety") {
        receipt = await selectRestoreSafetyPair(backupsRoot, operationId, expected);
      }
    }

    if (receipt.stage === "prepared") {
      receipt = await advanceRestoreJournal(backupsRoot, operationId, "prepared", "postgres-started");
    }
    if (receipt.stage === "postgres-started") {
      await effects.restorePostgres(receipt[receipt.mode], receipt);
      receipt = await advanceRestoreJournal(backupsRoot, operationId, "postgres-started", "postgres-restored");
    }
    if (receipt.stage === "postgres-restored") {
      receipt = await advanceRestoreJournal(backupsRoot, operationId, "postgres-restored", "uploads-started");
    }
    if (receipt.stage === "uploads-started") {
      await effects.restoreUploads(receipt[receipt.mode], receipt);
      receipt = await advanceRestoreJournal(backupsRoot, operationId, "uploads-started", "uploads-restored");
    }
    if (receipt.stage === "uploads-restored") {
      await effects.projectResult(receipt);
      receipt = await advanceRestoreJournal(backupsRoot, operationId, "uploads-restored", "completed");
    }
    await effects.finishFence(operationId);
    return receipt;
  } finally {
    release();
  }
}

type Observations = RestoreUploadInspection["entries"];
const key = (root: string, path: string) => JSON.stringify([root, path]);

function sameExpected(file: RestoreFileReceipt, observed: string | null, desired: string | null): boolean {
  return file.afterSha256 === desired && (observed === desired || (file.stage === "pending" && observed === file.beforeSha256));
}

function intent(file: Observations[number], beforeSha256: string | null, afterSha256: string | null): RestoreFileIntent {
  return { rootName: file.root, relativePath: file.path, beforeSha256, afterSha256 };
}

export function planSelectedUploads(
  current: Observations, alreadyAttempted: RestoreFileReceipt[], approvedCollisionSetSha256: string,
): RestoreFileIntent[] {
  const prior = new Map(alreadyAttempted.map((file) => [key(file.rootName, file.relativePath), file]));
  const original = current.map((file) => {
    const memberKey = key(file.root, file.path);
    const evidence = prior.get(memberKey);
    if (!evidence) return file;
    if (!sameExpected(evidence, file.observedSha256, file.sha256)) {
      throw new RestoreIntegrityError("A journaled upload destination changed during restore.");
    }
    prior.delete(memberKey);
    return { ...file, observedSha256: evidence.beforeSha256 };
  });
  if (prior.size || digestUploadDestinationInspection(original) !== approvedCollisionSetSha256) {
    throw new RestoreIntegrityError("The receiving uploads do not match the approved collision set.");
  }
  return original.filter((file) => file.observedSha256 !== file.sha256).map((file) => intent(file, file.observedSha256, file.sha256));
}

export function planSafetyUploads(
  safetyFiles: Observations,
  createdBySelected: Observations,
  selectedIntents: RestoreFileReceipt[],
  safetyIntents: RestoreFileReceipt[],
): RestoreFileIntent[] {
  const selected = new Map(selectedIntents.map((file) => [key(file.rootName, file.relativePath), file]));
  const safety = new Map(safetyIntents.map((file) => [key(file.rootName, file.relativePath), file]));
  const out: RestoreFileIntent[] = [];
  for (const file of safetyFiles) {
    const memberKey = key(file.root, file.path);
    const forward = selected.get(memberKey);
    const prior = safety.get(memberKey);
    if (forward && forward.beforeSha256 !== file.sha256) {
      throw new RestoreIntegrityError("A journaled original is missing from the verified safety pair.");
    }
    if (prior) {
      if (!forward || prior.beforeSha256 !== forward.afterSha256 || !sameExpected(prior, file.observedSha256, file.sha256)) {
        throw new RestoreIntegrityError("A safety restore destination changed during recovery.");
      }
      safety.delete(memberKey);
      out.push(intent(file, prior.beforeSha256, file.sha256));
    } else if (file.observedSha256 !== file.sha256) {
      if (!forward || file.observedSha256 !== forward.afterSha256) {
        throw new RestoreIntegrityError("An unaccounted-for safety destination changed.");
      }
      out.push(intent(file, file.observedSha256, file.sha256));
    }
    selected.delete(memberKey);
  }

  for (const file of createdBySelected) {
    const memberKey = key(file.root, file.path);
    const created = selected.get(memberKey);
    const prior = safety.get(memberKey);
    if (!created || created.beforeSha256 !== null || created.afterSha256 !== file.sha256) {
      throw new RestoreIntegrityError("Safety restore cannot delete an upload not created by this operation.");
    }
    if (prior) {
      if (prior.beforeSha256 !== file.sha256 || !sameExpected(prior, file.observedSha256, null)) {
        throw new RestoreIntegrityError("An upload changed during safety cleanup.");
      }
      safety.delete(memberKey);
      out.push(intent(file, file.sha256, null));
    } else if (file.observedSha256 !== null) {
      if (file.observedSha256 !== file.sha256) throw new RestoreIntegrityError("An upload created by the selected restore changed.");
      out.push(intent(file, file.sha256, null));
    } else if (created.stage === "published") {
      throw new RestoreIntegrityError("An upload created by the selected restore disappeared before safety cleanup.");
    }
    selected.delete(memberKey);
  }
  if (selected.size || safety.size) throw new RestoreIntegrityError("Safety restore does not account for all journaled upload changes.");
  return out;
}

type ArchiveRestoreArgs = {
  backupsRoot: string;
  operationId: string;
  installationId: string;
  request: RestoreRequest;
  readerPath?: string;
  postgresScriptPath?: string;
};

type ArchiveRestoreBoundary = Pick<ManagedPairedRestoreEffects, "bindWriterFence" | "finishFence" | "projectResult" | "prepare">;

function checkRootIsolation(backupsRoot: string, receiver: RestoreJournalIntent["receiver"]): void {
  if (receiver.some(({ path }) => path === backupsRoot || path.startsWith(backupsRoot + sep) || backupsRoot.startsWith(path + sep))) {
    throw new RestoreIntegrityError("Receiving upload roots must be outside the backup and recovery-journal store.");
  }
}

function checkArchiveRoots(receipt: RestoreJournalIntent, rootNames: string[]): void {
  if (rootNames.some((name) => !receipt.receiver.some((root) => root.name === name))) {
    throw new RestoreIntegrityError("The archive names an upload root that is not configured on the receiver.");
  }
}

async function prepareUploadPublication(
  backupsRoot: string, receipt: RestoreJournalReceipt, mode: PairMode, members: readonly RestoreUploadMember[],
): Promise<RestoreFileIntent[]> {
  const selected = await listRestoreFileIntents(backupsRoot, receipt.operationId, "selected");
  if (mode === "selected") {
    const current = await inspectRestoreUploadDestinations(receipt.receiver, members);
    return planSelectedUploads(current.entries, selected, receipt.collisionSetSha256);
  }

  const safety = await listRestoreFileIntents(backupsRoot, receipt.operationId, "safety");
  const created = selected.flatMap((file) => file.beforeSha256 === null && file.afterSha256 !== null
    ? [{ root: file.rootName, path: file.relativePath, sha256: file.afterSha256 }] : []);
  const createdKeys = new Set(created.map((file) => key(file.root, file.path)));
  const current = await inspectRestoreUploadDestinations(receipt.receiver, [...members, ...created]);
  const originalEntries = current.entries.filter((file) => !createdKeys.has(key(file.root, file.path)));
  const createdEntries = current.entries.filter((file) => createdKeys.has(key(file.root, file.path)));
  return planSafetyUploads(originalEntries, createdEntries, selected, safety);
}

/**
 * Filesystem/Postgres implementation of the managed lifecycle. Its caller
 * owns the installation's writer drain, confirmation and audit projection.
 */
export async function runManagedPairedArchiveRestore(
  args: ArchiveRestoreArgs, boundary: ArchiveRestoreBoundary,
): Promise<RestoreJournalReceipt> {
  const backupsRoot = await realpath(args.backupsRoot);
  const source = (pair: RestoreJournalPair) => ({ backupsRoot, pair, readerPath: args.readerPath });
  return runManagedPairedRestore({ ...args, backupsRoot }, {
    ...boundary,
    async prepare() {
      const intent = await boundary.prepare();
      if (args.installationId !== intent.installationId) throw new RestoreIntegrityError("Receiving installation identity changed.");
      checkRootIsolation(backupsRoot, intent.receiver);
      const [selected, safety] = await Promise.all([
        validatePairedRestoreArtifacts(source(intent.selected)), validatePairedRestoreArtifacts(source(intent.safety)),
      ]);
      checkArchiveRoots(intent, selected.rootNames);
      checkArchiveRoots(intent, safety.rootNames);
      const observed = await inspectRestoreUploadDestinations(intent.receiver, selected.members);
      if (observed.collisionSetSha256 !== intent.collisionSetSha256) {
        throw new RestoreIntegrityError("The receiving uploads do not match the approved collision set.");
      }
      assertCoveredUploadCollisions(observed, safety.members);
      return intent;
    },
    async verifyRecovery(receipt, pair, mode) {
      if (args.installationId !== receipt.installationId) throw new RestoreIntegrityError("Receiving installation identity changed.");
      checkRootIsolation(backupsRoot, receipt.receiver);
      const { rootNames, members } = await validatePairedRestoreArtifacts(source(pair));
      checkArchiveRoots(receipt, rootNames);
      await prepareUploadPublication(backupsRoot, receipt, mode, members);
    },
    async restorePostgres(_pair, receipt) {
      await applyVerifiedPairedPostgres(backupsRoot, receipt, args.postgresScriptPath);
    },
    async restoreUploads(pair, receipt) {
      await withPairedRestoreArchive(source(pair), async ({ rootNames, members, readPayload }) => {
        checkArchiveRoots(receipt, rootNames);
        const writes = await prepareUploadPublication(backupsRoot, receipt, receipt.mode, members);
        const byPath = new Map(members.map((file) => [key(file.root, file.path), file]));
        for (const file of writes) {
          const root = receipt.receiver.find(({ name }) => name === file.rootName)!;
          const member = byPath.get(key(file.rootName, file.relativePath));
          await recordRestoreFileIntent(backupsRoot, receipt.operationId, receipt.mode, file);
          const verified = await publishRestoreUploadFile(root, file, member && { sizeBytes: member.sizeBytes, content: readPayload(member) });
          await markRestoreFilePublished(backupsRoot, receipt.operationId, receipt.mode, file, verified);
        }
      });
    },
  });
}
