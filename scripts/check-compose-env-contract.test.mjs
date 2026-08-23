import { test } from "node:test";
import assert from "node:assert/strict";
import {
  declaredEnvKeys,
  hostPartOf,
  varRefs,
  findComposeEnvViolations,
  findReleaseRuntimeContextViolations,
} from "./check-compose-env-contract.mjs";

test("hostPartOf keeps ${A:-B} colons out of the split", () => {
  assert.equal(hostPartOf("${DPF_STATE_DIR:-${HOME}/.dpf}:/dpf-state:ro"), "${DPF_STATE_DIR:-${HOME}/.dpf}");
  assert.equal(hostPartOf("${DPF_HOST_INSTALL_PATH:-.}:/host-dpf"), "${DPF_HOST_INSTALL_PATH:-.}");
});

test("varRefs returns refs in order (primary first)", () => {
  assert.deepEqual(varRefs("${DPF_STATE_DIR:-${HOME}/.dpf}"), ["DPF_STATE_DIR", "HOME"]);
});

test("declaredEnvKeys reads commented and uncommented KEY= lines", () => {
  const keys = declaredEnvKeys("DPF_STATE_DIR=\n# DPF_HOST_INSTALL_PATH=/x\nfoo");
  assert.ok(keys.has("DPF_STATE_DIR"));
  assert.ok(keys.has("DPF_HOST_INSTALL_PATH"));
});

test("catches a DPF_* mount var undeclared in .env.example (the #3262 regression)", () => {
  const compose = "    volumes:\n      - ${DPF_STATE_DIR:-${HOME}/.dpf}:/dpf-state:ro";
  const v = findComposeEnvViolations("docker-compose.yml", compose, new Set()); // nothing declared
  assert.equal(v.length, 1);
  assert.match(v[0].message, /DPF_STATE_DIR/);
  assert.match(v[0].message, /not declared/i);
});

test("passes once the DPF_* primary is declared (HOME fallback tolerated)", () => {
  const compose = "      - ${DPF_STATE_DIR:-${HOME}/.dpf}:/dpf-state:ro";
  const v = findComposeEnvViolations("docker-compose.yml", compose, new Set(["DPF_STATE_DIR"]));
  assert.equal(v.length, 0);
});

test("catches a system var used as the PRIMARY path determiner", () => {
  const compose = "      - ${HOME}/.dpf:/dpf-state:ro";
  const v = findComposeEnvViolations("docker-compose.yml", compose, new Set(["DPF_STATE_DIR"]));
  assert.equal(v.length, 1);
  assert.match(v[0].message, /PRIMARY/);
});

test("respects the # compose-env-allow escape", () => {
  const compose = "      - ${HOME}/.dpf:/dpf-state:ro  # compose-env-allow";
  const v = findComposeEnvViolations("docker-compose.yml", compose, new Set());
  assert.equal(v.length, 0);
});

test("ignores named volumes and non-interpolated mounts", () => {
  const compose = "      - pgdata:/var/lib/postgresql/data\n      - ./local:/app";
  const v = findComposeEnvViolations("docker-compose.yml", compose, new Set());
  assert.equal(v.length, 0);
});

test("catches a portal that cannot see the registry owner used by release Compose", () => {
  const broken = [
    "services:",
    "  portal:",
    "    environment:",
    "      DPF_IMAGE_TAG: ${DPF_IMAGE_TAG:-}",
    "  postgres:",
    "    image: postgres:16",
  ].join("\n");
  const valid = broken.replace(
    "      DPF_IMAGE_TAG: ${DPF_IMAGE_TAG:-}",
    "      DPF_IMAGE_TAG: ${DPF_IMAGE_TAG:-}\n      GHCR_OWNER: ${GHCR_OWNER:-opendigitalproductfactory}",
  );

  assert.match(findReleaseRuntimeContextViolations(broken)[0]?.message ?? "", /falls back to Git/);
  assert.deepEqual(findReleaseRuntimeContextViolations(valid), []);
});
