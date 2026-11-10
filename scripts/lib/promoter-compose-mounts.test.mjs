import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountOverride } from './govern-capability-compose-args.mjs';

test('maps daemon bind sources, preserving mount options and unrelated volumes', () => {
  const config = { services: { monitor: { volumes: [
    { type: 'bind', source: '/host-source/monitoring/a file.yml', target: '/config', read_only: true, bind: { create_host_path: false } },
    { type: 'volume', source: 'data', target: '/data' },
    { type: 'bind', source: '/host-source-other/x', target: '/other' },
    { type: 'bind', source: '/var/run/docker.sock', target: '/var/run/docker.sock' },
  ] } } };
  assert.deepEqual(mountOverride(config, [{ Type: 'bind', Source: '/Users/me/My DPF', Destination: '/host-source' }]), {
    services: { monitor: { volumes: [{ ...config.services.monitor.volumes[0], source: '/Users/me/My DPF/monitoring/a file.yml' }] } },
  });
});

test('longest containing mount wins and Windows paths stay absolute', () => {
  const config = { services: { a: { volumes: [{ type: 'bind', source: '/host-source/nested/config', target: '/config' }] } } };
  assert.equal(mountOverride(config, [
    { Type: 'bind', Source: 'C:\\DPF', Destination: '/host-source' },
    { Type: 'bind', Source: 'D:\\My Config', Destination: '/host-source/nested' },
  ]).services.a.volumes[0].source, 'D:/My Config/config');
});

test('release assets map to the committed canonical install, not temporary backup storage', () => {
  const config = { services: { a: { volumes: [{ type: 'bind', source: '/backups/run/candidate/monitoring/loki.yml', target: '/config' }] } } };
  const mounts = [{ Type: 'bind', Source: '/Users/me/dpf', Destination: '/canonical-install' }];
  assert.equal(mountOverride(config, mounts, { composeRoot: '/backups/run/candidate', installRoot: '/canonical-install' }).services.a.volumes[0].source, '/Users/me/dpf/monitoring/loki.yml');
});

test('fails closed when a container-only source root cannot be translated', () => {
  const config = { services: { a: { volumes: [{ type: 'bind', source: '/host-source/config', target: '/config' }] } } };
  assert.throws(() => mountOverride(config, [], { composeRoot: '/host-source' }), /unmapped/);
});

test('literal dollar signs survive a second compose interpolation', () => {
  const config = { services: { a: { volumes: [{ type: 'bind', source: '/host-source/$$config', target: '/$$config' }] } } };
  assert.deepEqual(mountOverride(config, [{ Type: 'bind', Source: '/opt/$dpf', Destination: '/host-source' }]).services.a.volumes[0], { type: 'bind', source: '/opt/$$dpf/$$config', target: '/$$config' });
});

test('Docker Compose merges translated binds without duplicating targets or re-expanding dollars', {
  // ambient-host-guard: allow read-only Compose integration; explicitly skipped when the CLI is absent.
  skip: spawnSync('docker', ['compose', 'version']).status !== 0,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'dpf-compose-mount-'));
  try {
    const config = { services: { monitor: { image: 'busybox', volumes: [
      { type: 'bind', source: '/host-source/monitoring/config', target: '/config', read_only: true },
      { type: 'volume', source: 'data', target: '/data' },
    ] } }, volumes: { data: {} } };
    const base = join(root, 'base.json');
    const override = join(root, 'override.json');
    writeFileSync(base, JSON.stringify(config));
    writeFileSync(override, JSON.stringify(mountOverride(config, [
      { Type: 'bind', Source: '/Users/me/$Config Files', Destination: '/host-source' },
    ])));
    // ambient-host-guard: allow read-only config rendering proves actual Compose merge/interpolation behavior; no containers are created.
    const rendered = spawnSync('docker', ['compose', '-p', 'dpf-mount-test', '-f', base, '-f', override, 'config', '--format', 'json'], { encoding: 'utf8', env: { ...process.env, COMPOSE_PROFILES: '' } });
    assert.equal(rendered.status, 0, rendered.stderr);
    const volumes = JSON.parse(rendered.stdout).services.monitor.volumes;
    assert.equal(volumes.length, 2);
    // Compose re-escapes literal dollars in config output for round-tripping.
    assert.equal(volumes.find((v) => v.target === '/config').source, '/Users/me/$$Config Files/monitoring/config');
    assert.equal(volumes.find((v) => v.target === '/config').read_only, true);
    assert.equal(volumes.find((v) => v.target === '/data').type, 'volume');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
