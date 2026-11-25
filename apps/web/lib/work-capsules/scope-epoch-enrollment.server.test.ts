import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { signMaintenanceEpoch } from "../../../../scripts/lib/maintenance-epoch-receipt.mjs";
import { attestScopeWriterProcess } from "./scope-epoch-writer-probe.mjs";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("node:fs/promises", { spy: true });
vi.mock("node:os", { spy: true });
vi.mock("@/lib/shared/run-process-with-budget", { spy: true });
import { assertScopeEpochEnrollmentReady, currentScopeWriterContainerId, type ScopeEpochEnrollmentPorts } from "./scope-epoch-enrollment.server";
import { SCOPE_EPOCH_WRITER_PATHS } from "./scope-epoch-contract";
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const now = new Date("2026-10-16T01:03:00Z"), secret = "test-only-key".repeat(8);
const source = "a".repeat(40), image = `sha256:${"c".repeat(64)}`;
const before = { portal: { id: "1".repeat(64), startedAt: "2026-10-15T00:00:00Z" }, sandbox: { id: "2".repeat(64), startedAt: "2026-10-15T00:00:00Z" } };
const after = { portal: { id: "3".repeat(64), startedAt: "2026-10-16T01:01:00Z" }, sandbox: { id: "4".repeat(64), startedAt: "2026-10-16T01:01:00Z" } };
const recovery = { schemaVersion: 1, status: "ok", trigger: "pre-upgrade-recovery", selfUpgradeRunId: "SUR-TEST",
  createdAt: "2026-10-16T00:58:00Z", members: [{ target: "postgres", runId: "BACKUP-TEST", status: "ok" }] };
function fixture() {
  const writerPath = (name: string) => `/app/${name.replace(/^apps\/web\//, "apps/web-src/")}`;
  const proof = { schemaVersion: 1, version: 1, sourceSha: source, sourceContentHash: "b".repeat(64),
    contractSha256: hash("fixture contract"), writers: Object.fromEntries(SCOPE_EPOCH_WRITER_PATHS.map(name => [name, hash(writerPath(name))])) };
  const receipt = signMaintenanceEpoch({ schemaVersion: 1, runId: "SUR-TEST", targetSha: source,
    promoterDigest: `sha256:${"d".repeat(64)}`, recoveryPointDigest: hash(canonicalJson(recovery)), project: "dpf", daemonId: "daemon-test",
    capturedAt: "2026-10-16T01:00:00Z", completedAt: "2026-10-16T01:02:00Z", before, after,
    retiredContainerIds: [before.portal.id, before.sandbox.id], inventoryDigest: "e".repeat(64) }, secret);
  const run = { runId: "SUR-TEST", status: "succeeded", targetSha: source, deployedSha: source, startedAt: new Date("2026-10-16T00:59:00Z"),
    completionEvidence: { recoveryPoint: recovery, readiness: { result: "ready", mode: "enforced", targetSha: source, imageDigest: `sha256:${"d".repeat(64)}` }, maintenanceEpochRetirement: receipt } };
  const state = { activeActuator: false, oldPresent: false, project: "dpf", daemon: "daemon-test", imported: true };
  const commands: string[][] = [];
  const ports: ScopeEpochEnrollmentPorts = {
    now: () => now,
    attachRetirement: async () => state.imported ? { status: "replayed", runId: "SUR-TEST" } : { status: "unavailable" },
    readRun: async () => run,
    readFile: async path => path === "/proc/self/cgroup" ? "0::/\n" : path === "/proc/self/mountinfo"
      ? `1 2 0:1 /var/lib/docker/containers/${after.portal.id}/hostname /etc/hostname rw - ext4 /dev/sda rw\n`
      : path === "/app/.dpf-image-version" ? source : path === "/app/.dpf-source-content-hash" ? "b".repeat(64)
      : path === "/dpf-state/runtime-transition.secret" ? secret : path.endsWith("scope-epoch-contract.ts") ? "fixture contract" : path,
    runDocker: async args => {
      commands.push(args);
      let stdout = "";
      if (args[0] === "run") stdout = JSON.stringify(proof);
      else if (args[0] === "info") stdout = state.daemon;
      else if (args.includes("name=dpf-promoter")) stdout = state.activeActuator ? "9".repeat(64) : "";
      else if (args[0] === "ps") stdout = [after.portal.id, after.sandbox.id, ...(state.oldPresent && !args.includes("--filter") ? [before.portal.id] : [])].join("\n");
      else if (args.some(value => value.includes('"image"'))) stdout = JSON.stringify({ id: after.portal.id, image, running: true,
        hostname: hostname(), labels: { "com.docker.compose.service": "portal", "com.docker.compose.project": state.project } });
      else {
        stdout = args.slice(5).map(id => {
          const service = id === after.portal.id ? "portal" : "sandbox";
          return JSON.stringify({ Id: after[service].id, State: { Running: true, StartedAt: after[service].startedAt },
            Config: { Labels: { "com.docker.compose.service": service, "com.docker.compose.project": state.project } } });
        }).join("\n");
      }
      return { exitCode: 0, stdout, stderr: "" };
    },
  };
  const locks: string[] = [];
  const tx = { $executeRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join("?")); },
    $queryRaw: async (strings: TemplateStringsArray) => {
      expect(strings.join("?")).toBe("SHOW transaction_isolation");
      return [{ transaction_isolation: "read committed" }];
    },
    runtimeCapabilityTransition: { findFirst: vi.fn(async (): Promise<unknown> => null) },
    selfUpgradeRun: { findFirst: vi.fn(async (): Promise<unknown> => null) } };
  return { ports, proof, run, state, commands, locks, tx, receipt };
}

describe("canonical scope epoch enrollment", () => {
  it.each([
    ["/proc/self/cgroup", "read-process-cgroup"],
    ["/proc/self/mountinfo", "read-process-mounts"],
    ["/app/.dpf-image-version", "read-image-version"],
    ["/app/.dpf-source-content-hash", "read-source-content-hash"],
    ["/app/apps/web-src/lib/work-capsules/scope-epoch-contract.ts", "read-writer-contract"],
    ["/app/apps/web-src/lib/work-capsules.ts", "read-writer-source"],
    ["/dpf-state/runtime-transition.secret", "read-transition-secret"],
  ])("reports the bounded step for a missing %s", async (file, step) => {
    const { ports } = fixture(), readFile = ports.readFile;
    ports.readFile = async path => {
      if (path === file) throw Object.assign(new Error(`cannot read ${path}: ${secret}`), { code: "ENOENT", path });
      return readFile(path);
    };
    await expect(assertScopeEpochEnrollmentReady(ports)).rejects.toMatchObject({
      reason: { kind: "canonical-writer-evidence-unavailable", step, code: "ENOENT" },
      message: `scope-epoch-enrollment-held:canonical-writer-evidence-unavailable:${step}:ENOENT. Probe error: report this reason to the installation operator.`,
    });
  });

  it.each([
    ["parse-portal-inspect", "SyntaxError", "portal-json"],
    ["parse-packaged-writer", "SyntaxError", "writer-json"],
    ["validate-local-writer-contract", "scope-writer-compatibility-unproven", "local-contract"],
    ["validate-packaged-writer-contract", "scope-writer-compatibility-unproven", "packaged-contract"],
    ["verify-maintenance-retirement", "runtime_transition_payload_tampered", "signature"],
    ["observe-current-cohort", "maintenance_epoch_observation_unavailable", "inventory"],
    ["inspect-portal", "EACCES", "docker-spawn"],
    ["run-packaged-writer", "TypeError", "probe-type-error"],
    ["attach-retirement", "unknown", "unexpected-throw"],
    ["read-upgrade-run", "Error", "run-store"],
  ])("safely reports %s as %s", async (step, code, fault) => {
    const f = fixture(), runDocker = f.ports.runDocker, readFile = f.ports.readFile;
    const invalid = `/arbitrary/path/${secret}`;
    f.ports.readFile = path => fault === "local-contract" && path.endsWith(".dpf-image-version")
      ? Promise.resolve(invalid) : readFile(path);
    f.ports.runDocker = async args => {
      if (fault === "docker-spawn") throw Object.assign(new Error(invalid), { code: "EACCES" });
      if (fault === "probe-type-error" && args[0] === "run") throw new TypeError(invalid);
      const result = await runDocker(args);
      if (fault === "portal-json" && args[0] === "inspect" || fault === "writer-json" && args[0] === "run"
        || fault === "inventory" && args[0] === "ps" && !args.includes("--filter")) return { ...result, stdout: invalid };
      if (fault === "packaged-contract" && args[0] === "run") return { ...result, stdout: JSON.stringify({ sourceSha: invalid }) };
      return result;
    };
    if (fault === "signature") f.run.completionEvidence.maintenanceEpochRetirement.signature = "0".repeat(64);
    if (fault === "unexpected-throw") f.ports.attachRetirement = async () => { throw invalid; };
    if (fault === "run-store") f.ports.readRun = async () => {
      throw Object.assign(new Error(`scope-epoch-enrollment-held:${invalid}`), { code: invalid, name: invalid });
    };
    await expect(assertScopeEpochEnrollmentReady(f.ports)).rejects.toMatchObject({
      reason: { kind: "canonical-writer-evidence-unavailable", step, code },
      message: `scope-epoch-enrollment-held:canonical-writer-evidence-unavailable:${step}:${code}. Probe error: report this reason to the installation operator.`,
    });
    expect(f.locks).toHaveLength(0);
  });

  it.each([
    ["read-retirement-receipt", "EIO", Object.assign(new Error(secret), { code: "EIO" })],
    ["parse-retirement-receipt", "SyntaxError", new SyntaxError(secret)],
    ["read-transition-secret", "ENOENT", Object.assign(new Error(secret), { code: "ENOENT" })],
    ["verify-maintenance-retirement", "runtime_transition_secret_too_short", new Error("runtime_transition_secret_too_short")],
  ] as const)("preserves the importer's bounded %s diagnostic", async (step, code, error) => {
    const { ports } = fixture();
    ports.attachRetirement = async deps => {
      deps?.onProbeFailure?.(step, error);
      return { status: "unavailable" };
    };
    await expect(assertScopeEpochEnrollmentReady(ports)).rejects.toMatchObject({
      message: `scope-epoch-enrollment-held:canonical-writer-evidence-unavailable:${step}:${code}. Probe error: report this reason to the installation operator.`,
    });
  });

  it("joins packaged bytes, authenticated final retirement and fresh exact cohort", async () => {
    const f = fixture(), proof = await assertScopeEpochEnrollmentReady(f.ports), observations = f.commands.length;
    await proof.assertCurrent(f.tx as never);
    expect(f.locks).toEqual([expect.stringContaining('LOCK TABLE "RuntimeCapabilityTransition"'),
      expect.stringContaining("runtime-capability-transition"), expect.stringContaining("self-upgrade-admission")]);
    expect(f.commands).toHaveLength(observations);
    expect(f.commands.find(args => args[0] === "run")).toEqual(expect.arrayContaining(["--read-only", "--network", "none", "--pull", "never", image]));
  });
  it.each([
    ["active-actuator", "canonical-actuator-present", "wait for it to finish"],
    ["old-present", "current-cohort-unproven", "request_self_upgrade"],
    ["wrong-daemon", "current-cohort-unproven", "request_self_upgrade"],
    ["missing-final", "final-retirement-unavailable", "request_self_upgrade"],
    ["wrong-source", "matching-canonical-run-unproven", "request_self_upgrade"],
    ["late-run", "retirement-order-unproven", "request_self_upgrade"],
    ["writer-bytes", "packaged-writer-mismatch", "Report the packaged writer mismatch"],
    ["not-portal", "current-portal-unproven", "Report that the probe could not bind"],
    ["docker-exit", "docker-observation-unavailable", "Report the Docker observation failure"],
    ["oversized-writer", "packaged-proof-oversized", "Report the packaged writer proof output limit"],
    ["attach-raced", "retirement-attachment-raced", "Retry the claim"],
  ])("holds enrollment on %s and names the next action", async (fault, kind, next) => {
    const f = fixture();
    if (fault === "active-actuator") f.state.activeActuator = true;
    if (fault === "old-present") f.state.oldPresent = true;
    if (fault === "wrong-daemon") f.state.daemon = "different";
    if (fault === "missing-final") f.state.imported = false;
    if (fault === "wrong-source") f.run.deployedSha = "f".repeat(40);
    if (fault === "late-run") f.run.startedAt = now;
    if (fault === "writer-bytes") f.proof.writers[SCOPE_EPOCH_WRITER_PATHS[0]] = "0".repeat(64);
    if (fault === "attach-raced") f.ports.attachRetirement = async () => ({ status: "raced", runId: "SUR-TEST" });
    const runDocker = f.ports.runDocker;
    f.ports.runDocker = async args => {
      const result = await runDocker(args);
      if (fault === "not-portal" && args[0] === "inspect") return { ...result, stdout: "{}" };
      if (fault === "docker-exit") return { ...result, exitCode: 1, stderr: secret };
      if (fault === "oversized-writer" && args[0] === "run") return { ...result, stdout: secret.repeat(1000) };
      return result;
    };
    await expect(assertScopeEpochEnrollmentReady(f.ports)).rejects.toMatchObject({
      reason: { kind },
      message: expect.stringContaining(next),
    });
    expect(f.locks).toHaveLength(0);
  });
  it.each(["selfUpgradeRun", "runtimeCapabilityTransition"] as const)("does not enroll after a concurrent %s admission", async carrier => {
    const f = fixture(), proof = await assertScopeEpochEnrollmentReady(f.ports);
    f.tx[carrier].findFirst.mockResolvedValue({ id: "active-admission" });
    await expect(proof.assertCurrent(f.tx as never)).rejects.toThrow("canonical-transition-active. Wait for the governed transition");
  });
  it("refuses an unqualified transaction rather than losing admission serialization", async () => {
    const f = fixture(), proof = await assertScopeEpochEnrollmentReady(f.ports);
    await expect(proof.assertCurrent({} as never)).rejects.toThrow("transaction-admission-unavailable. Report");
  });
  it("asks the writer to retry if the current process no longer matches its proof", async () => {
    const f = fixture(), proof = await assertScopeEpochEnrollmentReady(f.ports);
    vi.mocked(hostname).mockReturnValueOnce("replaced-process");
    await expect(proof.assertCurrent(f.tx as never)).rejects.toThrow("process-proof-unproven. Retry the claim");
    expect(f.locks).toHaveLength(0);
  });
  it.each([
    ["observation-budget-expired", "Retry the claim"],
    ["observation-oversized", "Report the Docker observation output limit"],
  ])("keeps the real Docker port fail-closed on %s", async (kind, next) => {
    const f = fixture();
    vi.mocked(readFile).mockImplementation(async path => Buffer.from(await f.ports.readFile(String(path))));
    vi.mocked(runProcessWithBudget).mockResolvedValue({
      outputLimitExceeded: true, exitCode: 1, stdout: secret, stdoutBytes: Buffer.from(secret), stderr: secret,
    });
    const now = kind === "observation-budget-expired" ? vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(60_000) : null;
    try {
      await expect(assertScopeEpochEnrollmentReady()).rejects.toMatchObject({ reason: { kind }, message: expect.stringContaining(next) });
    } finally {
      now?.mockRestore();
      vi.mocked(readFile).mockRestore();
      vi.mocked(runProcessWithBudget).mockRestore();
    }
  });
  it("does not identify a process solely by a matching hostname prefix", () => {
    expect(() => currentScopeWriterContainerId("0::/", "")).toThrow("current-container-identity-unproven. Report");
    expect(currentScopeWriterContainerId(`0::/docker/${after.portal.id}\n`, "")).toBe(after.portal.id);
    expect(() => currentScopeWriterContainerId(`0::/docker/${before.portal.id}\n`, `/containers/${after.portal.id}/hostname `)).toThrow();
  });
  function hardenedFixture() {
    const f = fixture();
    const read = f.ports.readFile;
    f.ports.readFile = async path => {
      if (path === "/dpf-state/runtime-transition.secret") throw new Error("the writer has no signing key");
      return path === "/proc/self/mountinfo"
        ? `${await read(path)}2 1 0:2 / /run/dpf-actuator ro - ext4 /dev/sdb rw\n`
        : await read(path);
    };
    const served = { schemaVersion: 1, serverSha256: hash("server"), routeSha256: hash("route"),
      manifestSha256: hash("manifest"), closureSha256: hash("closure") };
    const observation = { runId: f.run.runId, sourceSha: source, retirementDigest: hash(canonicalJson(f.receipt)),
      project: "dpf", daemonId: "daemon-test", observedAt: now.getTime(),
      launch: { id: after.portal.id, image, recipeDigest: hash("recipe"), startedAt: "2026-10-16T01:01:59.987654321Z" },
      served: { image, ...served },
      cohort: { portal: { id: after.portal.id, startedAt: "2026-10-16T01:01:59.987654321Z" }, sandbox: after.sandbox } };
    const attestProcess = vi.fn(async () => ({ pid: process.pid, startTicks: "123" }));
    const inspectServed = vi.fn(async () => served);
    const readClosing = vi.fn(async (): Promise<unknown> => {
      expect(f.locks).toHaveLength(3);
      expect(f.tx.selfUpgradeRun.findFirst).toHaveBeenCalledTimes(1);
      return observation;
    });
    const readAttested = async () => ({ envelope: f.receipt, retirementDigest: hash(canonicalJson(f.receipt)) });
    return { ...f, ports: { ...f.ports, attestProcess, inspectServed, readClosing, readAttested }, observation };
  }
  it("uses the closing host observation once inside the actual admission locks after a same-ID restart", async () => {
    const f = hardenedFixture(), proof = await assertScopeEpochEnrollmentReady(f.ports);
    expect(f.ports.readClosing).not.toHaveBeenCalled();
    await proof.assertCurrent(f.tx as never);
    await proof.assertCurrent(f.tx as never);
    expect(f.ports.readClosing).toHaveBeenCalledTimes(1);
    expect(f.commands).toEqual([]);
  });
  it.each(["writer", "retirement", "source", "restart", "unavailable"] as const)("holds the hardened claim for an incompatible %s observation", async fault => {
    const f = hardenedFixture(), proof = await assertScopeEpochEnrollmentReady(f.ports);
    if (fault === "writer") f.observation.served.routeSha256 = hash("other route");
    if (fault === "retirement") f.observation.retirementDigest = hash("other retirement");
    if (fault === "source") f.observation.sourceSha = "0".repeat(40);
    if (fault === "restart") {
      f.observation.cohort.portal.startedAt = "2026-10-16T01:00:59.999999999Z";
      f.observation.launch.startedAt = f.observation.cohort.portal.startedAt;
    }
    if (fault === "unavailable") f.ports.readClosing.mockRejectedValue(new Error("connection refused"));
    await expect(proof.assertCurrent(f.tx as never)).rejects.toThrow("current-cohort-unproven");
    expect(f.commands).toEqual([]);
  });
  it("never falls back to raw Docker after failed qualification in the actuator runtime", async () => {
    const f = hardenedFixture();
    f.ports.attestProcess.mockRejectedValue(new Error("writable root"));
    await expect(assertScopeEpochEnrollmentReady(f.ports)).rejects.toThrow("canonical-writer-evidence-unavailable");
    expect(f.commands).toEqual([]);
  });
});

describe("served scope writer process qualification", () => {
  const boot = "Node.js s (next-server) ";
  const status = [
    "Uid:\t1000\t1000\t1000\t1000", "Gid:\t1000\t1000\t1000\t1000", "Groups:\t1000",
    "TracerPid:\t0", "NoNewPrivs:\t1", "Seccomp:\t2", "Seccomp_filters:\t1",
    ...["Inh", "Prm", "Eff", "Bnd", "Amb"].map(key => `Cap${key}:\t0000000000000000`),
  ].join("\n");
  const mounts = [
    "1 0 0:99 / / ro,relatime - overlay overlay rw",
    "2 1 0:100 / /tmp rw,nosuid,nodev,noexec - tmpfs tmpfs rw",
    "3 1 0:101 / /run/dpf-actuator ro,nosuid,nodev,noexec - ext4 /dev/sda rw",
    "4 1 0:102 / /proc rw,nosuid,nodev,noexec - proc proc rw",
  ].join("\n");
  function input(files: Record<string, string> = {}) {
    const kernel: Record<string, string> = {
      "/proc/self/status": status, "/proc/self/mountinfo": mounts,
      "/proc/self/stat": `1 (${boot}) S ${Array(18).fill("0").join(" ")} 7654321 0\n`,
      ...files,
    };
    return { readFile: async (path: string) => Buffer.from(kernel[path] ?? ""),
      readlink: async () => "/usr/local/bin/node", pid: 1, execPath: "/usr/local/bin/node",
      argv: ["--disable-sigusr1"], env: { NODE_ENV: "production" as const, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      nativeObjects: () => ["/app/node_modules/sharp/sharp.node", "/lib/ld-musl-x86_64.so.1", "linux-vdso.so.1"],
      realpath: async (path: string) => path };
  }
  it("binds Linux process start to an unprivileged immutable loader namespace", async () => {
    await expect(attestScopeWriterProcess(input())).resolves.toEqual({ pid: 1, startTicks: "7654321" });
  });
  it.each([
    ["writable root", "/proc/self/mountinfo", mounts.replace("/ / ro,", "/ / rw,")],
    ["nested loader mount", "/proc/self/mountinfo", mounts + "\n5 1 0:55 / /app/node_modules ro - tmpfs tmpfs rw"],
    ["unexpected writable mount", "/proc/self/mountinfo", mounts + "\n5 1 0:55 / /run/untrusted rw - tmpfs tmpfs rw"],
    ["writable actuator", "/proc/self/mountinfo", mounts.replace("actuator ro,", "actuator rw,")],
    ["missing proc fields", "/proc/self/status", ""],
    ["privileged bounding capability", "/proc/self/status", status.replace("CapBnd:\t0000000000000000", "CapBnd:\t0000000000000001")],
    ["attached tracer", "/proc/self/status", status.replace("TracerPid:\t0", "TracerPid:\t7")],
  ])("refuses %s", async (_name, path, bytes) => {
    await expect(attestScopeWriterProcess(input({ [path]: bytes }))).rejects.toThrow("scope_writer_probe_process_unproven");
  });
  it.each([
    { argv: ["--disable-sigusr1", "--inspect"] },
    { env: { ...input().env, NODE_PATH: "/tmp" } },
    { env: { ...input().env, PATH: "/tmp:/usr/local/bin" } },
    { readlink: async () => "/tmp/node" },
    { nativeObjects: () => ["/tmp/sharp.node"] },
    { realpath: async () => "/tmp/replaced.so" },
  ])("refuses loader, inspector or interpreter substitution", async change => {
    await expect(attestScopeWriterProcess({ ...input(), ...change })).rejects.toThrow("scope_writer_probe_process_unproven");
  });
});
