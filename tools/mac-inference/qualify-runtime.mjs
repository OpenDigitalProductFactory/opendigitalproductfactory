#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, rename, mkdtemp, mkdir, access } from 'node:fs/promises';
import { platform, arch, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isEntryModule } from '../../scripts/lib/entry-module.mjs';
import { readMcpConnection } from '../../scripts/host-resource-runner.mjs';
import { mcpCall } from '../../scripts/lib/mcp-client.mjs';
import { admittedLeaseTtlMs, superviseLeaseRun } from '../../scripts/lib/lease-supervisor.mjs';
import { sha256, hashFile } from './package.mjs';
import { verifyRuntimePackage, stageVerifiedRuntime, verifyEngineQualification } from './runtime-profile.mjs';
import { createRuntimeLaunchAgent, renderRuntimeLaunchAgent } from './runtime-launchagent.mjs';
import { validateOwnedLease, validatedModelDigest, runnerActivity, metric, testEndpoint, makeContext,
  coldMessages, authorityAwareSignal, recordAuthorityFence } from './qualify-engine.mjs';

const execute = promisify(execFile), pause = ms => new Promise(r => setTimeout(r, ms));
const BRANCH = 'codex/mac-inference-runtime';
const check = (value, message) => { if (!value) throw new Error(message); };
const modelPath = ref => '/models/' + ref.split('/').map(encodeURIComponent).join('/');
export function loopbackManagementRoot(value) {
  const url = new URL(value);
  check(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password
    && ['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash,
  'Qualification requires a loopback management root');
  return url.href.replace(/\/$/, '');
}
export function configurationSnapshot(rows, model, digest) {
  check(Array.isArray(rows), 'Configuration capture unavailable');
  const modes = new Set();
  return rows.map(row => {
    check(row && row.Backend === 'llama.cpp' && row.Model === model && row.ModelID === digest
      && typeof row.Mode === 'string' && row.Mode.length > 0 && !modes.has(row.Mode)
      && row.Config && typeof row.Config === 'object' && !Array.isArray(row.Config), 'Configuration model identity changed');
    modes.add(row.Mode);
    return { ...structuredClone(row.Config), model, mode: row.Mode };
  }).sort((a, b) => a.mode.localeCompare(b.mode));
}
export function runtimeLeaseProjection(lease, expected) {
  validateOwnedLease(lease, { ...expected, branch: BRANCH });
  const { leaseId, ownerSessionId, branchName, status, phase, expiresAt } = lease;
  return { schemaVersion: 1, leaseId, ownerSessionId, branchName, status, phase, expiresAt };
}
export async function configureDrainedCandidate(entries, { readBaselineRunners, writeConfiguration, readConfiguration }) {
  for (const entry of entries) {
    for (const config of entry.original) {
      const rows = await readBaselineRunners();
      check(runnerActivity(rows).idle && rows.length === 0,
        'Docker model resident before configure-triggered candidate preload');
      await writeConfiguration(config);
    }
    const observed = configurationSnapshot(await readConfiguration(entry.model), entry.model, entry.digest);
    check(JSON.stringify(entry.original) === JSON.stringify(observed), 'Candidate model configuration changed');
    entry.candidate = observed;
  }
}
export function parseRuntimeQualificationOptions(args = process.argv.slice(2)) {
  const names = ['package', 'out', 'lease-id', 'owner-session', 'model-ref', 'model-digest',
    'embedding-ref', 'embedding-digest', 'dmr-root', 'baseline-engine', 'baseline-engine-sha256',
    'engine-report', 'engine-report-sha256', 'qualified-engine-manifest'];
  const { values } = parseArgs({ args, options: Object.fromEntries(names.map(key => [key, { type: 'string' }])) });
  for (const key of names) check(values[key], '--' + key + ' is required');
  loopbackManagementRoot(values['dmr-root']);
  return values;
}

async function run(a) {
  check(platform() === 'darwin' && arch() === 'arm64', 'Native runtime qualification requires Apple Silicon');
  // Refuse occupied evidence paths before admitting any effects.
  try { await access(a.out); throw new Error('Output evidence already exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const connection = readMcpConnection(); check(connection, 'Lease connection unavailable');
  const report = { schemaVersion: 1, status: 'incomplete', activationAuthorized: false,
    runtimeFilesChanged: false, providerConfigurationChanged: false, physicalOlderMacCoverage: 'unrun',
    platformWorkflowIntegration: 'unrun', results: [], failures: [], startedAt: new Date().toISOString() };
  const expected = { id: a['lease-id'], owner: a['owner-session'] };
  const original = loopbackManagementRoot(a['dmr-root']);
  let lease, deadline = Date.now() + 9 * 60000, workspace, leaseFile, service, candidateRoot, cleaned = false, fenced = false;
  const cancel = new AbortController(), authority = new AbortController();
  const checkpoint = async () => {
    if (!workspace) return;
    await writeFile(join(workspace, 'checkpoint.next'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    await rename(join(workspace, 'checkpoint.next'), join(workspace, 'checkpoint.json'));
  };
  const validate = () => {
    check(!fenced, 'Runtime qualification authority fenced');
    return runtimeLeaseProjection(lease, expected);
  };
  const project = async () => {
    if (!leaseFile) return;
    await writeFile(leaseFile + '.next', JSON.stringify(validate()), { mode: 0o600 });
    await rename(leaseFile + '.next', leaseFile);
  };
  const request = async (url, { body, method, timeout = 240000, recovery = false, headers } = {}) => {
    validate(); check(recovery || !cancel.signal.aborted, 'Qualification cancelled');
    const remaining = deadline - Date.now(); check(remaining > 0, 'Qualification deadline reached');
    const signal = authorityAwareSignal(recovery ? new AbortController().signal : cancel.signal,
      authority.signal, Math.max(1, Math.min(timeout, remaining)));
    const response = await fetch(url, { method: method ?? (body === undefined ? 'GET' : 'POST'), signal,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) });
    check(response.ok, 'Runtime HTTP ' + response.status + ' at ' + new URL(url).pathname);
    return response;
  };
  const json = async (root, path, options) => (await request(root + path, options)).json();
  const completion = async (base, messages, tools, recovery = false) => {
    if (candidateRoot && base.startsWith(candidateRoot)) {
      const rows = await json(original, '/engines/ps', { timeout: 3000 });
      check(Array.isArray(rows) && rows.length === 0, 'Docker reloaded during candidate window; stop to avoid duplicate residency');
    }
    const start = performance.now();
    const response = await json(base, '/v1/chat/completions', { recovery, timeout: recovery ? 30000 : 240000,
      body: { model: a['model-ref'], messages, max_tokens: 256, temperature: 0, seed: 476,
        chat_template_kwargs: { enable_thinking: false, preserve_thinking: true },
        ...(tools ? { tools, tool_choice: { type: 'function', function: { name: 'record_result' } } } : {}) } });
    return { response, metric: metric(response, performance.now() - start) };
  };
  const idle = async root => {
    const end = Math.min(deadline, Date.now() + 90000);
    while (Date.now() < end) {
      const rows = await json(root, '/engines/ps', { timeout: 3000 });
      if (runnerActivity(rows).idle) return rows;
      await pause(1500);
    }
    throw new Error('Existing runner remained busy; candidate model not launched');
  };
  const unload = async root => {
    await idle(root); validate();
    if (root === original) { report.baselineUnloadedForQualification = true; await checkpoint(); }
    await json(root, '/engines/unload', { body: { all: false, backend: 'llama.cpp', models: [a['model-ref'], a['embedding-ref']] }, timeout: 30000 });
    const rows = await json(root, '/engines/ps', { timeout: 3000 });
    check(Array.isArray(rows) && rows.length === 0, 'Model residency not drained');
  };
  const cleanup = async () => {
    if (cleaned) return; cleaned = true;
    deadline = Math.min(Date.now() + 45000, Date.parse(lease?.expiresAt) - 15000);
    if (service) { report.candidateShutdown = await service.stop(); await checkpoint(); }
    if (report.baselineUnloadedForQualification && !report.baselineRestored) {
      validate();
      const value = await completion(original + '/engines/llama.cpp', [{ role: 'user', content: 'Reply with OK.' }], undefined, true);
      report.baselineRestored = value.metric.finishReason === 'stop';
      check(report.baselineRestored, 'Docker restoration completion failed');
      await checkpoint();
    }
  };
  const transfer = async (candidate, model, digest) => {
    validate();
    console.log(JSON.stringify({ phase: 'export-load', model }));
    const response = await request(original + modelPath(model) + '/export', { timeout: 120000 });
    const signal = authorityAwareSignal(cancel.signal, authority.signal, Math.min(120000, deadline - Date.now()));
    const loaded = await fetch(candidate + '/models/load', { method: 'POST', body: response.body,
      duplex: 'half', headers: { 'content-type': 'application/x-tar' }, signal });
    check(loaded.ok, 'Candidate stock model load failed: ' + loaded.status); await loaded.arrayBuffer();
    const split = model.lastIndexOf(':'); check(split > model.lastIndexOf('/'), 'Explicit model tag required');
    // Stock export does not promise preservation of tag aliases. Bind the known digest explicitly.
    await request(candidate + modelPath(digest) + '/tag?repo=' + encodeURIComponent(model.slice(0, split))
      + '&tag=' + encodeURIComponent(model.slice(split + 1)), { method: 'POST', timeout: 30000 });
    const card = await json(candidate, modelPath(model), { timeout: 3000 });
    validatedModelDigest(digest, card.id);
    return { model, digest, modelMetadataSha256: sha256(JSON.stringify(card.config)), transfer: 'stock-export-load-tag' };
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cancel.abort());
  try {
    const listed = await mcpCall('list_nonprod_environment_leases', {}, connection);
    check(listed?.success === true, 'Lease inventory unavailable');
    const matches = (listed.data?.leases ?? []).filter(x => x.leaseId === expected.id);
    check(matches.length === 1, 'Exact qualification lease not found'); lease = matches[0]; validate();
    await superviseLeaseRun({ ttlMs: admittedLeaseTtlMs(lease.expiresAt, 120000), expiresAt: lease.expiresAt,
      renew: async () => {
        const result = await mcpCall('renew_nonprod_environment_lease', { leaseId: expected.id, ownerSessionId: expected.owner, ttlMinutes: 2 }, connection);
        if (result?.success === true) {
          try { runtimeLeaseProjection(result.data?.lease, expected); lease = result.data.lease; await project(); }
          catch { return { success: false, error: 'runtime_lease_projection_unproven' }; }
        }
        return result;
      },
      terminate: async () => { fenced = true; recordAuthorityFence(report); authority.abort(); cancel.abort(); if (service) await service.stop(); },
      release: async () => {}, onEvent: event => { (report.leaseEvents ??= []).push(event); },
      run: async () => {
        try {
          const verified = await verifyRuntimePackage(a.package);
          report.qualifierSource = {};
          for (const name of ['qualify-runtime.mjs', 'runtime-profile.mjs', 'runtime-launchagent.mjs', 'qualify-engine.mjs']) {
            report.qualifierSource[name] = await hashFile(fileURLToPath(new URL('./' + name, import.meta.url)));
          }
          const hardware = JSON.parse((await execute('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 15000 })).stdout);
          const device = hardware.SPDisplaysDataType?.[0]?.sppci_model;
          verifyEngineQualification({ reportBytes: await readFile(a['engine-report']), expectedReportSha256: a['engine-report-sha256'],
            engine: verified.engine, qualifiedManifestBytes: await readFile(a['qualified-engine-manifest']), expectedModelDigest: a['model-digest'], physicalDevice: device });
          check(await hashFile(a['baseline-engine']) === a['baseline-engine-sha256'], 'Docker baseline engine bytes changed');
          report.runtime = { version: verified.version, manifestSha256: verified.manifestSha256, device };
          report.baselineEngineSha256 = a['baseline-engine-sha256']; report.leaseId = lease.leaseId;
          const port = lease.ports?.[0]; check(Number.isInteger(port) && port > 1023, 'Bound native port required');
          workspace = await mkdtemp(join(tmpdir(), 'dpf-runtime-qualification-')); report.workspace = workspace;
          const packageRoot = join(workspace, 'package'), stateRoot = join(workspace, 'state');
          check((await stageVerifiedRuntime(resolve(a.package), packageRoot)).manifestSha256 === verified.manifestSha256, 'Staged runtime bytes changed');
          await mkdir(stateRoot, { mode: 0o700 }); leaseFile = join(workspace, 'lease.json'); await project();
          const label = 'local.dpf-inference.qualification-' + sha256(resolve(a.out)).slice(0, 16);
          const plistPath = join(workspace, 'runtime.plist');
          report.lifecycle = { label, port, stateRoot, deadline: new Date(deadline).toISOString() }; await checkpoint();
          service = createRuntimeLaunchAgent({ label, program: join(packageRoot, 'bin/dmr'), plistPath, stateRoot, workspaceRoot: workspace,
            readAuthority: validate, onEvent: async event => { (report.lifecycleEvents ??= []).push(event); await checkpoint(); } });
          await service.prepare(renderRuntimeLaunchAgent({ label, packageRoot, stateRoot, port, leaseFile, hardDeadline: new Date(deadline).toISOString() }));
          await service.start();
          const candidate = 'http://127.0.0.1:' + port; candidateRoot = candidate;
          let ready = false;
          for (let n = 0; n < 50 && !ready; n++) {
            try { ready = (await request(candidate + '/', { timeout: 1000 })).ok; } catch (e) { validate(); if (cancel.signal.aborted) throw e; }
            if (!ready) await pause(200);
          }
          check(ready, 'Candidate management readiness failed');
          report.runtimeVersion = await (await request(candidate + '/version', { timeout: 3000 })).text();
          check(report.runtimeVersion.includes(verified.version), 'Running model runner version changed');
          report.models = []; report.configurations = [];
          for (const [model, digest] of [[a['model-ref'], a['model-digest']], [a['embedding-ref'], a['embedding-digest']]]) {
            const originalCard = await json(original, modelPath(model), { timeout: 3000 }); validatedModelDigest(digest, originalCard.id);
            const config = configurationSnapshot(await json(original, '/engines/_configure?model=' + encodeURIComponent(model), { timeout: 3000 }), model, digest);
            const transferred = await transfer(candidate, model, digest);
            check(transferred.modelMetadataSha256 === sha256(JSON.stringify(originalCard.config)), 'Transferred model metadata changed');
            report.models.push(transferred);
            // POST configure preloads weights asynchronously in stock DMR.
            // Capture now; defer the write until the baseline is fully drained.
            report.configurations.push({ model, digest, original: config, candidate: 'unrun' }); await checkpoint();
          }
          await unload(original);
          const context = makeContext(3197);
          report.workload = { version: 'dpf-mac-model-controls.v1', contextLineCount: 3197,
            coldMessagesSha256: sha256(JSON.stringify(coldMessages(context))), transport: 'stock-model-runner-api', thinking: false, maxOutputTokens: 256 };
          await testEndpoint('docker-baseline', original + '/engines/llama.cpp', context, { request: completion, results: report.results }); await checkpoint();
          await unload(original);
          await configureDrainedCandidate(report.configurations, {
            readBaselineRunners: () => json(original, '/engines/ps', { timeout: 3000 }),
            writeConfiguration: async body => (await request(candidate + '/engines/_configure', { body, timeout: 30000 })).arrayBuffer(),
            readConfiguration: model => json(candidate, '/engines/_configure?model=' + encodeURIComponent(model), { timeout: 3000 }),
          });
          await checkpoint();
          await testEndpoint('corrected-candidate', candidate + '/engines/llama.cpp', context, { request: completion, results: report.results }); await checkpoint();
          const started = performance.now();
          const embedding = await json(candidate, '/engines/llama.cpp/v1/embeddings', { body: { model: a['embedding-ref'], input: ['DPF Mac inference qualification'] } });
          const vector = embedding.data?.[0]?.embedding;
          report.embedding = { elapsedMs: performance.now() - started, dimensions: vector?.length ?? null,
            correct: Array.isArray(vector) && vector.length === 768 && vector.every(Number.isFinite), modelDigest: a['embedding-digest'] };
          await cleanup();
          const before = report.results.find(x => x.engine === 'docker-baseline' && x.case === 'long-cold');
          const after = report.results.find(x => x.engine === 'corrected-candidate' && x.case === 'long-cold');
          report.performance = { promptTokensMatched: before?.promptTokens === after?.promptTokens,
            cacheCountsKnown: Number.isInteger(before?.cachedTokens) && Number.isInteger(after?.cachedTokens),
            elapsedRatio: before?.elapsedMs / after?.elapsedMs,
            prefillRatio: before?.prefillMs > 0 && after?.prefillMs > 0 ? before.prefillMs / after.prefillMs : null,
            scope: 'One sequential cold/warm pair through actual model-runner APIs, identical model and stored per-model configuration' };
          check(report.results.length === 8 && report.results.every(x => x.correct) && report.embedding.correct && report.baselineRestored,
            'One or more runtime completion controls failed');
          report.status = 'runtime-api-qualified';
        } finally { await cleanup(); }
      },
    });
  } catch (error) { report.failures.push(error.message); }
  finally {
    try { await cleanup(); } catch (error) { report.failures.push('Restoration: ' + error.message); }
    report.finishedAt = new Date().toISOString();
    if (report.failures.length) report.status = 'qualification-failed';
    await checkpoint(); await writeFile(a.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, results: report.results, embedding: report.embedding, performance: report.performance,
      failures: report.failures, baselineRestored: report.baselineRestored, workspace, output: a.out }));
    if (report.status !== 'runtime-api-qualified') process.exitCode = 1;
  }
}
if (isEntryModule(import.meta.url)) await run(parseRuntimeQualificationOptions());
