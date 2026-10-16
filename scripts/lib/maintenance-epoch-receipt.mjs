import { canonicalJson } from './canonical-json.mjs';
import { signTransitionPayload, verifyTransitionSignature } from './transition-signing.mjs';

const HEX = /^[a-f0-9]{64}$/;
const refuse = () => { throw new Error('maintenance_epoch_evidence_invalid'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0;
const SERVICES = ['portal', 'sandbox'];
const BASE_KEYS = ['schemaVersion', 'runId', 'targetSha', 'promoterDigest', 'recoveryPointDigest', 'project', 'daemonId', 'capturedAt', 'before'];
const FINAL_KEYS = [...BASE_KEYS, 'completedAt', 'after', 'retiredContainerIds', 'inventoryDigest'];

function validatePayload(value, expected, checkpoint) {
  if (!exact(value, checkpoint ? BASE_KEYS : FINAL_KEYS) || value.schemaVersion !== 1
    || !/^SUR-[A-Za-z0-9-]{1,100}$/.test(value.runId)
    || !/^[a-f0-9]{40}$/.test(value.targetSha) || !/^sha256:[a-f0-9]{64}$/.test(value.promoterDigest)
    || !HEX.test(value.recoveryPointDigest) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value.project)
    || !/^[a-zA-Z0-9:_-]{1,100}$/.test(value.daemonId) || !time(value.capturedAt)) refuse();
  for (const key of ['runId', 'targetSha', 'promoterDigest', 'recoveryPointDigest']) {
    if (value[key] !== expected[key]) refuse();
  }
  const now = expected.now;
  if (!Number.isFinite(now) || Date.parse(value.capturedAt) > now) refuse();
  const validEpoch = (epochs, lower, upper) => exact(epochs, SERVICES) && SERVICES.every(service => {
    const epoch = epochs[service];
    return exact(epoch, ['id', 'startedAt']) && HEX.test(epoch.id) && time(epoch.startedAt)
      && Date.parse(epoch.startedAt) >= lower && Date.parse(epoch.startedAt) <= upper;
  });
  if (!validEpoch(value.before, 1, Date.parse(value.capturedAt)) || value.before.portal.id === value.before.sandbox.id) refuse();
  if (checkpoint) return value;
  const start = Date.parse(value.capturedAt), end = Date.parse(value.completedAt);
  if (!time(value.completedAt) || end < start || end > now || end - start > 2 * 60 * 60_000
    || !validEpoch(value.after, start, end) || !HEX.test(value.inventoryDigest)) refuse();
  const oldIds = SERVICES.map(service => value.before[service].id).sort();
  const allIds = [...oldIds, ...SERVICES.map(service => value.after[service].id)];
  if (new Set(allIds).size !== 4 || !Array.isArray(value.retiredContainerIds)
    || canonicalJson(value.retiredContainerIds) !== canonicalJson(oldIds)) refuse();
  return value;
}

// A canonical string leaf binds all nested bytes with the existing shared signer.
// Domain separation prevents reuse as a runtime capability/migration envelope.
export function signMaintenanceEpoch(payload, secret, checkpoint = false) {
  const unsigned = { version: 1, kind: checkpoint ? 'maintenance-epoch-checkpoint' : 'maintenance-epoch-retirement', payload: canonicalJson(payload) };
  return { ...unsigned, signature: signTransitionPayload(unsigned, secret) };
}

export function verifyMaintenanceEpoch(envelope, secret, expected, checkpoint = false) {
  if (!exact(envelope, ['version', 'kind', 'payload', 'signature']) || envelope.version !== 1
    || envelope.kind !== (checkpoint ? 'maintenance-epoch-checkpoint' : 'maintenance-epoch-retirement')
    || typeof envelope.payload !== 'string' || envelope.payload.length > 16_384
    || typeof envelope.signature !== 'string') refuse();
  const { signature, ...unsigned } = envelope;
  verifyTransitionSignature(unsigned, signature, secret);
  let payload;
  try { payload = JSON.parse(envelope.payload); } catch { refuse(); }
  if (canonicalJson(payload) !== envelope.payload) refuse();
  return validatePayload(payload, expected, checkpoint);
}
