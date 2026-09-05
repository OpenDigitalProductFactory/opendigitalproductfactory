import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  portEntries,
  hostPartOfMapping,
  findBindPostureViolations,
  REQUIRED_HOST_PART,
} from "./check-compose-bind-posture.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("portEntries reads every entry under a ports block and stops at the next key", () => {
  const compose = [
    "  portal:",
    "    ports:",
    '      - "3000:3000"',
    '      - "1455:3000"  # callback',
    "    environment:",
    '      - "NOT_A_PORT=1"',
  ].join("\n");
  assert.deepEqual(
    portEntries(compose).map((e) => e.value),
    ["3000:3000", "1455:3000"],
  );
});

test("hostPartOfMapping separates the host part from host-port:container-port", () => {
  assert.equal(hostPartOfMapping("3000:3000"), null);
  assert.equal(hostPartOfMapping("127.0.0.1:3000:3000"), "127.0.0.1");
  assert.equal(hostPartOfMapping(`${REQUIRED_HOST_PART}:3000:3000`), REQUIRED_HOST_PART);
  assert.equal(hostPartOfMapping("${DPF_LOCAL_CI_PORT:?msg}:3000"), null);
});

test("flags short syntax (every interface) with the exact replacement", () => {
  const v = findBindPostureViolations("docker-compose.yml", '    ports:\n      - "3000:3000"\n');
  assert.equal(v.length, 1);
  assert.match(v[0].message, /every interface/);
  assert.match(v[0].message, /\$\{DPF_HOST_BIND_ADDRESS:-127\.0\.0\.1\}:3000:3000/);
});

test("accepts a hardcoded loopback host (stricter than the default) and a per-service override nested on the host variable", () => {
  const compose = [
    "    ports:",
    '      - "127.0.0.1:3100:3100"',
    '      - "${DPF_LDAP_BIND_ADDRESS:-${DPF_HOST_BIND_ADDRESS:-127.0.0.1}}:636:636"',
  ].join("\n");
  assert.deepEqual(findBindPostureViolations("docker-compose.yml", compose), []);
});

test("flags a hardcoded non-loopback host and a per-service override that does not fall back to the host variable", () => {
  const compose = [
    "    ports:",
    '      - "0.0.0.0:3000:3000"',
    '      - "${DPF_LDAP_BIND_ADDRESS:-0.0.0.0}:636:636"',
  ].join("\n");
  const v = findBindPostureViolations("docker-compose.yml", compose);
  assert.equal(v.length, 2);
  assert.match(v[0].message, /host part must be/);
});

test("passes when every mapping binds through the variable", () => {
  const v = findBindPostureViolations(
    "docker-compose.yml",
    `    ports:\n      - "${REQUIRED_HOST_PART}:3000:3000"\n      - "${REQUIRED_HOST_PART}:5432:5432"\n`,
  );
  assert.equal(v.length, 0);
});

test("the shipped docker-compose.yml satisfies the posture", () => {
  const text = readFileSync(join(root, "docker-compose.yml"), "utf8");
  const v = findBindPostureViolations("docker-compose.yml", text);
  assert.deepEqual(v.map((x) => `${x.line}: ${x.value}`), []);
});
