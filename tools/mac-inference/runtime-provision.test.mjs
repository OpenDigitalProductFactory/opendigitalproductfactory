import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeInstallationFixture } from './runtime-test-fixtures.mjs';
import { stageQualifiedNativeRuntime } from './runtime-provision.mjs';

test('provisioning derives the enrolled host and actual unchanged model settings using reads only', async t => {
  const f = await runtimeInstallationFixture(t); const calls = [];
  const edge = join(f.stateDirectory, 'edge-node'); await mkdir(edge, { mode: 0o700 });
  await writeFile(join(edge, 'state.json'), JSON.stringify({ nodeId: 'edge-test', trustState: 'trusted', nodeToken: 'never-return-this' }), { mode: 0o600 });
  const reportFile = join(f.root, 'report.json'); await writeFile(reportFile, f.reportBytes);
  const input = { ...f, sourceSha: f.binding.sourceSha, expectedRuntimeManifestSha256: f.binding.runtimeManifestSha256,
    reportFile, expectedReportSha256: f.binding.qualificationReportSha256, platform: 'darwin', architecture: 'arm64',
    run: async (program, args) => { calls.push([program, args]); return { stdout: JSON.stringify({ SPDisplaysDataType: [{ sppci_model: f.physicalDevice }] }) }; },
    fetchImpl: async (url, options) => {
      calls.push([url, options?.method ?? 'GET']);
      const model = f.models.find(row => url.includes('/models/' + row.model.split('/').map(encodeURIComponent).join('/'))
        || new URL(url).searchParams.get('model') === row.model);
      assert.ok(model);
      return Response.json(url.includes('/engines/_configure') ? model.configuration.map(config => ({ Backend: 'llama.cpp', Model: model.model,
        ModelID: model.digest, Mode: config.mode, Config: Object.fromEntries(Object.entries(config).filter(([k]) => !['model', 'mode'].includes(k))) }))
        : { id: model.digest, config: model.modelMetadata });
    },
  };
  // The fixture's expected metadata is intentionally a known tiny object.
  for (const row of f.models) row.modelMetadata = {};
  const { sha256 } = await import('./package.mjs');
  for (const row of f.models) row.modelMetadataSha256 = sha256(JSON.stringify(row.modelMetadata));
  const report = JSON.parse(f.reportBytes); report.models = f.models.map(({ configuration, modelMetadata, ...row }) => row);
  report.configurations = f.models.map(row => ({ model: row.model, digest: row.digest, original: row.configuration, candidate: row.configuration }));
  const bytes = Buffer.from(JSON.stringify(report)); await writeFile(reportFile, bytes); input.expectedReportSha256 = sha256(bytes);
  const staged = await stageQualifiedNativeRuntime(input);
  assert.equal(staged.hostNodeId, 'edge-test'); assert.equal(staged.activationAuthorized, false);
  assert.equal(JSON.stringify(staged).includes('never-return-this'), false);
  assert.ok(calls.every(([name, method]) => name === '/usr/sbin/system_profiler' || method === 'GET'));
  await assert.rejects(stageQualifiedNativeRuntime({ ...input, expectedReportSha256: '0'.repeat(64) }), /report/);
});
