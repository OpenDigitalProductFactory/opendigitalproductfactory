// Agent sandbox containment (design 2026-10-21, AC-1 and AC-2). Build Studio
// runs coding CLIs in the `sandbox` service with their approvals disabled, so
// the container's own profile is the boundary. This pins that profile to the
// repository so a removal or widening fails CI instead of shipping silently.
// The runtime verification record lives in config/sandbox/README.md.
//
// Conformance over repository state, patterned on
// sandbox-auth-secret-isolation-contract.test.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFile(join(root, path), "utf8");

/** The body of one top-level compose service block (two-space indent). */
function serviceBlock(text, service) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${service}:`);
  assert.ok(start >= 0, `docker-compose.yml has no ${service} service`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || /^\S/.test(line)) break;
    body.push(line);
  }
  return body.filter((line) => !/^\s*#/.test(line)).join("\n");
}

const CAP_ADD = ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "KILL"];
const TMPFS = ["/tmp", "/root", "/home/node"];

test("the sandbox service drops every capability and adds back only the proven six", async () => {
  const sandbox = serviceBlock(await read("docker-compose.yml"), "sandbox");
  assert.match(sandbox, /^ {4}cap_drop: \[ALL\]$/m);
  const added = sandbox.match(/^ {4}cap_add: \[([^\]]*)\]$/m);
  assert.ok(added, "sandbox.cap_add must be a single flow list");
  assert.deepEqual(added[1].split(",").map((cap) => cap.trim()), CAP_ADD,
    "widening sandbox.cap_add is a containment change: update this test and config/sandbox/README.md with the removal evidence");
  assert.doesNotMatch(sandbox, /privileged:\s*true/);
  assert.doesNotMatch(sandbox, /docker\.sock/);
});

test("the sandbox service runs with no-new-privileges and the checked-in seccomp profile", async () => {
  const sandbox = serviceBlock(await read("docker-compose.yml"), "sandbox");
  assert.match(sandbox, /^ {6}- no-new-privileges:true$/m);
  assert.match(sandbox, /^ {6}- seccomp=\.\/config\/sandbox\/seccomp\.json$/m);
  assert.doesNotMatch(sandbox, /seccomp[=:]unconfined/);
  assert.doesNotMatch(sandbox, /apparmor[=:]unconfined/);
});

test("the seccomp profile is deny-by-default and grants no unprivileged ptrace", async () => {
  const profile = JSON.parse(await read("config/sandbox/seccomp.json"));
  assert.equal(profile.defaultAction, "SCMP_ACT_ERRNO");
  const ptraceFamily = ["ptrace", "process_vm_readv", "process_vm_writev", "pidfd_getfd"];
  for (const rule of profile.syscalls) {
    if (rule.action !== "SCMP_ACT_ALLOW") continue;
    if (!rule.names.some((name) => ptraceFamily.includes(name))) continue;
    assert.deepEqual(rule.includes?.caps, ["CAP_SYS_PTRACE"],
      `${rule.names.join(",")} may only be allowed behind CAP_SYS_PTRACE, which the sandbox drops`);
  }
});

test("the sandbox root is read-only and its writable tmpfs mounts are size-capped", async () => {
  const sandbox = serviceBlock(await read("docker-compose.yml"), "sandbox");
  assert.match(sandbox, /^ {4}read_only: true$/m);
  const mounts = [...sandbox.matchAll(/^ {6}- (\/[\w/.-]+):(\S+)$/gm)].map(([, path, opts]) => ({ path, opts: opts.split(",") }));
  assert.deepEqual(mounts.map((mount) => mount.path), TMPFS);
  for (const { path, opts } of mounts) {
    assert.ok(opts.some((opt) => /^size=\d+[kmg]$/.test(opt)), `${path} tmpfs needs a size cap`);
    // The portal runs runner scripts from /tmp; corepack runs pnpm from the home cache.
    assert.ok(opts.includes("exec"), `${path} tmpfs must be mounted exec`);
  }
});

test("the image restores its homes into the empty tmpfs, and ships the profile to release installs", async () => {
  const dockerfile = await read("Dockerfile.sandbox");
  assert.match(dockerfile, /cp -a \/root \/opt\/dpf-home-seed\/root/);
  assert.match(dockerfile, /cp -a \/home\/node \/opt\/dpf-home-seed\/node/);
  const entrypoint = await read("scripts/sandbox-entrypoint.sh");
  assert.match(entrypoint, /seed_home root /);
  assert.match(entrypoint, /seed_home node /);
  // Consumer installs have no checkout: compose resolves the seccomp path in the
  // install directory, which is the image's /dpf-release-assets bundle.
  const release = await read("Dockerfile");
  assert.match(release, /cp config\/sandbox\/seccomp\.json \/dpf-release-assets\/config\/sandbox\//);
});

test("the egress allowlist is exactly the reviewed host set", async () => {
  const hosts = (await read("config/sandbox/egress-allowlist.txt"))
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(hosts, [
    "^registry\\.npmjs\\.org$",
    "^github\\.com$",
    "^codeload\\.github\\.com$",
    "^objects\\.githubusercontent\\.com$",
    "^binaries\\.prisma\\.sh$",
    "^api\\.anthropic\\.com$",
    "^api\\.openai\\.com$",
    "^auth\\.openai\\.com$",
    "^chatgpt\\.com$",
    "^api\\.x\\.ai$",
    "^host\\.docker\\.internal$",
    "^model-runner\\.docker\\.internal$",
  ], "widening the sandbox egress allowlist is a security change: update this list in the same commit");
  for (const host of hosts) assert.match(host, /^\^.*\$$/, `${host} must be anchored at both ends`);
  const proxy = await read("config/sandbox/tinyproxy.conf");
  assert.match(proxy, /^FilterDefaultDeny Yes$/m);
  assert.match(proxy, /^FilterType ere$/m);
  assert.match(proxy, /^Filter "\/etc\/tinyproxy\/egress-allowlist\.txt"$/m);
  assert.deepEqual([...proxy.matchAll(/^ConnectPort (\d+)$/gm)].map(([, port]) => port).sort(), ["443", "80"]);
});
