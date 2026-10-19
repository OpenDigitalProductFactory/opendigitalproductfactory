// Containers whose PID 1 does not reap orphaned children must run Docker's
// init (BI-95BB9CB1). Without it the sandbox leaked 75,868 zombie git
// processes and the TLS proxy 11,573 zombie health-check probes on one
// install, until Docker could no longer fork.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The lines of one top-level service block in a compose file. */
export function serviceBlock(compose, service) {
  const lines = compose.split("\n");
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:\s*$/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

export function runsInit(compose, service) {
  const block = serviceBlock(compose, service);
  return block !== null && block.some((line) => /^    init:\s*true\s*$/.test(line));
}

const MUST_REAP = [
  { file: "docker-compose.yml", service: "sandbox", why: "a shell entrypoint is PID 1" },
  { file: "docker-compose.tls.yml", service: "portal-tls", why: "caddy is PID 1" },
];

for (const { file, service, why } of MUST_REAP) {
  test(`${file} runs ${service} with init: true (${why})`, () => {
    const compose = readFileSync(join(root, file), "utf8");
    assert.ok(serviceBlock(compose, service), `${service} not found in ${file}`);
    assert.ok(runsInit(compose, service), `${service} in ${file} must set init: true so orphaned children are reaped`);
  });
}

test("runsInit reads only the named service's own block", () => {
  const compose = ["services:", "  a:", "    image: x", "  b:", "    init: true", ""].join("\n");
  assert.equal(runsInit(compose, "a"), false);
  assert.equal(runsInit(compose, "b"), true);
});
