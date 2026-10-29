import { sha256 } from './package.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };

export function validatedModelDigest(expected, observed) {
  check(typeof expected === 'string' && /^sha256:[a-f0-9]{64}$/.test(expected) && observed === expected,
    'Selected model digest changed or invalid');
  return expected;
}
export function runnerActivity(rows) {
  const identified = row => typeof row.backend_name === 'string' && row.backend_name.length > 0
    && typeof row.model_name === 'string' && row.model_name.length > 0 && typeof row.mode === 'string' && row.mode.length > 0;
  check(Array.isArray(rows) && !rows.some(row => !row
    || (row.in_use === undefined ? !identified(row) : typeof row.in_use !== 'boolean')
    || (row.loading !== undefined && typeof row.loading !== 'boolean')), 'Runner activity capture unavailable');
  return { idle: rows.every(row => !row.in_use && row.loading !== true),
    loadingFieldObserved: rows.every(row => typeof row.loading === 'boolean') };
}
export function loopbackManagementRoot(value) {
  const url = new URL(value);
  check(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password
    && ['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash,
    'Qualification requires a loopback management root');
  return url.href.replace(/\/$/, '');
}
export function configurationSnapshot(rows, model, digest) {
  check(Array.isArray(rows), 'Configuration capture unavailable'); const modes = new Set();
  return rows.map(row => {
    check(row && row.Backend === 'llama.cpp' && row.Model === model && row.ModelID === digest
      && typeof row.Mode === 'string' && row.Mode.length > 0 && !modes.has(row.Mode)
      && row.Config && typeof row.Config === 'object' && !Array.isArray(row.Config), 'Configuration model identity changed');
    modes.add(row.Mode); return { ...structuredClone(row.Config), model, mode: row.Mode };
  }).sort((a, b) => a.mode.localeCompare(b.mode));
}
export async function configureDrainedCandidate(entries, { readBaselineRunners, writeConfiguration, readConfiguration }) {
  for (const entry of entries) {
    for (const config of entry.original) {
      const rows = await readBaselineRunners();
      check(runnerActivity(rows).idle && rows.length === 0, 'Docker model resident before configure-triggered candidate preload');
      await writeConfiguration(config);
    }
    const observed = configurationSnapshot(await readConfiguration(entry.model), entry.model, entry.digest);
    check(JSON.stringify(entry.original) === JSON.stringify(observed), 'Candidate model configuration changed'); entry.candidate = observed;
  }
}

export const runtimeModelPath = ref => '/models/' + ref.split('/').map(encodeURIComponent).join('/');
export async function captureRuntimeModels({ expected, root, json, recovery = false }) {
  check(Array.isArray(expected) && expected.length === 2, 'Qualified chat and embedding models required');
  return Promise.all(expected.map(async row => {
    const card = await json(root, runtimeModelPath(row.model), { timeout: 3000, recovery });
    validatedModelDigest(row.digest, card.id);
    const configuration = configurationSnapshot(await json(root, '/engines/_configure?model=' + encodeURIComponent(row.model),
      { timeout: 3000, recovery }), row.model, row.digest);
    return { model: row.model, digest: row.digest, modelMetadataSha256: sha256(JSON.stringify(card.config)), configuration };
  }));
}
export async function transferRuntimeModel({ original, candidate, model, digest, request, json, loadArchive }) {
  const response = await request(original + runtimeModelPath(model) + '/export', { timeout: 120000 });
  const loaded = await loadArchive(response.body);
  if (!loaded.ok) throw new Error('Candidate stock model load failed: ' + loaded.status);
  await loaded.arrayBuffer();
  const split = model.lastIndexOf(':');
  if (split <= model.lastIndexOf('/')) throw new Error('Explicit model tag required');
  await request(candidate + runtimeModelPath(digest) + '/tag?repo=' + encodeURIComponent(model.slice(0, split))
    + '&tag=' + encodeURIComponent(model.slice(split + 1)), { method: 'POST', timeout: 30000 });
  const card = await json(candidate, runtimeModelPath(model), { timeout: 3000 });
  validatedModelDigest(digest, card.id);
  return { model, digest, modelMetadataSha256: sha256(JSON.stringify(card.config)), transfer: 'stock-export-load-tag' };
}
