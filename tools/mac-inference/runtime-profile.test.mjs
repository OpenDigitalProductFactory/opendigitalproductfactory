import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { ENGINE_LOCK, sha256, enumerateFiles, fileRecord, unusedOutput, verifyPackage, vendorNoticePaths } from './package.mjs';
import { RUNTIME_LOCK, verifyRuntimePackage, candidateEnvironment, verifyEngineQualification, stageVerifiedRuntime } from './runtime-profile.mjs';
import * as runtimeProfile from './runtime-profile.mjs';
import { parseRuntimeBuildOptions, findGoLicense } from './build-runtime.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-runtime-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const engineRoot = join(root, 'engine');
  await mkdir(join(engineRoot, 'bin'), { recursive: true });
  const payload = Buffer.from('cffaedfe0c00000166697874757265', 'hex');
  for (const path of ['bin/llama-server', 'bin/llama-bench', ...ENGINE_LOCK.requiredRuntimeLibraries]) {
    await writeFile(join(engineRoot, path), payload, { mode: 0o700 });
  }
  await writeFile(join(engineRoot, 'LICENSE'), 'engine license fixture');
  const engineManifest = { schemaVersion: 1, packageName: 'dpf-llama-macos-arm64', version: ENGINE_LOCK.packageVersion,
    source: ENGINE_LOCK.source, patchSha256: ENGINE_LOCK.patchSha256,
    build: { os: 'darwin', architecture: 'arm64', sdk: '15.4', minimumMacOS: '13.3', compiler: 'fixture', flags: ['-DGGML_NATIVE=OFF'] },
    qualification: { status: 'unqualified' }, files: [] };
  for (const path of await enumerateFiles(engineRoot)) engineManifest.files.push(await fileRecord(engineRoot, path));
  await writeFile(join(engineRoot, 'manifest.json'), JSON.stringify(engineManifest));
  const engine = await verifyPackage(engineRoot);
  await mkdir(join(root, 'bin')); await writeFile(join(root, 'bin/dmr'), payload, { mode: 0o700 });
  await mkdir(join(root, 'licenses/Go'), { recursive: true });
  await writeFile(join(root, 'LICENSE'), 'runner license fixture');
  await writeFile(join(root, 'licenses/Go/LICENSE'), 'Go license fixture');
  const manifest = { schemaVersion: 1, packageName: 'dpf-model-runner-macos-arm64', version: RUNTIME_LOCK.packageVersion,
    source: RUNTIME_LOCK.source, patchSha256: RUNTIME_LOCK.patchSha256,
    build: { os: 'darwin', architecture: 'arm64', compiler: 'go1.26.5', cgo: false, flags: ['-mod=readonly', '-trimpath'] },
    engine: { manifestSha256: engine.manifestSha256 }, qualification: { status: 'unqualified' }, files: [] };
  for (const path of await enumerateFiles(root)) manifest.files.push(await fileRecord(root, path));
  const save = () => writeFile(join(root, 'runtime-manifest.json'), JSON.stringify(manifest));
  await save(); return { root, manifest, save, engine };
}

test('composite verification binds actual runner and unchanged engine bytes without activating', async t => {
  const f = await fixture(t); const result = await verifyRuntimePackage(f.root);
  assert.equal(result.activationAuthorized, false); assert.equal(result.qualification, 'unqualified');
  assert.equal(result.engine.manifestSha256, f.engine.manifestSha256);
  await writeFile(join(f.root, 'bin/dmr'), 'different runner');
  await assert.rejects(verifyRuntimePackage(f.root), /bytes changed/);
});
test('a self-qualified runtime and undeclared payload are rejected', async t => {
  const f = await fixture(t); f.manifest.qualification.status = 'qualified'; await f.save();
  await assert.rejects(verifyRuntimePackage(f.root), /qualify itself/);
  f.manifest.qualification.status = 'unqualified'; await f.save();
  await writeFile(join(f.root, 'extra'), 'payload');
  await assert.rejects(verifyRuntimePackage(f.root), /Unlisted/);
});
test('a changed embedded engine binding fails even when its own files verify', async t => {
  const f = await fixture(t); f.manifest.engine.manifestSha256 = '0'.repeat(64); await f.save();
  await assert.rejects(verifyRuntimePackage(f.root), /engine identity/);
});
test('runtime provenance and escaping inventory entries fail closed', async t => {
  const f = await fixture(t); f.manifest.patchSha256 = '0'.repeat(64); await f.save();
  await assert.rejects(verifyRuntimePackage(f.root), /patch/);
  f.manifest.patchSha256 = RUNTIME_LOCK.patchSha256; f.manifest.files[0].path = '../outside'; await f.save();
  await assert.rejects(verifyRuntimePackage(f.root), /path/i);
});
test('candidate environment restricts all listeners and keeps state separate from immutable payload', () => {
  const env = candidateEnvironment({ packageRoot: '/candidate/runtime', stateRoot: '/state/inference', port: 12435 });
  assert.equal(env.MODEL_RUNNER_BIND_HOST, '127.0.0.1'); assert.equal(env.MODEL_RUNNER_TLS_ENABLED, '0');
  assert.equal(env.DISABLE_SERVER_UPDATE, '1'); assert.equal(env.LLAMA_SERVER_PATH, '/candidate/runtime/engine/bin');
  assert.equal('LLAMA_ARGS' in env, false);
  assert.throws(() => candidateEnvironment({ packageRoot: '/candidate', stateRoot: '/candidate/logs', port: 12435 }), /overlap/);
  assert.throws(() => candidateEnvironment({ packageRoot: '/candidate', stateRoot: '/state', port: 0 }), /port/);
});
test('shared builder output guard rejects occupied and checkout destinations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-build-output-')); t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(unusedOutput(root), /exists/);
  await mkdir(join(root, '.git')); await assert.rejects(unusedOutput(join(root, 'out')), /checkout/);
  await assert.rejects(unusedOutput(join(homedir(), '.docker', 'bin')), /Protected/);
});
test('runtime builder requires explicit input identities and refuses undeclared flags', () => {
  assert.throws(() => parseRuntimeBuildOptions([]), /archive/);
  assert.throws(() => parseRuntimeBuildOptions(['--archive', '/archive', '--engine', '/engine', '--out', '/out']), /go/);
  assert.throws(() => parseRuntimeBuildOptions(['--disable-verification']), /Unknown option/);
  assert.equal(parseRuntimeBuildOptions(['--archive', '/archive', '--engine', '/engine', '--out', '/out', '--go', '/go']).go, '/go');
});
test('Go license discovery handles Homebrew split layout and fails when notices are absent', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-go-license-')); t.after(() => rm(root, { recursive: true, force: true }));
  const goRoot = join(root, 'libexec'); await mkdir(goRoot);
  await assert.rejects(findGoLicense(goRoot), /license unavailable/);
  await writeFile(join(root, 'LICENSE'), 'Homebrew Go license fixture');
  assert.equal(await findGoLicense(goRoot), await realpath(join(root, 'LICENSE')));
  await writeFile(join(goRoot, 'LICENSE'), 'official Go license fixture');
  assert.equal(await findGoLicense(goRoot), await realpath(join(goRoot, 'LICENSE')));
});
test('runtime notices retain patent grants without copying unrelated headers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dpf-go-notices-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['LICENSE', 'PATENTS', 'header.h']) await writeFile(join(root, path), path);
  assert.deepEqual(await vendorNoticePaths(root), ['LICENSE', 'header.h']);
  assert.deepEqual(await vendorNoticePaths(root, { includeHeaders: false, includePatents: true }), ['LICENSE', 'PATENTS']);
});

async function evidence(t) {
  const f = await fixture(t); const model = 'sha256:' + '1'.repeat(64);
  const report = { schemaVersion: 1, status: 'model-smoke-qualified', baselineRestored: true, failures: [],
    package: { version: ENGINE_LOCK.packageVersion, manifestSha256: f.engine.manifestSha256 },
    tensorControls: { device: 'Apple M5 Max' }, packageBackendControl: { backendInitialized: true },
    model: { ociDigest: model, binding: { manifestDigest: model } }, startedAt: '2026-10-26T01:00:00Z', finishedAt: '2026-10-26T01:01:00Z',
    results: ['docker-baseline', 'corrected-candidate'].flatMap(engine => ['arithmetic', 'tool-call-format', 'long-cold', 'long-warm']
      .map(kind => ({ engine, case: kind, correct: true, finishReason: kind === 'tool-call-format' ? 'tool_calls' : 'stop' }))) };
  const args = () => { const reportBytes = Buffer.from(JSON.stringify(report)); return { reportBytes, expectedReportSha256: sha256(reportBytes),
    engine: f.engine, expectedModelDigest: model, physicalDevice: 'Apple M5 Max' }; };
  return { f, report, args };
}
test('completed tool controls can reuse engine evidence but never qualify the new runtime', async t => {
  const f = await evidence(t); const result = verifyEngineQualification(f.args());
  assert.equal(result.engineEvidenceReusable, true); assert.equal(result.runtimeIntegration, 'unrun');
  assert.equal(result.activationAuthorized, false);
});
test('missing, duplicated and truncated controls cannot qualify by count alone', async t => {
  const f = await evidence(t); f.report.results[1] = { ...f.report.results[0] };
  assert.throws(() => verifyEngineQualification(f.args()), /controls/);
  f.report.results.pop(); assert.throws(() => verifyEngineQualification(f.args()), /controls/);
});
test('report tampering, changed hardware and changed model cannot reuse evidence', async t => {
  const f = await evidence(t); const args = f.args(); args.expectedReportSha256 = '0'.repeat(64);
  assert.throws(() => verifyEngineQualification(args), /identity/);
  assert.throws(() => verifyEngineQualification({ ...f.args(), physicalDevice: 'Apple M4 Max' }), /device/);
  assert.throws(() => verifyEngineQualification({ ...f.args(), expectedModelDigest: 'sha256:' + '2'.repeat(64) }), /model/);
});
test('notice repackaging needs the actual old manifest and identical native records', async t => {
  const f = await evidence(t); const original = await readFile(join(f.f.root, 'engine/manifest.json'));
  f.f.engine.manifestSha256 = '2'.repeat(64);
  assert.throws(() => verifyEngineQualification(f.args()), /Original qualified manifest/);
  assert.equal(verifyEngineQualification({ ...f.args(), qualifiedManifestBytes: original }).engineEvidenceReusable, true);
  f.f.engine.manifest.files.find(row => row.path === 'bin/llama-server').sha256 = '3'.repeat(64);
  assert.throws(() => verifyEngineQualification({ ...f.args(), qualifiedManifestBytes: original }), /native files/);
});

const { configurationSnapshot, runtimeLeaseProjection, loopbackManagementRoot, configureDrainedCandidate, awaitRuntimeAdmission, recordRuntimeFailure, superviseRuntimeQualification } = await import('./qualify-runtime.mjs');
test('configuration capture preserves exact model tag, mode, context and flags while rejecting another model digest', () => {
  const digest = 'sha256:' + 'a'.repeat(64), model = 'hf.co/model:Q4_K_M';
  const row = { Backend: 'llama.cpp', Model: model, ModelID: digest, Mode: 'completion',
    Config: { 'context-size': 131072, 'runtime-flags': ['--flash-attn', 'on'], keep_alive: '5m' } };
  const value = configurationSnapshot([row], model, digest);
  assert.deepEqual(value, [{ model, mode: 'completion', ...row.Config }]);
  row.Config['context-size'] = 8; assert.equal(value[0]['context-size'], 131072);
  assert.throws(() => configurationSnapshot([row], model, 'sha256:' + 'b'.repeat(64)), /identity/);
  assert.throws(() => configurationSnapshot([row], model.toLowerCase(), digest), /identity/);
  assert.deepEqual(configurationSnapshot([], model, digest), []);
});
test('native expiry projection requires this exact active runtime branch and excludes credentials', () => {
  const lease = { leaseId: 'NPEL-test', ownerSessionId: 'our-chat', branchName: 'codex/mac-inference-runtime',
    status: 'active', phase: 'running', environmentKey: 'local-integration-ci', slotManifestVersion: 1,
    expiresAt: new Date(Date.now() + 120000).toISOString(), token: 'must-not-copy' };
  const projected = runtimeLeaseProjection(lease, { id: lease.leaseId, owner: 'our-chat' });
  assert.equal(projected.branchName, lease.branchName); assert.equal('token' in projected, false);
  assert.throws(() => runtimeLeaseProjection({ ...lease, branchName: 'codex/someone-else' }, { id: lease.leaseId, owner: 'our-chat' }), /lease/);
  assert.throws(() => runtimeLeaseProjection({ ...lease, status: 'released' }, { id: lease.leaseId, owner: 'our-chat' }), /lease/);
});
test('qualification management URLs reject remote hosts, credentials and path/query confusion', () => {
  assert.equal(loopbackManagementRoot('http://127.0.0.1:12434/'), 'http://127.0.0.1:12434');
  for (const value of ['http://example.com', 'http://user@localhost', 'http://localhost/engines', 'http://localhost/?x=1']) {
    assert.throws(() => loopbackManagementRoot(value), /loopback/);
  }
});

test('staging retains relative native links and reports the package version without an escaping copy', async t => {
  const f = await fixture(t); const destination = f.root + '-staged';
  t.after(() => rm(destination, { recursive: true, force: true }));
  await symlink('dmr', join(f.root, 'bin/dmr-alias'));
  f.manifest.files.push(await fileRecord(f.root, 'bin/dmr-alias')); await f.save();
  const staged = await stageVerifiedRuntime(f.root, destination);
  assert.equal(await readlink(join(destination, 'bin/dmr-alias')), 'dmr');
  assert.equal(staged.version, RUNTIME_LOCK.packageVersion);
});

test('stock configure cannot preload candidate weights while any Docker model remains resident', async () => {
  let writes = 0;
  const entries = [{ model: 'm:Tag', digest: 'sha256:' + 'a'.repeat(64), original: [{ model: 'm:Tag', mode: 'completion', 'context-size': 131072 }] }];
  await assert.rejects(configureDrainedCandidate(entries, {
    readBaselineRunners: async () => [{ backend_name: 'llama.cpp', model_name: 'm:Tag', mode: 'completion' }],
    writeConfiguration: async () => { writes++; }, readConfiguration: async () => [],
  }), /resident/);
  assert.equal(writes, 0); assert.equal(entries[0].candidate, undefined);
});
test('candidate configuration remains unverified when the API readback differs', async () => {
  const digest = 'sha256:' + 'a'.repeat(64), model = 'm:Tag'; let writes = 0;
  const entries = [{ model, digest, original: [{ model, mode: 'completion', 'context-size': 131072 }] }];
  await assert.rejects(configureDrainedCandidate(entries, {
    readBaselineRunners: async () => [], writeConfiguration: async () => { writes++; },
    readConfiguration: async () => [{ Backend: 'llama.cpp', Model: model, ModelID: digest, Mode: 'completion', Config: { 'context-size': 4096 } }],
  }), /configuration changed/);
  assert.equal(writes, 1); assert.equal(entries[0].candidate, undefined);
});

test('waiting native qualifier resumes one reservation and binds only the assigned active admission', async () => {
  const calls = [], bound = []; let now = 0, count = 0;
  const value = await awaitRuntimeAdmission({ waitDeadline: 120000, now: () => now,
    assertSource: async () => {}, delay: async ms => { now += ms; },
    claim: async id => { calls.push(id); return { success: true, data: { lease: { leaseId: 'NPEL-one', status: ++count === 3 ? 'active' : 'queued' } } }; },
    bind: async lease => { bound.push(lease.leaseId); return lease; },
  });
  assert.equal(value.leaseId, 'NPEL-one'); assert.deepEqual(calls, [undefined, 'NPEL-one', 'NPEL-one']);
  assert.deepEqual(bound, ['NPEL-one']); assert.equal(now, 90000);
});
test('native admission refusal, expiry and changed source never bind or generate a replacement reservation', async () => {
  for (const error of ['approval_required', 'lease_terminal', 'lease_owner_mismatch']) {
    let calls = 0, bindings = 0;
    await assert.rejects(awaitRuntimeAdmission({ waitDeadline: Date.now() + 120000, assertSource: async () => {},
      claim: async () => { calls++; return { success: false, error }; }, bind: async () => { bindings++; },
    }), /reservation stopped/);
    assert.equal(calls, 1); assert.equal(bindings, 0);
  }
  let calls = 0;
  await assert.rejects(awaitRuntimeAdmission({ waitDeadline: Date.now() + 120000,
    assertSource: async () => { throw new Error('source changed'); }, claim: async () => { calls++; }, bind: async () => {},
  }), /source changed/); assert.equal(calls, 0);
});

test('blocked admission is unrun evidence, while an inspected runtime failure remains a failure', () => {
  const blocked = { status: 'incomplete', failures: [] };
  recordRuntimeFailure(blocked, new Error('approval_required'));
  assert.equal(blocked.status, 'unrun'); assert.deepEqual(blocked.failures, []);
  assert.deepEqual(blocked.obstacles, ['approval_required']);
  const inspected = { status: 'incomplete', runtimeInspectionStarted: true, failures: [] };
  recordRuntimeFailure(inspected, new Error('runtime HTTP 500'));
  assert.deepEqual(inspected.failures, ['runtime HTTP 500']); assert.equal(inspected.obstacles, undefined);
});

function runtimeSupervisionFixture() {
  const report = { status: 'incomplete', runtimeInspectionStarted: true, failures: [] };
  let heartbeat, deadline;
  const options = { report, ttlMs: 120000, expiresAt: new Date(Date.now() + 120000).toISOString(),
    schedule: callback => { heartbeat = callback; return 1; }, cancelSchedule: () => {},
    scheduleDeadline: callback => { deadline = callback; return 2; }, cancelDeadline: () => {},
    terminate: async () => {}, renew: async () => ({ success: true }),
  };
  return { report, options, heartbeat: () => heartbeat(), deadline: () => deadline() };
}
test('authority loss during the last checkpoint cannot leave a qualified final verdict', async () => {
  const f = runtimeSupervisionFixture(); let checkpoint, finish;
  const reached = new Promise(resolve => { checkpoint = resolve; });
  const waiting = new Promise(resolve => { finish = resolve; });
  const run = superviseRuntimeQualification({ ...f.options, run: async () => {
    checkpoint(); await waiting; f.report.status = 'runtime-api-qualified'; return 'all controls completed';
  } });
  await reached; await f.deadline(); finish();
  await assert.rejects(run, /fenced/); assert.notEqual(f.report.status, 'runtime-api-qualified');
  assert.equal(f.report.authorityFenced, true);
});
test('an in-flight refusal settling in supervisor finally overrides the already selected completed result', async () => {
  const f = runtimeSupervisionFixture(); let entered, rejectRenewal;
  const pending = new Promise(resolve => { entered = resolve; });
  const renewal = new Promise(resolve => { rejectRenewal = resolve; });
  const run = superviseRuntimeQualification({ ...f.options, renew: async () => { entered(); return renewal; }, run: async () => {
    void f.heartbeat(); f.report.status = 'runtime-api-qualified'; return 'all controls completed';
  } });
  await pending; await Promise.resolve(); rejectRenewal({ success: false, error: 'lease_terminal' });
  await assert.rejects(run, /fenced/); assert.notEqual(f.report.status, 'runtime-api-qualified');
  assert.equal(f.report.authorityFenced, true);
});
test('supervised native qualification records skipped external release without claiming release succeeded', async () => {
  const f = runtimeSupervisionFixture();
  const result = await superviseRuntimeQualification({ ...f.options, run: async () => 'finished' });
  assert.equal(result.status, 'completed');
  assert.equal(f.report.leaseEvents.some(event => event.type === 'released'), false);
  assert.equal(f.report.leaseEvents.some(event => event.type === 'release-not-attempted'), true);
});
test('a deadline during final in-flight renewal remains fenced after that renewal subsequently succeeds', async () => {
  const f = runtimeSupervisionFixture(); let entered, completeRenewal, terminateEntered, completeTermination;
  const renewing = new Promise(resolve => { entered = resolve; });
  const renewal = new Promise(resolve => { completeRenewal = resolve; });
  const terminating = new Promise(resolve => { terminateEntered = resolve; });
  const termination = new Promise(resolve => { completeTermination = resolve; });
  const run = superviseRuntimeQualification({ ...f.options,
    renew: async () => { entered(); return renewal; },
    terminate: async () => { terminateEntered(); await termination; },
    run: async () => { void f.heartbeat(); f.report.status = 'runtime-api-qualified'; return 'all controls completed'; },
  });
  await renewing; await Promise.resolve(); const deadline = f.deadline(); await terminating;
  completeRenewal({ success: true, data: { lease: { expiresAt: new Date(Date.now() + 120000).toISOString() } } });
  completeTermination(); await deadline;
  await assert.rejects(run, /fenced/); assert.equal(f.report.authorityFenced, true);
  assert.notEqual(f.report.status, 'runtime-api-qualified');
});
test('legacy qualified labels cannot override explicit authority-fence evidence when reusing an engine report', async t => {
  const f = await evidence(t);
  for (const field of ['authorityFenced', 'backendEffectSettlement']) {
    f.report[field] = field === 'authorityFenced' ? true : 'unknown after authority fence; HTTP abort is not effect settlement';
    assert.throws(() => verifyEngineQualification(f.args()), /authority fence/); delete f.report[field];
  }
  f.report.leaseEvents = [{ type: 'heartbeat-lost', reason: 'lease_terminal' }];
  assert.throws(() => verifyEngineQualification(f.args()), /authority fence/);
});

function runtimeApiEvidence() {
  const runtime = { version: RUNTIME_LOCK.packageVersion, manifestSha256: 'a'.repeat(64) };
  const models = ['chat:v1', 'embedding:v1'].map((model, i) => ({ model,
    digest: 'sha256:' + String(i + 1).repeat(64), modelMetadataSha256: String(i + 3).repeat(64),
    configuration: i === 0 ? [{ model, mode: 'completion', 'context-size': 131072 }] : [] }));
  const report = { schemaVersion: 1, status: 'runtime-api-qualified', activationAuthorized: false,
    providerConfigurationChanged: false, runtimeFilesChanged: false, failures: [],
    startedAt: '2026-10-26T15:00:00Z', admittedAt: '2026-10-26T15:01:00Z', finishedAt: '2026-10-26T15:05:00Z',
    runtime: { ...runtime, device: RUNTIME_LOCK.initialQualifiedDevice }, runtimeVersion: runtime.version,
    baselineRestored: true, candidateShutdown: { stopped: true },
    models: models.map(({ configuration, ...row }) => row),
    configurations: models.map(row => ({ model: row.model, digest: row.digest,
      original: structuredClone(row.configuration), candidate: structuredClone(row.configuration) })),
    embedding: { correct: true, dimensions: 768, modelDigest: models[1].digest },
    results: ['docker-baseline', 'corrected-candidate'].flatMap(engine =>
      ['arithmetic', 'tool-call-format', 'long-cold', 'long-warm'].map(kind => ({ engine, case: kind,
        correct: true, finishReason: kind === 'tool-call-format' ? 'tool_calls' : 'stop' }))),
  };
  const args = () => { const reportBytes = Buffer.from(JSON.stringify(report)); return {
    reportBytes, expectedReportSha256: sha256(reportBytes), runtime, models,
    physicalDevice: RUNTIME_LOCK.initialQualifiedDevice, nowMs: Date.parse('2026-10-28T15:05:00Z') };
  };
  return { runtime, models, report, args, verify: () => runtimeProfile.verifyRuntimeQualification(args()) };
}

test('runtime API reuse binds current package, models and settings without granting activation', () => {
  const f = runtimeApiEvidence(); const result = f.verify();
  assert.equal(result.runtimeEvidenceReusable, true); assert.equal(result.activationAuthorized, false);
  assert.equal(result.platformWorkflowIntegration, 'unrun'); assert.equal(result.releaseVerified, false);
  const args = f.args(); args.expectedReportSha256 = '0'.repeat(64);
  assert.throws(() => runtimeProfile.verifyRuntimeQualification(args), /report identity/);
});
test('runtime API reuse rejects changed device, runtime and model metadata or configuration', () => {
  for (const mutate of [
    f => { f.runtime.manifestSha256 = 'f'.repeat(64); },
    f => { f.report.runtime.device = 'Apple M4 Max'; },
    f => { f.report.runtime.version = 'other-runner'; },
    f => { f.models[0].digest = 'sha256:' + '9'.repeat(64); },
    f => { f.models[0].modelMetadataSha256 = '9'.repeat(64); },
    f => { f.models[0].configuration[0]['context-size'] = 65536; },
    f => { f.report.configurations[0].candidate[0]['context-size'] = 65536; },
  ]) { const f = runtimeApiEvidence(); mutate(f); assert.throws(f.verify, /changed|qualified|binding/); }
});
test('runtime API reuse refuses fenced, incomplete and un-restored reports despite qualified labels', () => {
  for (const mutate of [
    f => { f.report.authorityFenced = true; },
    f => { f.report.backendEffectSettlement = 'unknown'; },
    f => { f.report.leaseEvents = [{ type: 'heartbeat-lost' }]; },
    f => { f.report.failures.push('cleanup failed'); },
    f => { f.report.obstacles = ['unsettled effect']; },
    f => { f.report.candidateShutdown.stopped = false; },
    f => { f.report.baselineRestored = false; },
    f => { f.report.activationAuthorized = true; },
  ]) { const f = runtimeApiEvidence(); mutate(f); assert.throws(f.verify, /fence|Incomplete|self-authorize/); }
});
test('runtime API reuse requires the exact completion, tool, prefix and embedding controls', () => {
  for (const mutate of [
    f => { f.report.results.pop(); },
    f => { f.report.results[0] = f.report.results[1]; },
    f => { f.report.results[0].finishReason = 'length'; },
    f => { f.report.embedding.modelDigest = f.models[0].digest; },
    f => { f.report.embedding.dimensions = 384; },
    f => { f.report.models.push(f.report.models[0]); },
    f => { f.report.configurations.pop(); },
  ]) { const f = runtimeApiEvidence(); mutate(f); assert.throws(f.verify, /controls|binding/); }
});
test('runtime API reuse honors explicit freshness bounds without expiring unchanged evidence or inventing release', () => {
  const f = runtimeApiEvidence(); f.report.leaseEvents = [{ type: 'released' }];
  assert.equal(f.verify().releaseVerified, false);
  f.report.finishedAt = '2026-10-29T15:05:00Z'; assert.throws(f.verify, /chronology|expired/);
  f.report.finishedAt = '2026-10-26T15:05:00Z';
  const args = f.args(); args.nowMs = Date.parse('2026-11-04T15:05:00Z');
  assert.equal(runtimeProfile.verifyRuntimeQualification(args).runtimeEvidenceReusable, true);
  args.qualifiedAfterMs = Date.parse('2026-10-27T15:05:00Z');
  assert.throws(() => runtimeProfile.verifyRuntimeQualification(args), /predates/);
});
