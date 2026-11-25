import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { signMaintenanceEpoch } from "../../../../scripts/lib/maintenance-epoch-receipt.mjs";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
import { makePairedRecoveryPointFixture } from "@/lib/self-upgrade/recovery-point.test-fixtures";
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
function fixture(point: typeof recovery | ReturnType<typeof makePairedRecoveryPointFixture> = recovery) {
  const writerPath = (name: string) => `/app/${name.replace(/^apps\/web\//, "apps/web-src/")}`;
  const proof = { schemaVersion: 1, version: 1, sourceSha: source, sourceContentHash: "b".repeat(64),
    contractSha256: hash("fixture contract"), writers: Object.fromEntries(SCOPE_EPOCH_WRITER_PATHS.map(name => [name, hash(writerPath(name))])) };
  const receipt = signMaintenanceEpoch({ schemaVersion: 1, runId: "SUR-TEST", targetSha: source,
    promoterDigest: `sha256:${"d".repeat(64)}`, recoveryPointDigest: hash(canonicalJson(point)), project: "dpf", daemonId: "daemon-test",
    capturedAt: "2026-10-16T01:00:00Z", completedAt: "2026-10-16T01:02:00Z", before, after,
    retiredContainerIds: [before.portal.id, before.sandbox.id], inventoryDigest: "e".repeat(64) }, secret);
  const run = { runId: "SUR-TEST", status: "succeeded", targetSha: source, deployedSha: source, startedAt: new Date("2026-10-16T00:59:00Z"),
    completionEvidence: { recoveryPoint: point, readiness: { result: "ready", mode: "enforced", targetSha: source, imageDigest: `sha256:${"d".repeat(64)}` }, maintenanceEpochRetirement: receipt } };
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
        const service = args.at(-1) === after.portal.id ? "portal" : "sandbox";
        stdout = JSON.stringify({ Id: after[service].id, State: { Running: true, StartedAt: after[service].startedAt },
          Config: { Labels: { "com.docker.compose.service": service, "com.docker.compose.project": state.project } } });
      }
      return { exitCode: 0, stdout, stderr: "" };
    },
  };
  const locks: string[] = [];
  const tx = { $executeRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join("?")); },
    runtimeCapabilityTransition: { findFirst: vi.fn(async (): Promise<unknown> => null) },
    selfUpgradeRun: { findFirst: vi.fn(async (): Promise<unknown> => null) } };
  return { ports, proof, run, state, commands, locks, tx };
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
    expect(f.locks).toEqual([expect.stringContaining("runtime-capability-transition"), expect.stringContaining("self-upgrade-admission")]);
    expect(f.commands).toHaveLength(observations);
    expect(f.commands.find(args => args[0] === "run")).toEqual(expect.arrayContaining(["--read-only", "--network", "none", "--pull", "never", image]));
  });
  it("joins the unchanged cohort proof to a complete signed v2 recovery point", async () => {
    const point = makePairedRecoveryPointFixture(recovery.selfUpgradeRunId, recovery.createdAt);
    const f = fixture(point);
    const proof = await assertScopeEpochEnrollmentReady(f.ports);
    await proof.assertCurrent(f.tx as never);
    expect(f.locks).toHaveLength(2);
  });
  it("holds enrollment when the v2 projections name a different uploads run", async () => {
    const point = makePairedRecoveryPointFixture(recovery.selfUpgradeRunId, recovery.createdAt);
    point.members[1]!.runId = "OTHER-UPLOADS";
    const f = fixture(point);
    await expect(assertScopeEpochEnrollmentReady(f.ports)).rejects.toMatchObject({
      reason: { kind: "matching-canonical-run-unproven" },
    });
    expect(f.locks).toHaveLength(0);
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
});
