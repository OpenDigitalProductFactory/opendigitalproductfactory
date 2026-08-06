// check-host-port-range.test.mjs — fleet-wide guard: no Compose/slot host port
// may live in the Windows ephemeral range (49152-65535), where Hyper-V/WinNAT
// re-rolls reservations every boot and turns a static host port into a
// boot-flaky WSAEACCES bind. Every install builds from these same sources on
// Windows hosts, so one high port ships the failure to the whole fleet (it did,
// via #3784). See docs/operations/local-ci-sandbox-slots.md.

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EPHEMERAL_START,
  EPHEMERAL_END,
  composeHostPorts,
  findEphemeralHostPorts,
  hostPortFromComposeEntry,
  isEphemeralHostPort,
  scanHostPorts,
} from "./lib/host-port-range.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Guard the parser first: a scanner that silently mis-parses a mapping would
// report "clean" while missing real violations, so pin the tricky forms.
test("host-port parser resolves every Compose mapping shape", () => {
  const expectations = [
    ["5433:5432", 5433],
    ["3000:3000", 3000],
    ["127.0.0.1:9187:9187", 9187],
    ["${DPF_TLS_HTTP_PORT:-80}:80", 80], // env default, one span
    ["${A:-127.0.0.1}:${DPF_PKI_PORT:-9000}:9000", 9000], // two spans, ip:host:container
    ["${DPF_LOCAL_CI_PORT:?must be set}:3000", null], // env-required, no literal default
    ["6379", null], // container-only, no host binding
    ["53/udp", null],
  ];
  for (const [entry, expected] of expectations) {
    assert.equal(hostPortFromComposeEntry(entry), expected, `parse ${entry}`);
  }
});

test("the guard can actually fail (range boundaries + positive catch)", () => {
  assert.equal(isEphemeralHostPort(EPHEMERAL_START - 1), false); // 49151 ok
  assert.equal(isEphemeralHostPort(EPHEMERAL_START), true); // 49152 caught
  assert.equal(isEphemeralHostPort(EPHEMERAL_END), true); // 65535 caught
  assert.equal(isEphemeralHostPort(15432), false); // the chosen slot port is safe

  // A synthetic offending Compose block must surface as a violation, so the
  // guard proves it is not a silent no-op.
  const offending = "  db:\n    ports:\n      - \"54329:5432\"\n";
  const ports = composeHostPorts(offending);
  assert.deepEqual(ports, [54329]);
  assert.ok(ports.some(isEphemeralHostPort));
});

test("the scanner actually reaches every compose file (no silent misses)", () => {
  const ports = new Set(scanHostPorts(REPO_ROOT).map((f) => f.port));
  // Anchors from distinct files/forms: literal, dev-only, env-default (tls/pki),
  // and the slot manifest. If any disappears the scanner has gone blind.
  for (const anchor of [3000, 5433, 5432, 80, 443, 8443, 9000, 15432, 15433]) {
    assert.ok(ports.has(anchor), `expected scanner to see host port ${anchor}`);
  }
});

test("no host port lives in the Windows ephemeral range", () => {
  const violations = findEphemeralHostPorts(REPO_ROOT);
  assert.deepEqual(
    violations,
    [],
    `host ports in ${EPHEMERAL_START}-${EPHEMERAL_END} bind flakily on Windows ` +
      `(WinNAT re-rolls reservations each boot). Move them below ${EPHEMERAL_START}. ` +
      `Offenders: ${violations.map((v) => `${v.port} (${v.source})`).join(", ")}`,
  );
});
