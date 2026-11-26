import { isRecord } from "../shared/coerce";

import { PREVIEW_DATABASE_IDENTITY_SQL, previewLogicalRuntimeId } from "../../../../packages/integration-shared/src/preview-db-identity.cjs";

export { PREVIEW_DATABASE_IDENTITY_SQL, previewLogicalRuntimeId };

export const PREVIEW_DATABASE_PROOF_KEY = "nonprodPreviewDatabaseAttestation";

export type PreviewDatabaseIdentity = {
  systemIdentifier: string;
  databaseOid: string;
  databaseName: string;
  postmasterStartEpoch: string;
};

export type PreviewDatabaseBinding = { leaseId: string; runtimeId: string; sourceSha: string };

export type PreviewDatabaseProof = PreviewDatabaseBinding & {
  schemaVersion: number;
  containerId: string;
  volumeName: string;
  productionSystemIdentifier: string;
  database: PreviewDatabaseIdentity;
};

type QueryPort = { $queryRawUnsafe(sql: string): Promise<unknown> };
type Snapshot = { status: string; progressPayload: Record<string, unknown> };

const systemId = (value: unknown): value is string =>
  typeof value === "string" && /^-?[1-9]\d{0,18}$/.test(value);

function validIdentity(value: unknown): value is PreviewDatabaseIdentity {
  return isRecord(value) && systemId(value.systemIdentifier)
    && typeof value.databaseOid === "string" && /^[1-9]\d{0,9}$/.test(value.databaseOid)
    && typeof value.databaseName === "string" && value.databaseName.length > 0
    && typeof value.postmasterStartEpoch === "string" && /^\d+(\.\d{1,6})?$/.test(value.postmasterStartEpoch);
}

export type PreviewDatabaseObservation = Omit<PreviewDatabaseProof, "productionSystemIdentifier">;

const observationKeys = ["schemaVersion", "leaseId", "runtimeId", "sourceSha", "containerId", "volumeName", "database"];
const identityKeys = ["systemIdentifier", "databaseOid", "databaseName", "postmasterStartEpoch"];

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= max;
}

export function parsePreviewDatabaseObservation(value: unknown): PreviewDatabaseObservation | null {
  if (!isRecord(value) || Object.keys(value).some(key => !observationKeys.includes(key))
    || value.schemaVersion !== 1 || !boundedString(value.leaseId, 128) || !boundedString(value.runtimeId, 128)
    || typeof value.sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(value.sourceSha)
    || typeof value.containerId !== "string" || !/^[0-9a-f]{64}$/.test(value.containerId)
    || !boundedString(value.volumeName, 128) || !validIdentity(value.database)
    || Object.keys(value.database).some(key => !identityKeys.includes(key))
    || !boundedString(value.database.databaseName, 63) || value.database.postmasterStartEpoch.length > 32
    || Buffer.byteLength(JSON.stringify(value), "utf8") > 2048) return null;
  return { schemaVersion: 1, leaseId: value.leaseId, runtimeId: value.runtimeId, sourceSha: value.sourceSha,
    containerId: value.containerId, volumeName: value.volumeName, database: value.database };
}

function epochMicros(epoch: string): bigint {
  const [whole, fraction = ""] = epoch.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function previewProofChange(current: unknown, proof: PreviewDatabaseProof): "unchanged" | "replace" | "stale" {
  if (current === undefined) return "replace";
  if (!isRecord(current) || !validIdentity(current.database)) return "stale";
  const old = current.database;
  if (current.runtimeId === proof.runtimeId && current.leaseId === proof.leaseId
    && current.sourceSha === proof.sourceSha && current.containerId === proof.containerId
    && current.volumeName === proof.volumeName && current.productionSystemIdentifier === proof.productionSystemIdentifier
    && identityKeys.every(key => old[key as keyof PreviewDatabaseIdentity] === proof.database[key as keyof PreviewDatabaseIdentity])) {
    return "unchanged";
  }
  return epochMicros(proof.database.postmasterStartEpoch) > epochMicros(old.postmasterStartEpoch) ? "replace" : "stale";
}

function proofMatches(proof: PreviewDatabaseProof | null, binding: PreviewDatabaseBinding): proof is PreviewDatabaseProof {
  return !!proof && proof.schemaVersion === 1 && !!proof.containerId && !!proof.volumeName
    && !!binding.leaseId && !!binding.runtimeId && /^[0-9a-f]{40}$/.test(binding.sourceSha)
    && proof.leaseId === binding.leaseId && proof.runtimeId === binding.runtimeId && proof.sourceSha === binding.sourceSha
    && systemId(proof.productionSystemIdentifier) && validIdentity(proof.database)
    && proof.productionSystemIdentifier !== proof.database.systemIdentifier;
}

export async function readLeaseOwningSystemIdentifier(tx: QueryPort): Promise<string | null> {
  if (typeof (tx as { $transaction?: unknown }).$transaction === "function") return null;
  try {
    const rows = await tx.$queryRawUnsafe(
      'SELECT system_identifier::text AS "systemIdentifier" FROM pg_catalog.pg_control_system()',
    );
    const value = Array.isArray(rows) && rows.length === 1 ? rows[0]?.systemIdentifier : null;
    return systemId(value) ? value : null;
  } catch {
    return null;
  }
}

/** Use the actual write transaction and open a savepoint before calling.
 * A PostgreSQL read error becomes a refusal here, but may leave the transaction
 * aborted. Roll back to the savepoint on refusal before any further SQL.
 */
export async function matchesPreviewDatabase(input: {
  tx: QueryPort; proof: PreviewDatabaseProof | null; binding: PreviewDatabaseBinding;
}): Promise<boolean> {
  const { tx, proof, binding } = input;
  if (typeof (tx as { $transaction?: unknown }).$transaction === "function" || !proofMatches(proof, binding)) return false;
  try {
    const rows = await tx.$queryRawUnsafe(PREVIEW_DATABASE_IDENTITY_SQL);
    const actual = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    return validIdentity(actual) && actual.systemIdentifier === proof.database.systemIdentifier
      && actual.databaseOid === proof.database.databaseOid && actual.databaseName === proof.database.databaseName
      && actual.postmasterStartEpoch === proof.database.postmasterStartEpoch;
  } catch {
    return false;
  }
}

export async function publishPreviewDatabaseAttestation(input: {
  proof: PreviewDatabaseProof; binding: PreviewDatabaseBinding;
  read: () => Promise<Snapshot | null>;
  compareAndSet: (snapshot: Snapshot, payload: Record<string, unknown>) => Promise<boolean>;
}): Promise<boolean> {
  if (!proofMatches(input.proof, input.binding)) return false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await input.read();
    const wait = snapshot?.progressPayload.nonprodLeaseWait;
    if (!snapshot || snapshot.status !== "completed" || !isRecord(wait) || wait.state !== "admitted") return false;
    if (await input.compareAndSet(snapshot, { ...snapshot.progressPayload, [PREVIEW_DATABASE_PROOF_KEY]: input.proof })) return true;
  }
  return false;
}

/** No setup is authorized until the verified installation join is implemented. */
export function authorizePreviewSetup(): boolean {
  return false;
}
