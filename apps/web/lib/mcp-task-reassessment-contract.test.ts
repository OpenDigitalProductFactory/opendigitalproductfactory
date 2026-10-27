import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const phase = vi.hoisted(() => ({ current: vi.fn(() => null as unknown) }));
vi.mock("./routing/reassessment-execution-scope", () => ({ currentReassessmentExecution: phase.current }));
import { REASSESSMENT_OWNERS, REASSESSMENT_OWNER_PATHS, assertReassessmentOwnerSupport,
  validateReassessmentRuntimeCompatibility } from "./shared/reassessment-owner-versions";
import { readCurrentReassessmentContract, assertCurrentReassessmentContract } from "./mcp-task-reassessment-contract";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const configDigest = `sha256:${"a".repeat(64)}`, sourceSha = "b".repeat(40), sourceContentHash = "c".repeat(64);
  const files = new Map([["/app/.dpf-image-version", sourceSha], ["/app/.dpf-source-content-hash", sourceContentHash],
    ["/app/apps/web-src/lib/shared/reassessment-owner-versions.ts", "fixture pure owner contract"]]);
  const owners = Object.fromEntries(REASSESSMENT_OWNERS.map(owner => {
    const bytes = `assertReassessmentOwnerSupport("${owner}", 2);`;
    files.set(`/app/apps/web-src/lib/${REASSESSMENT_OWNER_PATHS[owner]}`, bytes);
    return [owner, { version: 2, sourceSha256: sha(bytes) }];
  }));
  const info = { schemaVersion: 1, sourceSha, sourceContentHash, contractSha256: sha("fixture pure owner contract"), owners };
  const ports = { readCurrentConfigDigest: vi.fn(async () => configDigest), readFile: vi.fn(async (path: string) => {
    if (!files.has(path)) throw Error("unexpected file"); return files.get(path)!;
  }), runDocker: vi.fn(async (_args: string[]) => ({ exitCode: 0, stdout: JSON.stringify(info), stderr: "" })) };
  return { configDigest, info, files, ports };
}
beforeEach(() => { phase.current.mockReset().mockReturnValue(null); });
describe("actual executing reassessment owner compatibility", () => {
  it("binds exact current config and baked owner closure, then checks the retained proof without I/O", async () => {
    const f = fixture(), proof = await readCurrentReassessmentContract(f.ports);
    expect(proof).toEqual({ ...f.info, configDigest: f.configDigest });
    expect(Object.isFrozen(proof)).toBe(true); expect(Object.isFrozen(proof.owners.writer)).toBe(true);
    expect(f.ports.runDocker).toHaveBeenCalledOnce();
    const command = f.ports.runDocker.mock.calls[0][0] as string[];
    expect(command).toContain(f.configDigest); expect(command.slice(0, 3)).toEqual(["run", "--rm", "--read-only"]);
    expect(command).toContain("none"); expect(command).not.toContain("-v"); expect(command).not.toContain("--env");
    f.ports.readFile.mockClear(); f.ports.runDocker.mockClear(); f.ports.readCurrentConfigDigest.mockClear();
    expect(() => assertCurrentReassessmentContract(JSON.parse(JSON.stringify(proof)))).not.toThrow();
    expect(() => assertCurrentReassessmentContract({ ...proof, configDigest: `sha256:${"f".repeat(64)}` })).toThrow();
    expect(f.ports.readFile).not.toHaveBeenCalled(); expect(f.ports.runDocker).not.toHaveBeenCalled();
    expect(f.ports.readCurrentConfigDigest).not.toHaveBeenCalled();
  });
  it.each(["config", "source", "content", "owner", "version", "contract", "missing-owner", "unavailable"])(
    "refuses %s drift and does not retain caller proof as a private brand", async change => {
      const f = fixture();
      if (change === "config") f.ports.readCurrentConfigDigest.mockResolvedValueOnce(f.configDigest).mockResolvedValueOnce(`sha256:${"d".repeat(64)}`);
      if (change === "source") f.info.sourceSha = "d".repeat(40);
      if (change === "content") f.info.sourceContentHash = "d".repeat(64);
      if (change === "owner") f.info.owners.writer.sourceSha256 = "d".repeat(64);
      if (change === "version") f.info.owners.approval.version = 1;
      if (change === "contract") f.info.contractSha256 = "d".repeat(64);
      if (change === "missing-owner") delete f.info.owners.worker;
      if (change === "unavailable") f.ports.runDocker.mockRejectedValue(Error("unavailable"));
      await expect(readCurrentReassessmentContract(f.ports)).rejects.toThrow(/reassessment-compatibility-unproven/);
      expect(() => assertCurrentReassessmentContract({ ...f.info, configDigest: f.configDigest })).toThrow(/compatibility-unproven/);
    },
  );
  it("requires every actual owner declaration and rejects missing, string and unknown versions", () => {
    for (const owner of REASSESSMENT_OWNERS) expect(() => assertReassessmentOwnerSupport(owner, 2)).not.toThrow();
    expect(() => assertReassessmentOwnerSupport("worker", 1)).toThrow();
    const f = fixture();
    expect(() => validateReassessmentRuntimeCompatibility({ ...f.info, configDigest: f.configDigest })).not.toThrow();
    expect(() => validateReassessmentRuntimeCompatibility({ ...f.info, configDigest: "latest" })).toThrow();
    f.info.owners.transport.version = 3;
    expect(() => validateReassessmentRuntimeCompatibility({ ...f.info, configDigest: f.configDigest })).toThrow();
    f.info.owners.transport.version = "2" as unknown as number;
    expect(() => validateReassessmentRuntimeCompatibility({ ...f.info, configDigest: f.configDigest })).toThrow();
  });
  it.each(["qualification", "execution"])("cannot start a new probe from %s", async active => {
    const f = fixture();
    if (active === "qualification") phase.current.mockImplementation(() => { throw Error("qualification-only"); });
    else phase.current.mockReturnValue({ taskRunId: "TR-active" });
    await expect(readCurrentReassessmentContract(f.ports)).rejects.toMatchObject({ code: "reassessment-compatibility-unproven" });
    expect(f.ports.readFile).not.toHaveBeenCalled(); expect(f.ports.runDocker).not.toHaveBeenCalled();
    expect(f.ports.readCurrentConfigDigest).not.toHaveBeenCalled();
  });
  it("a new process module cannot brand a caller DTO without its own actual image probe", async () => {
    vi.resetModules();
    const fresh = await import("./mcp-task-reassessment-contract"), f = fixture();
    expect(() => fresh.assertCurrentReassessmentContract({ ...f.info, configDigest: f.configDigest })).toThrow(/compatibility-unproven/);
    expect(f.ports.runDocker).not.toHaveBeenCalled();
    await fresh.readReassessmentImageContract(f.configDigest, f.info.sourceSha, f.ports.runDocker);
    expect(() => fresh.assertCurrentReassessmentContract({ ...f.info, configDigest: f.configDigest })).toThrow(/compatibility-unproven/);
  });
});
