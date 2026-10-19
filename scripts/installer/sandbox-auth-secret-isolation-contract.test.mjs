// BI-F1C680C7: the Build Studio sandbox never receives the portal's session
// secret. Build Studio runs coding CLIs inside the sandbox with permission
// prompts disabled (apps/web/lib/build/ideate-dispatch.ts, claude-dispatch.ts,
// opencode-dispatch.ts, routing/cli-adapter.ts) through a plain `docker exec`
// (apps/web/lib/build/sandbox/agent-cli-runtime.ts), which inherits the
// container's environment. The sandbox shares the compose default network with
// the portal and has open egress. Whoever holds AUTH_SECRET / NEXTAUTH_SECRET
// can mint portal Auth.js sessions, MCP session JWTs (lib/mcp/session-token.ts),
// mobile API access tokens (lib/api/jwt.ts) and automation sign-in links, so
// code an agent runs in the sandbox must never be able to read it.
//
// The sandbox runs its own copy of the web app against its own database and
// needs *a* secret for Auth.js, but nothing in it verifies a portal-issued
// token: portal-to-sandbox MCP access already uses a short-lived JWT the portal
// mints and hands over per call. So the sandbox's secret must be its own.
//
// Conformance over repository state, patterned on gpp-permit-secret-contract.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFile(join(root, path), "utf8");

const PORTAL_SECRETS = ["AUTH_SECRET", "NEXTAUTH_SECRET"];
// The base `sandbox` service and any pool slot (`sandbox-2`, `sandbox-3`, ...).
// `sandbox-init` and `sandbox-postgres` are not agent execution surfaces.
const SANDBOX_SERVICE = /^sandbox(?:-\d+)?$/;

/** Each top-level service block of a compose file, by name (two-space indent). */
function serviceBlocks(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^services:\s*$/.test(line));
  if (start < 0) return new Map();
  const blocks = new Map();
  let name = null;
  let body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key (volumes:, networks:, ...)
    const header = line.match(/^ {2}([A-Za-z0-9][\w.-]*):\s*(?:#.*)?$/);
    if (header) {
      if (name) blocks.set(name, body.join("\n"));
      name = header[1];
      body = [];
    } else if (name) {
      body.push(line);
    }
  }
  if (name) blocks.set(name, body.join("\n"));
  return blocks;
}

/** Lines of a service block that hand a portal secret to the container. */
function portalSecretLeaks(block) {
  const code = block.split("\n").filter((line) => !/^\s*#/.test(line));
  const leaks = [];
  for (const line of code) {
    for (const key of PORTAL_SECRETS) {
      const asMapKey = new RegExp(`^\\s+${key}\\s*:`);
      const asListItem = new RegExp(`^\\s+-\\s*["']?${key}(?:=|["']?\\s*$)`);
      const asInterpolation = new RegExp(`\\$\\{?${key}\\b`);
      if (asMapKey.test(line) || asListItem.test(line) || asInterpolation.test(line)) {
        leaks.push(line.trim());
      }
    }
  }
  return leaks;
}

async function composeFiles() {
  const names = await readdir(root);
  return names.filter((name) => /^docker-compose(?:\.[\w.-]+)?\.ya?ml$/.test(name)).sort();
}

test("the compose files define the sandbox service this contract guards", async () => {
  const blocks = serviceBlocks(await read("docker-compose.yml"));
  assert.ok(blocks.has("sandbox"), "docker-compose.yml must define the sandbox service");
  assert.match(blocks.get("sandbox"), /dockerfile: Dockerfile\.sandbox/, "the guarded block is the Build Studio sandbox");
});

test("no compose file hands AUTH_SECRET or NEXTAUTH_SECRET to a sandbox service", async () => {
  const leaks = [];
  for (const file of await composeFiles()) {
    for (const [service, block] of serviceBlocks(await read(file))) {
      if (!SANDBOX_SERVICE.test(service)) continue;
      for (const line of portalSecretLeaks(block)) leaks.push(`${file} services.${service}: ${line}`);
      // An env_file would hand over the whole install .env, AUTH_SECRET included.
      if (/^\s+env_file\s*:/m.test(block)) leaks.push(`${file} services.${service}: env_file`);
    }
  }
  assert.deepEqual(leaks, [], `the sandbox must not receive the portal session secret (BI-F1C680C7):\n${leaks.join("\n")}`);
});

test("the sandbox image does not bake a portal secret into its environment", async () => {
  const dockerfile = await read("Dockerfile.sandbox");
  const code = dockerfile.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n");
  for (const key of PORTAL_SECRETS) {
    assert.doesNotMatch(code, new RegExp(`^\\s*(?:ENV|ARG)\\s+${key}\\b`, "m"), `Dockerfile.sandbox must not declare ${key}`);
  }
});
