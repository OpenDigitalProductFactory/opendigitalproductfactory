import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, copyFileSync, existsSync, fstatSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BASH_OK, GIT_OK, makeScratch, PROMOTE_TEST_TIMEOUT_MS, promoteDiagnostics, runPromote } from "./promote-script-functional.test-support";

const KEY = "DPF_REMOTE_ACTION_DISPATCH_ENABLED";
const CONFIGURED = "DPF_EDGE_ACTION_DISPATCH_CONFIGURED";
const FIXTURE_KEYS = ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY", "DPF_GIT_WEBHOOK_SECRET", "DPF_GPP_PERMIT_SECRET", "DPF_ATTENTION_REACH_SECRET", "DPF_DELEGATION_RECEIPT_SECRET", "DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", "DPF_DELIVERY_TASK_CURSOR_SECRET"];

function fixtureEnvSnapshot(path: string) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const identity = fstatSync(fd, { bigint: true });
    if (!identity.isFile()) throw new Error("fixture env must be a regular file");
    return { ino: identity.ino, text: readFileSync(fd, "utf8") };
  } finally { closeSync(fd); }
}

function setup(mode: "source" | "release", env = `${CONFIGURED}=1\n`) {
  const f = makeScratch();
  const installRoot = join(f.root, "install");
  mkdirSync(installRoot, { recursive: true });
  const envPath = join(installRoot, ".env");
  writeFileSync(envPath, `KEEP_ME=unchanged\nDPF_HOST_BIND_ADDRESS=127.0.0.1\n${FIXTURE_KEYS.map(key => `${key}=${"e".repeat(64)}`).join("\n")}\n${env}`);
  const dockerLog = join(f.root, "docker.log");
  const targetSha = mode === "release" ? "b".repeat(40) : f.head;
  let release: Parameters<typeof runPromote>[0]["release"];
  if (mode === "release") {
    rmSync(join(f.source, ".git"), { recursive: true, force: true });
    writeFileSync(join(f.source, "docker-compose.release.yml"), "services: {}\n");
    writeFileSync(join(f.source, ".install-mode"), "consumer\n");
    const candidateAssets = join(f.root, "assets");
    mkdirSync(candidateAssets);
    for (const path of ["docker-compose.yml", "docker-compose.release.yml", "scripts/lib/resolve-capability-compose-profiles.mjs", "scripts/lib/govern-capability-compose-args.mjs", "scripts/lib/script-argv.mjs", "scripts/lib/capability-state-hash.mjs", "scripts/capability-service-catalog.generated.json"]) {
      mkdirSync(resolve(candidateAssets, path, ".."), { recursive: true });
      copyFileSync(join(f.source, path), join(candidateAssets, path));
    }
    const files = readdirSync(candidateAssets, { recursive: true }).map(String).filter(path => statSync(join(candidateAssets, path)).isFile());
    writeFileSync(join(candidateAssets, "SHA256SUMS"), files.map(path => `${createHash("sha256").update(readFileSync(join(candidateAssets, path))).digest("hex")}  ./${path.replaceAll("\\", "/")}`).join("\n") + "\n");
    const statePath = join(f.backup, "state", "install-state.json");
    writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, "utf8")), installerVersion: "v1.0.0", lastSuccessfulInstallVersion: "v1.0.0", imageTag: "v1.0.0", installMode: "consumer", installPath: installRoot, composeFiles: ["docker-compose.yml", "docker-compose.release.yml"] }) + "\n");
    const gitLog = join(f.root, "git.log");
    writeFileSync(join(f.fakeBin, "git"), '#!/bin/sh\nprintf "unexpected git\\n" >> "$GIT_LOG"\nexit 97\n');
    chmodSync(join(f.fakeBin, "git"), 0o755);
    release = { tag: "v2.0.0", owner: "opendigitalproductfactory", channelDigest: `sha256:${"a".repeat(64)}`, platformManifestDigest: `sha256:${"b".repeat(64)}`, configDigest: `sha256:${"c".repeat(64)}`, candidateAssets, gitLog };
  }
  return { ...f, installRoot, envPath, dockerLog, targetSha, release };
}

describe.skipIf(!BASH_OK || !GIT_OK)("same-promotion configured Edge dispatch", () => {
  it.each(["source", "release"] as const)("the first %s portal recreation receives its configured missing default", mode => {
    const f = setup(mode);
    try {
      const r = runPromote({ ...f, composeEnvFile: f.envPath });
      expect(r.status, promoteDiagnostics(r, { dockerLog: f.dockerLog })).toBe(0);
      const calls = readFileSync(f.dockerLog, "utf8");
      expect(calls.match(/^dispatch service=portal value=(\S+)/m)?.[1], calls.split("\n").filter(line => line.startsWith("dispatch ")).join("\n")).toBe("1");
      expect(readFileSync(f.envPath, "utf8")).toMatch(new RegExp(`^${KEY}=1$`, "m"));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it.each(["source", "release"] as const)("%s keeps one-shot process values out of the persistent file", mode => {
    for (const override of ["0", "1", "", "invalid"]) {
      const f = setup(mode);
      try {
        const r = runPromote({ ...f, composeEnvFile: f.envPath, dispatchOverride: override });
        expect(r.status, promoteDiagnostics(r)).toBe(0);
        const calls = readFileSync(f.dockerLog, "utf8");
        expect(calls.match(/^dispatch service=portal value=(\S+)/m)?.[1]).toBe(override || "0");
        expect(readFileSync(f.envPath, "utf8")).not.toMatch(new RegExp(`^${KEY}=`, "m"));
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it.each(["source", "release"] as const)("%s distinguishes durable configuration from one-shot configuration", mode => {
    for (const input of [
      { env: "", configuredOverride: undefined, expected: "0" },
      { env: `${CONFIGURED}=0\n`, configuredOverride: undefined, expected: "0" },
      { env: `${CONFIGURED}=1\n`, configuredOverride: "0", expected: "0" },
      { env: `${CONFIGURED}=0\n`, configuredOverride: "1", expected: "1" },
      { env: `${CONFIGURED}=1\n${KEY}=\n`, configuredOverride: undefined, expected: "0" },
    ]) {
      const f = setup(mode, input.env);
      try {
        const before = readFileSync(f.envPath, "utf8");
        const r = runPromote({ ...f, composeEnvFile: f.envPath, configuredOverride: input.configuredOverride });
        expect(r.status, promoteDiagnostics(r)).toBe(0);
        expect(readFileSync(f.dockerLog, "utf8").match(/^dispatch service=portal value=(\S+)/m)?.[1]).toBe(input.expected);
        const after = readFileSync(f.envPath, "utf8");
        expect(after.match(new RegExp(`^${KEY}=.*$`, "m"))?.[0]).toBe(before.match(new RegExp(`^${KEY}=.*$`, "m"))?.[0]);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it.each(["source", "release"] as const)("%s preserves explicit quoted file settings and an overriding process value", mode => {
    for (const value of ["0", "1"]) {
      const line = `${KEY}="${value}"\r\n`;
      const f = setup(mode, `${CONFIGURED}=1\r\n${line}`);
      try {
        const r = runPromote({ ...f, composeEnvFile: f.envPath });
        expect(r.status, promoteDiagnostics(r)).toBe(0);
        expect(readFileSync(f.dockerLog, "utf8").match(/^dispatch service=portal value=(\S+)/m)?.[1]).toBe(value);
        expect(readFileSync(f.envPath, "utf8")).toContain(line);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    }
    const f = setup(mode, `${CONFIGURED}=1\n${KEY}=0\n`);
    try {
      const r = runPromote({ ...f, composeEnvFile: f.envPath, dispatchOverride: "1" });
      expect(r.status, promoteDiagnostics(r)).toBe(0);
      expect(readFileSync(f.dockerLog, "utf8")).toMatch(/^dispatch service=portal value=1 /m);
      expect(readFileSync(f.envPath, "utf8")).toMatch(new RegExp(`^${KEY}=0$`, "m"));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("unwinds the derived process override before the actual old-image rollback recreation", () => {
    const f = setup("release");
    try {
      writeFileSync(join(f.installRoot, ".verified-release-assets.sha256"), "invalid prior manifest\n");
      const r = runPromote({ ...f, composeEnvFile: f.envPath });
      expect(r.status).not.toBe(0);
      const calls = readFileSync(f.dockerLog, "utf8").split("\n").filter(line => line.startsWith("dispatch service=portal "));
      expect(calls).toEqual(["dispatch service=portal value=1 process_present=x", "dispatch service=portal value=0 process_present="]);
      expect(readFileSync(f.envPath, "utf8")).not.toMatch(new RegExp(`^${KEY}=`, "m"));
      expect(r.stdout).not.toContain("step=done");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("keeps the release transaction's canonical owner despite an old-inode selected bind", () => {
    const f = setup("release");
    try {
      const alias = join(f.root, "selected.env");
      linkSync(f.envPath, alias);
      const inode = fixtureEnvSnapshot(alias).ino;
      const r = runPromote({ ...f, composeEnvFile: alias });
      expect(r.status, promoteDiagnostics(r)).toBe(0);
      const selected = fixtureEnvSnapshot(alias);
      const canonical = fixtureEnvSnapshot(f.envPath);
      expect(selected.ino).toBe(inode);
      expect(canonical.ino).not.toBe(inode);
      expect(canonical.text).toMatch(new RegExp(`^${KEY}=1$`, "m"));
      expect(selected.text).not.toMatch(new RegExp(`^${KEY}=`, "m"));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("reports source post-swap uncertainty without erasing an existing recovery checkpoint", () => {
    const f = setup("source");
    try {
      const recovery = join(f.backup, "dispatch-env");
      mkdirSync(recovery);
      writeFileSync(join(recovery, "env.before"), "original checkpoint\n");
      writeFileSync(join(recovery, "dispatch-env.json"), '{"state":"original"}\n');
      const r = runPromote({ ...f, composeEnvFile: f.envPath });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("persistence is unproven after portal swap");
      expect(r.stdout).not.toContain("step=done");
      expect(readFileSync(f.dockerLog, "utf8").split("\n").filter(line => line.startsWith("dispatch service=portal "))).toEqual(["dispatch service=portal value=1 process_present=x"]);
      expect(readFileSync(join(recovery, "env.before"), "utf8")).toBe("original checkpoint\n");
      expect(readFileSync(join(recovery, "dispatch-env.json"), "utf8")).toBe('{"state":"original"}\n');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("does not claim a checkpoint was retained when its directory could not be created", () => {
    const f = setup("source");
    try {
      const recovery = join(f.backup, "dispatch-env");
      writeFileSync(recovery, "blocked recovery directory\n");
      const r = runPromote({ ...f, composeEnvFile: f.envPath });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("persistence is unproven after portal swap");
      expect(r.stderr).not.toContain("recovery retained");
      expect(existsSync(join(recovery, "env.before"))).toBe(false);
      expect(r.stdout).not.toContain("step=done");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it.each(["build", "dry-run"] as const)("%s does not persist the derived setting or recreate the portal", phase => {
    const f = setup("source");
    try {
      const before = readFileSync(f.envPath);
      const r = runPromote({ ...f, composeEnvFile: f.envPath, phase: phase === "build" ? "build" : undefined, dryRun: phase === "dry-run" });
      expect(r.status, promoteDiagnostics(r)).toBe(0);
      expect(readFileSync(f.envPath)).toEqual(before);
      expect(existsSync(f.dockerLog) ? readFileSync(f.dockerLog, "utf8") : "").not.toContain("dispatch service=portal ");
      expect(existsSync(join(f.backup, "dispatch-env"))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("an unavailable explicit env file cannot fall back to a configured workspace env", () => {
    const f = setup("source");
    try {
      writeFileSync(join(f.source, ".env"), `${CONFIGURED}=1\n`);
      const r = runPromote({ ...f, composeEnvFile: join(f.root, "missing.env") });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("PROMOTE_COMPOSE_ENV_FILE is not readable");
      expect(existsSync(f.dockerLog) ? readFileSync(f.dockerLog, "utf8") : "").not.toContain("dispatch service=portal ");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);
});
