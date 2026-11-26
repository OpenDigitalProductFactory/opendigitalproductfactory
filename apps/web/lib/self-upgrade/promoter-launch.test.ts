import { describe, expect, it, vi } from "vitest";
import { launchCheckedPromoter, runAdmittedPromoter, type GuardedPromoterPorts } from "./promoter-launch";
import { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "./promoter-exit-codes";

const id = "a".repeat(64);
const image = `sha256:${"b".repeat(64)}`;
const action = "c".repeat(64);
const name = "dpf-promoter-SUR-SCOPE";
const argv = ["run", "--rm", "--name", name, image, "--self-upgrade"];

function fixture(existing?: { id: string; binding: string; startedAt: string; owner?: string }) {
  let held = false;
  const started = vi.fn();
  const run: GuardedPromoterPorts["run"] = async (args, options) => {
    switch (args[0]) {
      case "inspect":
        expect(held).toBe(true);
        return existing
          ? { exitCode: 0, stdout: JSON.stringify(existing), stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "Error: No such object" };
      case "create":
        expect(held).toBe(true);
        expect(args).not.toContain("--rm");
        expect(args).toContain(`dpf.promoter-binding=${action}`);
        return { exitCode: 0, stdout: id, stderr: "" };
      case "start":
        expect(held).toBe(true);
        expect(args).toEqual(["start", id]);
        started();
        break;
      case "wait":
        expect(held).toBe(false);
        expect(args).toEqual(["wait", id]);
        expect(options.containerName).toBe(id);
        return { exitCode: 0, stdout: "0\n", stderr: "" };
      case "logs":
        expect(held).toBe(false);
        return { exitCode: 0, stdout: "step=done", stderr: "diagnostic" };
      default:
        throw new Error("unexpected operation");
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const ports: GuardedPromoterPorts = {
    run: vi.fn(run),
    underAdmission: async work => {
      held = true;
      try { return await work(); } finally { held = false; }
    },
  };
  return { ports, started };
}

describe("canonical promoter launch", () => {
  it("keeps the admission locks through exact-ID start and collects output outside them", async () => {
    const { ports, started } = fixture();
    expect(await launchCheckedPromoter({ name, binding: action, argv, timeoutMs: 15_000 }, ports))
      .toEqual({ exitCode: 0, stdout: "step=done", stderr: "diagnostic" });
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("adopts the same confirmed start and never starts an incompatible same-name object", async () => {
    const current = { id, binding: action, startedAt: "2026-11-24T16:21:34.296462753Z" };
    const owned = fixture(current);
    expect((await launchCheckedPromoter({ name, binding: action, argv, timeoutMs: 15_000 }, owned.ports)).exitCode).toBe(0);
    expect(owned.started).not.toHaveBeenCalled();
    const other = fixture({ ...current, binding: "d".repeat(64) });
    expect((await launchCheckedPromoter({ name, binding: action, argv, timeoutMs: 15_000 }, other.ports)).exitCode)
      .toBe(PROMOTER_ALREADY_RUNNING_EXIT_CODE);
    expect(other.ports.run).toHaveBeenCalledTimes(1);
  });

  it("does not contact Docker after the durable active run has ended", async () => {
    const { ports } = fixture();
    ports.underAdmission = async () => { throw new Error("owner retired"); };
    expect((await launchCheckedPromoter({ name, binding: action, argv, timeoutMs: 15_000 }, ports)).exitCode)
      .toBe(PROMOTER_ALREADY_RUNNING_EXIT_CODE);
    expect(ports.run).not.toHaveBeenCalled();
  });

  it("resumes a created reservation only for its saved owner and full container ID", async () => {
    const reserved = { id, binding: action, startedAt: "0001-01-01T00:00:00Z", owner: "SUR-SCOPE" };
    const owned = fixture(reserved);
    expect((await launchCheckedPromoter({ name, binding: action, ownerKey: "SUR-SCOPE", argv, timeoutMs: 15_000 }, owned.ports)).exitCode).toBe(0);
    expect(owned.started).toHaveBeenCalledTimes(1);
    const other = fixture({ ...reserved, owner: "SUR-OTHER" });
    expect((await launchCheckedPromoter({ name, binding: action, ownerKey: "SUR-SCOPE", argv, timeoutMs: 15_000 }, other.ports)).exitCode)
      .toBe(PROMOTER_ALREADY_RUNNING_EXIT_CODE);
    expect(other.started).not.toHaveBeenCalled();
  });
});

describe("runAdmittedPromoter and the swap's drain fence (BI-3C3CCC59)", () => {
  it("checks the fence after building the command and launches nothing when admission reopened", async () => {
    const order: string[] = [];
    const build = vi.fn(async () => { order.push("build"); return { args: argv }; });
    await expect(runAdmittedPromoter({ containerName: name } as never, { kind: "self-upgrade", runId: "SUR-SCOPE", quiescenceRunId: "QR-1" },
      image, build, async () => { order.push("fence"); throw new Error("admission-reopened-before-swap"); }))
      .rejects.toThrow("admission-reopened-before-swap");
    expect(order).toEqual(["build", "fence"]);
  });
});
