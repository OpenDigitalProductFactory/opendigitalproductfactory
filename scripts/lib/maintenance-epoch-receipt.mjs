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


const INSPECT_TEMPLATE = '{"Id":{{json .Id}},"State":{"Running":{{json .State.Running}},"StartedAt":{{json .State.StartedAt}}},"Config":{"Labels":{{json .Config.Labels}}}}';
const observationInvalid = () => { throw new Error("maintenance_epoch_observation_unavailable"); };

/** Read-only observer. It never starts, stops, signals or removes a container. */
export async function observeMaintenanceEnvironments({ project, runDocker }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(project)) observationInvalid();
  const daemonId = (await runDocker(['info', '--format', '{{.ID}}'])).trim();
  const inventory = (await runDocker(['ps', '--all', '--no-trunc', '--format', '{{.ID}}'])).trim().split(/\r?\n/).filter(Boolean);
  if (!inventory.length || inventory.length > 10_000 || inventory.some(id => !/^[a-f0-9]{64}$/.test(id))
    || new Set(inventory).size !== inventory.length) observationInvalid();
  const environments = {};
  // Inspect only this project's candidate services; inventory remains complete
  // for proving removal. Do not load Docker Config.Env or other secret fields.
  const projectIds = (await runDocker(['ps', '--all', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`,
    '--format', '{{.ID}}'])).trim().split(/\r?\n/).filter(Boolean);
  for (const id of projectIds) {
    if (!inventory.includes(id)) observationInvalid();
    const raw = await runDocker(['inspect', '--type', 'container', '--format', INSPECT_TEMPLATE, id]);
    // The executable prints a bounded JSON projection (not the environment).
    let inspected;
    try { inspected = JSON.parse(raw); } catch { observationInvalid(); }
    const service = inspected.Config?.Labels?.['com.docker.compose.service'];
    if (!SERVICES.includes(service)) continue;
    if (environments[service] || inspected.Id !== id || inspected.State?.Running !== true
      || inspected.Config.Labels['com.docker.compose.project'] !== project) observationInvalid();
    environments[service] = { id, startedAt: inspected.State.StartedAt };
  }
  if (!SERVICES.every(service => environments[service])) observationInvalid();
  // A daemon switch during the multi-call observation invalidates the snapshot.
  if ((await runDocker(['info', '--format', '{{.ID}}'])).trim() !== daemonId) observationInvalid();
  return { daemonId, environments, inventory: inventory.sort() };
}


/** Existing canonical launchers name rollback-capable actuators dpf-promoter-*.
 * Final portal/sandbox retirement alone does not prove those actuators exited. */
export async function assertNoCanonicalActuators({ runDocker }) {
  const output = await runDocker(['ps', '--no-trunc', '--filter', 'name=dpf-promoter', '--format', '{{.ID}}']);
  if (output.trim()) observationInvalid();
}
