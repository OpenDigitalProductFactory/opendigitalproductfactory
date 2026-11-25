import { describe, expect, it } from "vitest";

import {
  buildSourceWriterArgs,
  createSourceWriterLauncher,
  refreshUpstreamThroughWriter,
  sourceWriterThroughPrivateActuator,
} from "./source-writer-actuator";
import type { SelfUpgradeConfig } from "./config";
import type { PromoterInstallBinding } from "./promoter-actuator";

const runId = "SUR-ABC123";
const binding: PromoterInstallBinding = { project: "dpf", installPath: "/Users/op/dpf" };
const config = { sourceMode: "upstream", installBranch: "dpf/install", useIsolatedWorkspace: true } as SelfUpgradeConfig;
const prepareInput = { sourceMode: "upstream", remote: "origin", branch: "main", installBranch: "dpf/install", isolatedWorkspace: true };
const prepare = (overrides: Record<string, unknown> = {}, owner: Record<string, unknown> = { kind: "self-upgrade", runId }) => ({
  owner, operation: "prepare-upgrade-source", input: { ...prepareInput, ...overrides },
});
const refresh = (overrides: Record<string, unknown> = {}) => ({
  owner: { kind: "upstream-refresh" }, operation: "refresh-upstream-head", input: { remote: "origin", branch: "main", ...overrides },
});
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });

function harness(status: string | null = "running", now = { t: 1_000_000 }) {
  const launched: string[][] = [];
  const launch = createSourceWriterLauncher({
    binding, readConfig: async () => config, readRunStatus: async () => status, now: () => now.t,
    run: async (args) => {
      launched.push(args);
      return ok(args.at(-1) === "refresh-upstream-head" ? `{"ok":true,"upstreamSha":"${"b".repeat(40)}"}\n`
        : `{"ok":true,"mode":"upstream","stamp":"${"a".repeat(40)}"}\n`);
    },
  });
  return { launch, launched, now };
}

describe("buildSourceWriterArgs", () => {
  it("runs the fixed entrypoint with the install checkout as the only writable mount", () => {
    const args = buildSourceWriterArgs({ name: `dpf-source-writer-${runId}`, owner: runId, project: "dpf", installPath: "/Users/op/dpf",
      image: "dpf-promoter", operation: "prepare-upgrade-source", input: prepareInput });
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    for (const flag of [["--user", "1000:1000"], ["--cap-drop", "ALL"], ["--security-opt", "no-new-privileges"], ["--read-only", undefined]]) {
      expect(args).toContain(flag[0]);
      if (flag[1]) expect(args[args.indexOf(flag[0]!) + 1]).toBe(flag[1]);
    }
    expect(args.filter((arg) => arg === "-v")).toHaveLength(1);
    expect(args[args.indexOf("-v") + 1]).toBe("/Users/op/dpf:/host-dpf");
    expect(args.slice(-3)).toEqual(["dpf-promoter", "/promoter/source-writer.mjs", "prepare-upgrade-source"]);
    expect(args[args.indexOf("--entrypoint") + 1]).toBe("node");
    expect(args).toContain(`DPF_SOURCE_WRITER_INPUT=${JSON.stringify(prepareInput)}`);
    expect(args.join(" ")).not.toMatch(/docker\.sock|--privileged|--pid[ =]|--network[ =]host|--cap-add/);
  });
});

describe("createSourceWriterLauncher", () => {
  it("prepares the upgrade source for an admitted run and returns the writer's result", async () => {
    const { launch, launched } = harness("queued");
    await expect(launch(prepare())).resolves.toEqual({ ok: true, mode: "upstream", stamp: "a".repeat(40) });
    expect(launched).toHaveLength(1);
    expect(launched[0]).toContain(`dpf-source-writer-${runId}`);
  });

  it("refuses preparation for a settled or unknown run", async () => {
    for (const status of ["succeeded", "failed", null]) {
      const { launch, launched } = harness(status);
      await expect(launch(prepare())).rejects.toThrow("source_writer_admission_refused");
      expect(launched).toHaveLength(0);
    }
  });

  it.each([
    ["remote", { remote: "upstream" }],
    ["branch", { branch: "release" }],
    ["install branch", { installBranch: "other/install" }],
    ["source mode", { sourceMode: "local" }],
    ["workspace mode", { isolatedWorkspace: false }],
    ["option-shaped remote", { remote: "--upload-pack=x" }],
  ])("refuses a %s that differs from the install's configuration", async (_label, overrides) => {
    const { launch, launched } = harness();
    await expect(launch(prepare(overrides))).rejects.toThrow("source_writer_admission_refused");
    expect(launched).toHaveLength(0);
  });

  it("refuses unknown operations, owners and malformed run ids", async () => {
    const { launch, launched } = harness();
    await expect(launch({ ...prepare(), operation: "push-anything" })).rejects.toThrow();
    await expect(launch(prepare({}, { kind: "self-upgrade", runId: "SUR-1; rm -rf /" }))).rejects.toThrow();
    await expect(launch(prepare({}, { kind: "upstream-refresh" }))).rejects.toThrow();
    await expect(launch({ ...refresh(), owner: { kind: "self-upgrade", runId } })).rejects.toThrow();
    expect(launched).toHaveLength(0);
  });

  it("launches the ownerless upstream refresh at most once per minute and shares its result", async () => {
    const { launch, launched, now } = harness();
    const head = { ok: true, upstreamSha: "b".repeat(40) };
    const [first, concurrent] = await Promise.all([launch(refresh()), launch(refresh())]);
    expect([first, concurrent]).toEqual([head, head]);
    await expect(launch(refresh())).resolves.toEqual(head);
    expect(launched).toHaveLength(1);
    now.t += 61_000;
    await expect(launch(refresh())).resolves.toEqual(head);
    expect(launched).toHaveLength(2);
    await expect(launch(refresh({ branch: "other" }))).rejects.toThrow("source_writer_admission_refused");
  });

  it("does not hand a failed refresh launch to later callers as a head", async () => {
    const now = { t: 0 };
    let calls = 0;
    const launch = createSourceWriterLauncher({ binding, readConfig: async () => config, readRunStatus: async () => "running",
      now: () => now.t, run: async () => { calls += 1; throw new Error("docker unavailable"); } });
    await expect(launch(refresh())).rejects.toThrow("docker unavailable");
    await expect(launch(refresh())).resolves.toEqual({ ok: false, reason: "no-target" });
    now.t += 61_000;
    await expect(launch(refresh())).rejects.toThrow("docker unavailable");
    expect(calls).toBe(2);
  });

  it("refuses a malformed writer result instead of passing it through", async () => {
    const launch = createSourceWriterLauncher({ binding, readConfig: async () => config, readRunStatus: async () => "running",
      now: () => 0, run: async () => ok("not json") });
    await expect(launch(prepare())).rejects.toThrow("source_writer_result_invalid");
  });
});

describe("sourceWriterThroughPrivateActuator", () => {
  it("sends the request when the actuator is mounted and stays local otherwise", async () => {
    const bodies: unknown[] = [];
    const send = async (body: unknown) => { bodies.push(body); return { ok: true, upstreamSha: "b".repeat(40) }; };
    await expect(sourceWriterThroughPrivateActuator(refresh() as never, async () => true, send)).resolves.toEqual({ ok: true, upstreamSha: "b".repeat(40) });
    expect(bodies).toEqual([refresh()]);
    await expect(sourceWriterThroughPrivateActuator(refresh() as never, async () => false, send)).resolves.toBeNull();
  });

  it("asks for the shared upstream refresh on behalf of any reader", async () => {
    const bodies: unknown[] = [];
    await refreshUpstreamThroughWriter({ remote: "origin", branch: "main" }, async () => true, async (body) => { bodies.push(body); return { ok: true, upstreamSha: "b".repeat(40) }; });
    expect(bodies).toEqual([refresh()]);
  });

  it("reports an unavailable writer as a governed prep error", async () => {
    await expect(sourceWriterThroughPrivateActuator(prepare() as never, async () => true, async () => { throw new Error("lost"); }))
      .resolves.toEqual({ ok: false, reason: "prep-error", message: "The authorized source writer did not confirm the operation." });
  });
});
