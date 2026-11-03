import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { signMaintenanceEpoch } from "../../../../scripts/lib/maintenance-epoch-receipt.mjs";
vi.mock("@dpf/db", () => ({ prisma: {} }));
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
  it("joins packaged bytes, authenticated final retirement and fresh exact cohort", async () => {
    const f = fixture(), proof = await assertScopeEpochEnrollmentReady(f.ports), observations = f.commands.length;
    await proof.assertCurrent(f.tx as never);
    expect(f.locks).toEqual([expect.stringContaining("runtime-capability-transition"), expect.stringContaining("self-upgrade-admission")]);
    expect(f.commands).toHaveLength(observations);
    expect(f.commands.find(args => args[0] === "run")).toEqual(expect.arrayContaining(["--read-only", "--network", "none", "--pull", "never", image]));
  });
  it.each(["active-actuator", "old-present", "wrong-daemon", "missing-final", "wrong-source", "tampered-signature", "writer-bytes"])("holds enrollment on %s", async fault => {
    const f = fixture();
    if (fault === "active-actuator") f.state.activeActuator = true;
    if (fault === "old-present") f.state.oldPresent = true;
    if (fault === "wrong-daemon") f.state.daemon = "different";
    if (fault === "missing-final") f.state.imported = false;
    if (fault === "wrong-source") f.run.deployedSha = "f".repeat(40);
    if (fault === "tampered-signature") f.run.completionEvidence.maintenanceEpochRetirement.signature = "0".repeat(64);
    if (fault === "writer-bytes") f.proof.writers[SCOPE_EPOCH_WRITER_PATHS[0]] = "0".repeat(64);
    await expect(assertScopeEpochEnrollmentReady(f.ports)).rejects.toThrow("scope-epoch-enrollment-held:");
    expect(f.locks).toHaveLength(0);
  });
  it.each(["selfUpgradeRun", "runtimeCapabilityTransition"] as const)("does not enroll after a concurrent %s admission", async carrier => {
    const f = fixture(), proof = await assertScopeEpochEnrollmentReady(f.ports);
    f.tx[carrier].findFirst.mockResolvedValue({ id: "active-admission" });
    await expect(proof.assertCurrent(f.tx as never)).rejects.toThrow("canonical-transition-active");
  });
  it("refuses an unqualified transaction rather than losing admission serialization", async () => {
    const f = fixture(), proof = await assertScopeEpochEnrollmentReady(f.ports);
    await expect(proof.assertCurrent({} as never)).rejects.toThrow("transaction-admission-unavailable");
  });
  it("does not identify a process solely by a matching hostname prefix", () => {
    expect(() => currentScopeWriterContainerId("0::/", "")).toThrow("current-container-identity-unproven");
    expect(currentScopeWriterContainerId(`0::/docker/${after.portal.id}\n`, "")).toBe(after.portal.id);
    expect(() => currentScopeWriterContainerId(`0::/docker/${before.portal.id}\n`, `/containers/${after.portal.id}/hostname `)).toThrow();
  });
});
