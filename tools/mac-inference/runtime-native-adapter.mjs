import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, rename, lstat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { canonicalJson } from '../../scripts/lib/canonical-json.mjs';
import { protectedDirectory, protectedRead } from '../../scripts/installer/recovery-filesystem.mjs';
import { hashFile, sha256 } from './package.mjs';
import { readStagedRuntimeDescriptor, servingProfileDigest } from './runtime-installation.mjs';
import { requireTransitionAuthority } from './runtime-authority.mjs';
import { RUNTIME_LOCK, verifyRuntimePackage, verifyRuntimeQualification } from './runtime-profile.mjs';
import { configureDrainedCandidate, configurationSnapshot, loopbackManagementRoot, runnerActivity, validatedModelDigest,
  transferRuntimeModel, runtimeModelPath, captureRuntimeModels } from './runtime-model-store.mjs';
import { createRuntimeLaunchAgent, renderRuntimeLaunchAgent, renderManagedRuntimeLaunchAgent,
  ownedRuntimeProcesses, launchctl, parseLaunchAgentStatus } from './runtime-launchagent.mjs';

const execute = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw new Error(message); };
async function directory(parent, name, fresh = false) {
  const path = join(parent, name);
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (fresh || error.code !== 'EEXIST') throw error; }
  return protectedDirectory(path);
}
async function privateWrite(path, value) {
  try { await protectedRead(path); } catch (error) {
    // protectedRead deliberately sanitizes its errors; only a separate ENOENT
    // observation permits creating a new file. A symlink is never replaced.
    const exists = await lstat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (exists) throw error;
  }
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(canonicalJson(value)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const parent = await open(dirname(path), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
async function userLaunchAgentsDirectory(path, create = false) {
  if (create) {
    try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  for (let at = path; ; at = dirname(at)) {
    const stat = await lstat(at);
    check(stat.isDirectory() && !stat.isSymbolicLink() && (stat.uid === 0 || stat.uid === process.getuid())
      && ((stat.mode & 0o022) === 0 || (stat.uid === 0 && (stat.mode & 0o1000))), 'Native LaunchAgents directory ownership unsafe');
    if (at === dirname(at)) break;
  }
  return path;
}

export function verifyOwnedRuntimeListener(text, daemonPid) {
  let pid; const listeners = [];
  for (const line of String(text).split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n')) listeners.push({ pid, address: line.slice(1) });
  }
  check(Number.isSafeInteger(daemonPid) && daemonPid > 0 && listeners.length === 1
    && listeners[0].pid === daemonPid && listeners[0].address === '127.0.0.1:12436', 'Native listener ownership unconfirmed');
  return true;
}

export function verifyMappedRuntimeFiles(text, { daemonPid, allowedPids, runnerPath, runnerInode, enginePath, engineInode }) {
  const records = []; let pid, file;
  const finish = () => { if (file) records.push({ pid, ...file }); file = null; };
  for (const line of String(text).split('\n')) {
    if (line.startsWith('p')) { finish(); pid = Number(line.slice(1)); }
    else if (line.startsWith('f')) { finish(); file = {}; }
    else if (line.startsWith('i') && file) file.inode = line.slice(1);
    else if (line.startsWith('n') && file) file.path = line.slice(1);
  }
  finish();
  check(Number.isSafeInteger(daemonPid) && allowedPids.includes(daemonPid)
    && records.some(row => row.pid === daemonPid && row.path === runnerPath && row.inode === String(runnerInode)),
  'Active runner mapped executable identity unconfirmed');
  const enginePids = [...new Set(records.filter(row => allowedPids.includes(row.pid) && row.pid !== daemonPid
    && row.path === enginePath && row.inode === String(engineInode)).map(row => row.pid))].sort((a, b) => a - b);
  check(enginePids.length > 0, 'Active engine mapped executable identity unconfirmed');
  return { daemonPid, enginePids };
}

/** Fixed Mac host adapter. All paths/listeners derive from native installer
 * configuration or verified release/action identities, never request paths. */
export function createNativeRuntimeAdapter({ authority, stateDirectory, baselineEngine,
  baselineRoot = 'http://127.0.0.1:12434', platform = process.platform, architecture = process.arch,
  fetchImpl = fetch, run = execute, serviceFactory = createRuntimeLaunchAgent,
  signal,
  launchAgentsDirectory = join(homedir(), 'Library', 'LaunchAgents'),
  processes = ownedRuntimeProcesses, delay = pause,
  observeManaged = async () => parseLaunchAgentStatus(await launchctl(['print', 'gui/' + process.getuid() + '/local.dpf-inference.managed'])) }) {
  authority = requireTransitionAuthority(authority);
  const action = authority.action;
  const { version, operation, leaseId, ...binding } = action.parameters;
  const original = loopbackManagementRoot(baselineRoot), candidate = 'http://127.0.0.1:12436';
  const abort = new AbortController();
  let descriptor, home, mutable, finite, permanent, projectionTimer, projectionPending, leaseFile, priorNative;
  let permanentPlistPath, permanentPlistContents;
  let finitePid, permanentPid;
  let finiteStopped = false, permanentStopped = false;
  const assertCurrent = async () => {
    check(!abort.signal.aborted, 'Native transition authority fenced'); return authority.assertCurrent();
  };
  const request = async (url, { method, body, rawBody, timeout = 30000, recovery = false } = {}) => {
    check(recovery || !signal?.aborted, 'Native transition cancelled');
    await assertCurrent();
    const remaining = Date.parse(action.expiresAt) - Date.now();
    check(remaining > 0, 'Native action expired');
    const response = await fetchImpl(url, { method: method ?? (body === undefined && rawBody === undefined ? 'GET' : 'POST'),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, Math.min(timeout, remaining))),
        ...(!recovery && signal ? [signal] : [])]),
      ...(rawBody === undefined ? body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : { headers: { 'content-type': 'application/x-tar' }, body: rawBody, duplex: 'half' }) });
    check(response.ok, 'Native runtime HTTP ' + response.status + ' at ' + new URL(url).pathname);
    return response;
  };
  const json = async (root, path, options) => (await request(root + path, options)).json();
  const baselineRows = async (recovery = false) => {
    const rows = await json(original, '/engines/ps', { timeout: 3000, recovery }); runnerActivity(rows); return rows;
  };
  const requireEmptyBaseline = async () => check((await baselineRows()).length === 0, 'Docker model resident during native candidate window');
  const currentModels = (expected, recovery = false) => captureRuntimeModels({ expected, root: original, json, recovery });
  const loadedModels = async (rows, models, recovery = false) => {
    check(rows.length <= 2 && runnerActivity(rows).idle, 'Baseline runner activity is busy or ambiguous');
    const result = [];
    for (const row of rows) {
      check(row.backend_name === 'llama.cpp', 'Unrelated baseline backend resident');
      const card = await json(original, runtimeModelPath(row.model_name), { timeout: 3000, recovery });
      const identity = card.id;
      const matches = models.filter(model => model.digest === identity && model.configuration.some(config => config.mode === row.mode));
      check(matches.length === 1 && !result.some(value => value.digest === identity), 'Unrelated or duplicate baseline model identity resident');
      result.push({ model: matches[0].model, digest: identity, mode: row.mode, observedRef: row.model_name });
    }
    return result;
  };
  const reverify = async () => {
    await assertCurrent();
    const actual = await verifyRuntimePackage(descriptor.packageRoot);
    check(actual.manifestSha256 === binding.runtimeManifestSha256, 'Native package identity changed before launch');
    check(await hashFile(baselineEngine) === binding.baselineEngineSha256, 'Baseline executable identity changed');
  };
  const projectLease = async () => {
    const admitted = await assertCurrent();
    await privateWrite(leaseFile, { schemaVersion: 1, leaseId: admitted.leaseId, ownerSessionId: admitted.ownerSessionId,
      branchName: admitted.branchName, status: 'active', phase: 'running', expiresAt: admitted.expiresAt });
  };
  const endProjection = async () => {
    clearInterval(projectionTimer); projectionTimer = undefined;
    if (projectionPending) await projectionPending.catch(() => {});
  };
  const ready = async () => {
    for (let n = 0; n < 30; n++) {
      try { await request(candidate + '/', { timeout: 1000 }); return; }
      catch { await assertCurrent(); if (abort.signal.aborted) throw abort.signal.reason; }
      await delay(200);
    }
    throw new Error('Native management readiness unconfirmed');
  };
  const ownedListener = async daemonPid => {
    for (let n = 0; n < 30; n++) {
      await assertCurrent();
      try {
        const result = await run('/usr/sbin/lsof', ['-nP', '-a', '-iTCP:12436', '-sTCP:LISTEN', '-F', 'pn'], { timeout: 3000 });
        verifyOwnedRuntimeListener(result.stdout, daemonPid); return;
      } catch { await assertCurrent(); }
      await delay(200);
    }
    throw new Error('Native listener ownership unconfirmed');
  };
  const ownershipPath = () => join(home, 'managed-service.json');
  const readOwnership = async expectedActionKey => {
    const value = JSON.parse((await protectedRead(ownershipPath())).toString());
    check(value.schemaVersion === 1 && value.status === 'active' && value.actionKey === expectedActionKey
      && value.label === 'local.dpf-inference.managed' && value.program === join(descriptor.packageRoot, 'bin/dmr')
      && value.runtimeManifestSha256 === binding.runtimeManifestSha256
      && value.qualificationReportSha256 === binding.qualificationReportSha256 && value.port === 12436,
    'Native service ownership changed');
    return value;
  };
  const newService = (label, plistPath, stateRoot, readExistingOwnership) => serviceFactory({
    label, program: join(descriptor.packageRoot, 'bin/dmr'), plistPath, stateRoot, workspaceRoot: home,
    readAuthority: assertCurrent, runtimeManifestSha256: binding.runtimeManifestSha256,
    ...(readExistingOwnership ? { readExistingOwnership } : {}), processes,
  });
  const permanentContents = (owned, stateRoot) => renderManagedRuntimeLaunchAgent({ label: owned.label,
    packageRoot: descriptor.packageRoot, stateRoot, port: 12436, selection: owned, ...binding });
  const removeOwnedStartup = async () => {
    if (!permanentPlistPath) return;
    let bytes;
    try { bytes = await protectedRead(permanentPlistPath); } catch (error) {
      const exists = await lstat(permanentPlistPath).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (!exists) return;
      throw error;
    }
    check(sha256(bytes) === sha256(permanentPlistContents), 'Refusing to remove an unowned native startup entry');
    await unlink(permanentPlistPath);
    const parent = await open(dirname(permanentPlistPath), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  };
  const verifyConfiguration = async models => {
    for (const model of models) {
      const seen = configurationSnapshot(await json(candidate, '/engines/_configure?model=' + encodeURIComponent(model.model), { timeout: 3000 }), model.model, model.digest);
      check(canonicalJson(seen) === canonicalJson(model.configuration), 'Native model configuration changed');
      const card = await json(candidate, runtimeModelPath(model.model), { timeout: 3000 });
      validatedModelDigest(model.digest, card.id);
      check(sha256(JSON.stringify(card.config)) === model.modelMetadataSha256, 'Native model/projector metadata changed');
    }
  };
  const verifyIdentity = async daemonPid => {
    await reverify();
    const version = await (await request(candidate + '/version', { timeout: 3000 })).text();
    check(version.includes(RUNTIME_LOCK.packageVersion), 'Active native runner version changed');
    const engines = await json(candidate, '/engines/status', { timeout: 3000 });
    const suffix = descriptor.runtime.engine.manifest.source.commit.slice(0, 7) + '-' + RUNTIME_LOCK.engineVersion.replace(/^b\d+-/, '');
    check(typeof engines['llama.cpp'] === 'string' && engines['llama.cpp'].startsWith('Running:')
      && engines['llama.cpp'].includes(suffix), 'Active native engine identity changed');
    check(Object.entries(engines).every(([name, status]) => name === 'llama.cpp' || !String(status).startsWith('Running:')), 'Unexpected native backend active');
    const observed = await processes(home), descendants = new Set([daemonPid]);
    for (let n = 0; n <= observed.length; n++) {
      for (const row of observed) if (descendants.has(row.parentPid)) descendants.add(row.pid);
    }
    const allowedPids = [...descendants];
    check(allowedPids.every(pid => Number.isSafeInteger(pid) && pid > 0), 'Native process identity unavailable');
    const runnerPath = join(descriptor.packageRoot, 'bin/dmr'), enginePath = join(descriptor.packageRoot, 'engine/bin/llama-server');
    const mapping = await run('/usr/sbin/lsof', ['-a', '-p', allowedPids.join(','), '-d', 'txt', '-F', 'pfin'], { timeout: 5000 });
    const mapped = verifyMappedRuntimeFiles(mapping.stdout, { daemonPid, allowedPids, runnerPath,
      runnerInode: (await lstat(runnerPath)).ino, enginePath, engineInode: (await lstat(enginePath)).ino });
    return { ...mapped, runtimeManifestSha256: binding.runtimeManifestSha256,
      engineManifestSha256: descriptor.runtime.engine.manifestSha256, executableSha256: await hashFile(enginePath) };
  };
  const adapter = {
    fence() { abort.abort(new Error('Native transition authority fenced by its parent')); },
    async preflight() {
      await assertCurrent(); check(platform === 'darwin' && architecture === 'arm64', 'Physical Mac runtime unqualified');
      const state = JSON.parse((await protectedRead(join(stateDirectory, 'install-state.json'))).toString());
      check(state.platform === 'darwin' && state.arch === 'arm64', 'Native installation platform changed');
      const hardware = JSON.parse((await run('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 15000 })).stdout);
      const physicalDevice = hardware.SPDisplaysDataType?.[0]?.sppci_model;
      check(physicalDevice === RUNTIME_LOCK.initialQualifiedDevice, 'Physical device is not qualified');
      descriptor = await readStagedRuntimeDescriptor({ stateDirectory, binding, hostNodeId: action.nodeId });
      const report = JSON.parse(descriptor.reportBytes.toString());
      const models = await currentModels(report.models);
      check(servingProfileDigest({ models, physicalDevice }) === binding.profileSha256, 'Current serving profile changed');
      verifyRuntimeQualification({ reportBytes: descriptor.reportBytes, expectedReportSha256: binding.qualificationReportSha256,
        runtime: descriptor.runtime, models, physicalDevice });
      await reverify(); home = await protectedDirectory(join(stateDirectory, 'mac-inference'));
      let captured;
      if (operation === 'activate') {
        check(!(await observeManaged()).exists && (await processes(home)).length === 0, 'Existing native runtime ownership occupied');
        captured = { models, physicalDevice, baselineEngineSha256: binding.baselineEngineSha256,
          loadedModels: await loadedModels(await baselineRows(), models) };
      } else {
        priorNative = state.managedInference;
        check(priorNative?.mode === 'native' && /^[A-Za-z][A-Za-z0-9_-]{1,95}$/.test(priorNative.actionKey), 'Rollback native selection missing');
        const journal = JSON.parse((await protectedRead(join(home, 'operations', priorNative.actionKey + '.json'))).toString());
        check(journal.status === 'active' && journal.action?.nodeId === action.nodeId
          && journal.action?.parameters?.profileSha256 === binding.profileSha256
          && journal.action?.parameters?.runtimeManifestSha256 === binding.runtimeManifestSha256,
        'Original native activation settlement requires reconciliation');
        captured = journal.baseline;
        check(canonicalJson(captured.models) === canonicalJson(models) && captured.baselineEngineSha256 === binding.baselineEngineSha256,
          'Rollback baseline settings changed');
        const stateRoot = await protectedDirectory(join(home, 'service-state', priorNative.actionKey));
        const owned = await readOwnership(priorNative.actionKey);
        permanentPlistPath = join(await userLaunchAgentsDirectory(launchAgentsDirectory), 'local.dpf-inference.managed.plist');
        permanentPlistContents = permanentContents(owned, stateRoot);
        check(sha256(await protectedRead(permanentPlistPath)) === sha256(permanentPlistContents), 'Native startup entry identity changed');
        permanent = newService('local.dpf-inference.managed', permanentPlistPath, stateRoot,
          () => readOwnership(priorNative.actionKey));
      }
      return captured;
    },
    async prepareCandidate(snapshot) {
      await reverify();
      const states = await directory(home, 'service-state'); mutable = await directory(states, action.actionKey, true);
      leaseFile = join(mutable, 'lease.json'); await projectLease();
      projectionTimer = setInterval(() => {
        if (projectionPending) return;
        projectionPending = projectLease().catch(error => { abort.abort(error); }).finally(() => { projectionPending = null; });
      }, 5000); projectionTimer.unref();
      const label = 'local.dpf-inference.transition-' + sha256(action.actionKey).slice(0, 16);
      finite = newService(label, join(mutable, 'finite.plist'), mutable);
      await finite.prepare(renderRuntimeLaunchAgent({ label, packageRoot: descriptor.packageRoot, stateRoot: mutable,
        port: 12436, leaseFile, hardDeadline: action.expiresAt }));
      finitePid = (await finite.start()).pid; await ownedListener(finitePid); await ready();
      for (const model of snapshot.models) {
        const transferred = await transferRuntimeModel({ original, candidate, model: model.model, digest: model.digest, request, json,
          loadArchive: rawBody => request(candidate + '/models/load', { rawBody, timeout: 120000 }) });
        check(transferred.modelMetadataSha256 === model.modelMetadataSha256, 'Transferred model/projector metadata changed');
      }
    },
    async drainBaseline(snapshot) {
      await reverify();
      const rows = await baselineRows();
      check(runnerActivity(rows).idle, 'Baseline became busy after platform drain');
      await loadedModels(rows, snapshot.models);
      await json(original, '/engines/unload', { body: { all: false, backend: 'llama.cpp', models: snapshot.models.map(model => model.model) } });
      await requireEmptyBaseline();
    },
    async configureCandidate(snapshot) {
      await configureDrainedCandidate(snapshot.models.map(model => ({ model: model.model, digest: model.digest, original: model.configuration })), {
        readBaselineRunners: baselineRows,
        writeConfiguration: body => request(candidate + '/engines/_configure', { body }),
        readConfiguration: model => json(candidate, '/engines/_configure?model=' + encodeURIComponent(model), { timeout: 3000 }),
      });
    },
    async verifyCandidate(snapshot) {
      await requireEmptyBaseline(); await verifyConfiguration(snapshot.models);
      const chat = snapshot.models[0].model;
      const complete = async (messages, tools) => json(candidate, '/v1/chat/completions', { body: { model: chat, messages,
        max_tokens: 128, temperature: 0, seed: 476, chat_template_kwargs: { enable_thinking: false, preserve_thinking: true },
        ...(tools ? { tools, tool_choice: { type: 'function', function: { name: 'record_result' } } } : {}) } });
      const arithmetic = await complete([{ role: 'user', content: 'What is 19 + 23? Return only the integer.' }]);
      check(arithmetic.choices?.[0]?.finish_reason === 'stop' && arithmetic.choices[0].message?.content?.trim() === '42', 'Native arithmetic control failed');
      const tool = await complete([{ role: 'user', content: 'Calculate 19 + 23 and call record_result with that integer.' }],
        [{ type: 'function', function: { name: 'record_result', description: 'Record the calculated integer.',
          parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false } } }]);
      const call = tool.choices?.[0]?.message?.tool_calls;
      check(tool.choices?.[0]?.finish_reason === 'tool_calls' && call?.length === 1 && call[0].function?.name === 'record_result'
        && JSON.parse(call[0].function.arguments).value === 42, 'Native tool control failed');
      const embedding = await json(candidate, '/v1/embeddings', { body: { model: snapshot.models[1].model, input: ['DPF managed inference activation'] } });
      const vector = embedding.data?.[0]?.embedding;
      check(Array.isArray(vector) && vector.length === 768 && vector.every(Number.isFinite), 'Native embedding control failed');
      const evidence = await verifyIdentity(finitePid); await requireEmptyBaseline(); return { evidence };
    },
    async stopCandidate() {
      await endProjection();
      const result = finite && !finiteStopped ? await finite.stop() : { stopped: true };
      if (result.stopped === true) finiteStopped = true;
      return result;
    },
    async startCommitted() {
      await reverify(); await requireEmptyBaseline();
      check(!(await observeManaged()).exists && (await processes(home)).length === 0, 'Permanent native service ownership occupied');
      const state = JSON.parse((await protectedRead(join(stateDirectory, 'install-state.json'))).toString());
      check(state.managedInference?.mode === 'native' && state.managedInference.actionKey === action.actionKey
        && state.managedInference.runtimeManifestSha256 === binding.runtimeManifestSha256, 'Native selection is not committed');
      const owned = { schemaVersion: 1, status: 'active', label: 'local.dpf-inference.managed',
        program: join(descriptor.packageRoot, 'bin/dmr'), port: 12436, actionKey: action.actionKey,
        runtimeManifestSha256: binding.runtimeManifestSha256, qualificationReportSha256: binding.qualificationReportSha256 };
      await privateWrite(ownershipPath(), owned);
      permanentPlistPath = join(await userLaunchAgentsDirectory(launchAgentsDirectory, true), 'local.dpf-inference.managed.plist');
      permanentPlistContents = permanentContents(await readOwnership(action.actionKey), mutable);
      permanent = newService(owned.label, permanentPlistPath, mutable);
      await permanent.prepare(permanentPlistContents);
      permanentPid = (await permanent.start()).pid; await ownedListener(permanentPid); await ready();
    },
    async verifyCommitted(snapshot) {
      await verifyConfiguration(snapshot.models); const evidence = await verifyIdentity(permanentPid);
      await requireEmptyBaseline(); return { evidence };
    },
    async stopPrevious() {
      check(permanent, 'Prior native service ownership unavailable'); const result = await permanent.stop();
      check(result.stopped === true, 'Prior native service shutdown unconfirmed'); permanentStopped = true;
      await removeOwnedStartup(); return result;
    },
    async stopOwned() {
      await endProjection();
      if (permanent && !permanentStopped) {
        check((await permanent.stop()).stopped === true, 'Permanent native cleanup unconfirmed'); permanentStopped = true;
      }
      if (finite && !finiteStopped) {
        check((await finite.stop()).stopped === true, 'Finite native cleanup unconfirmed'); finiteStopped = true;
      }
      if (permanent) await removeOwnedStartup();
      if (home) check(!(await observeManaged()).exists && (await processes(home)).length === 0, 'Native descendant cleanup unconfirmed');
      return { stopped: true };
    },
    async restoreBaseline(snapshot) {
      await reverify();
      check((await processes(home)).length === 0 && !(await observeManaged()).exists, 'Native runtime remains resident before Docker restoration');
      const seen = await currentModels(snapshot.models, true);
      check(canonicalJson(seen) === canonicalJson(snapshot.models), 'Baseline model settings changed before restoration');
      for (const loaded of snapshot.loadedModels) {
        const model = snapshot.models.find(model => model.digest === loaded.digest);
        for (const configuration of model.configuration.filter(row => row.mode === loaded.mode)) {
          await request(original + '/engines/_configure', { body: configuration, recovery: true });
        }
      }
      for (let n = 0; n < 60; n++) {
        const loaded = await loadedModels(await baselineRows(true), snapshot.models, true);
        if (canonicalJson(loaded.map(x => [x.digest, x.mode]).sort()) === canonicalJson(snapshot.loadedModels.map(x => [x.digest, x.mode]).sort())) return;
        await delay(500);
      }
      throw new Error('Baseline model restoration unconfirmed');
    },
    async verifyBaseline(snapshot) {
      await reverify(); const actual = await loadedModels(await baselineRows(true), snapshot.models, true);
      check(canonicalJson(actual.map(x => [x.digest, x.mode]).sort()) === canonicalJson(snapshot.loadedModels.map(x => [x.digest, x.mode]).sort()), 'Baseline residency restoration changed');
    },
  };
  return Object.freeze(adapter);
}
