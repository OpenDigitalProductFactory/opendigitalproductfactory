import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as preview from './dev-preview-runtime.mjs';

// A real Compose parser is required: object-only tests miss the port uniqueness
// key's host IP component and can incorrectly retain broad inherited bindings.
test('real Compose merge replaces every inherited preview binding, preserving other services', async t => {
  try { execFileSync('docker', ['compose', 'version', '--short'], { stdio: 'pipe', timeout: 10000 }); } // ambient-host-guard: allow real Compose availability probe; absent CLI skips, no daemon or runtime is used.
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('UNRUN: Docker CLI absent; qualification with real Compose is required.'); return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'dpf-preview-ports-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = join(directory, 'base.json');
  const override = join(directory, 'preview.yaml');
  const protectedPorts = ['0.0.0.0:3900:3900'];
  await writeFile(base, JSON.stringify({ services: {
    'dev-init': { image: 'fixture:not-started' },
    'dev-portal': { image: 'fixture:not-started', ports: ['0.0.0.0:3001:3000', '[::]:3001:3000', '0.0.0.0:9999:3000'] },
    protected: { image: 'fixture:not-started', ports: protectedPorts },
  } }));
  const identity = { worktree: directory, sha: 'a'.repeat(40), leaseId: 'NPEL-PORT-FIXTURE' };
  await writeFile(override, preview.serializePreviewOverride(identity));
  const config = JSON.parse(execFileSync('docker', ['compose', '-p', 'dpf-preview-port-test', '--project-directory', directory, // ambient-host-guard: allow real Compose merge regression on disposable files; config starts no services and needs no daemon.
    '-f', base, '-f', override, 'config', '--format', 'json'], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, COMPOSE_FILE: '', DPF_PREVIEW_AUTH_SECRET: 'disposable-fixture-only' },
  }));
  assert.deepEqual(config.services.protected.ports.map(p => [p.host_ip, p.published, p.target]), [['0.0.0.0', '3900', 3900]]);
  assert.deepEqual(config.services['dev-portal'].ports.map(p => [p.host_ip, p.published, p.target, p.protocol]),
    [['127.0.0.1', '3001', 3000, 'tcp']]);
  assert.equal(config.services['dev-init'].ports, undefined);
  assert.equal(config.services['dev-portal'].labels['dpf.preview.lease'], identity.leaseId);
});

for (const actual of [false, true]) {
  test((actual ? 'actual Docker' : 'rendered config') + ' port fence rejects absent, broad, mixed and wrong bindings', () => {
    const binding = (host, port = '3001') => actual
      ? { HostIp: host, HostPort: port }
      : { host_ip: host, published: port, target: 3000, protocol: 'tcp' };
    const identity = { worktree: resolve('/preview-fixture'), sha: 'a'.repeat(40), leaseId: 'NPEL-PORT-FIXTURE' };
    const verify = ports => {
      if (actual) return preview.assertPreviewContainer({
        Mounts: [{ Type: 'bind', Source: identity.worktree, Destination: '/workspace' }],
        Config: { Labels: preview.previewOverride(identity).services['dev-portal'].labels,
          Env: ['DPF_ENVIRONMENT_CLASS=development', 'DPF_PREVIEW_SOURCE_SHA=' + identity.sha, 'DPF_PREVIEW_LEASE_ID=' + identity.leaseId] },
        NetworkSettings: { Ports: { '3000/tcp': ports } },
      }, identity);
      const config = preview.previewOverride(identity);
      Object.assign(config.services['dev-init'].environment, { CONTRIBUTOR_PREVIEW_PASSWORD: 'fixture',
        DATABASE_URL: 'postgresql://fixture@dev-postgres/dpf', PRODUCTION_DATABASE_URL: 'postgresql://fixture@postgres/dpf' });
      config.services['dev-portal'].environment.DATABASE_URL = config.services['dev-init'].environment.DATABASE_URL;
      config.services['dev-portal'].ports = ports;
      return preview.assertPreviewConfig(config, identity);
    };
    for (const host of ['127.0.0.1', '::1']) verify([binding(host)]);
    for (const ports of [undefined, null, [], [binding('0.0.0.0')], [binding('::')],
      [binding('127.0.0.1'), binding('0.0.0.0')], [binding('127.0.0.1', '9999')]]) {
      assert.throws(() => verify(ports), /port_binding_mismatch/);
    }
    if (!actual) {
      assert.throws(() => verify([{ ...binding('127.0.0.1'), target: 9999 }]), /port_binding_mismatch/);
      assert.throws(() => verify([{ ...binding('127.0.0.1'), protocol: 'udp' }]), /port_binding_mismatch/);
    }
  });
}

test('actual inspection rejects an additional published port key, while allowing unbound exposed ports', () => {
  const identity = { worktree: resolve('/preview-fixture'), sha: 'a'.repeat(40), leaseId: 'NPEL-PORT-FIXTURE' };
  const container = {
    Mounts: [{ Type: 'bind', Source: identity.worktree, Destination: '/workspace' }],
    Config: { Labels: preview.previewOverride(identity).services['dev-portal'].labels,
      Env: ['DPF_ENVIRONMENT_CLASS=development', 'DPF_PREVIEW_SOURCE_SHA=' + identity.sha, 'DPF_PREVIEW_LEASE_ID=' + identity.leaseId] },
    NetworkSettings: { Ports: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3001' }], '9229/tcp': null } },
  };
  preview.assertPreviewContainer(container, identity);
  container.NetworkSettings.Ports['9229/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '9229' }];
  assert.throws(() => preview.assertPreviewContainer(container, identity), /actual_port_binding_mismatch/);
});
