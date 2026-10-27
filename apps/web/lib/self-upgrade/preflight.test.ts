import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { signTransitionPayload } from "@/lib/platform-runtime/transition-protocol";
import { refreshMigrationHandoffAfterDrain, resolveReadinessBackupHostPath, runCandidatePreflight, runReassessmentCandidatePreflight, type InstallStateMigrationHandoff } from "./preflight";

const fsMocks = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: fsMocks.readFile }));

describe("reassessment candidate compatibility", () => {
  const configDigest = `sha256:${"d".repeat(64)}`;
  const sourceSha = "a".repeat(40);
  const info = { schemaVersion: 1, sourceSha, sourceContentHash: "b".repeat(64), contractSha256: "c".repeat(64),
    owners: Object.fromEntries(["transport", "approval", "worker", "writer"].map(owner => [owner, { version: 2, sourceSha256: "e".repeat(64) }])) };
  const ports = (override: { probe?: unknown; inspection?: string; exitCode?: number } = {}) => {
    const runDocker = vi.fn(async (args: string[]) => args[0] === "image"
      ? { exitCode: override.exitCode ?? 0, stdout: override.inspection ?? `${configDigest}\n`, stderr: "" }
      : { exitCode: override.exitCode ?? 0, stdout: JSON.stringify(override.probe ?? info), stderr: "" });
    return { runId: "SUR-COMPAT", targetSha: sourceSha, composeProject: "actual-project", stage: "preflight" as const,
      failRun: vi.fn(), emitFailure: vi.fn(), recordCompatibility: vi.fn(), runDocker };
  };
  it("resolves the source candidate once and probes only its immutable config digest", async () => {
    const p = ports();
    const result = await runReassessmentCandidatePreflight(p);
    expect(result).toEqual({ ok: true, data: { proof: { ...info, configDigest } } });
    expect(p.runDocker.mock.calls.filter(([args]) => args[0] === "image").map(([args]) => args)).toEqual([
      ["image", "inspect", "--format", "{{.Id}}", "actual-project-portal"],
      ["image", "inspect", "--format", "{{.Id}}", "actual-project-portal"],
    ]);
    const command = p.runDocker.mock.calls.find(([args]) => args[0] === "run")![0];
    expect(command).toEqual(expect.arrayContaining(["--network", "none", "--read-only", configDigest, "/app/scripts/reassessment-capability-probe.mjs"]));
    expect(command).not.toContain("actual-project-portal");
    expect(p.recordCompatibility).toHaveBeenCalledWith("SUR-COMPAT", { stage: "preflight", observedAt: expect.any(String), proof: { ...info, configDigest } });
    expect(p.failRun).not.toHaveBeenCalled();
  });
  it("uses the default compose project and refuses tag movement before evidence is recorded", async () => {
    const p = ports();
    p.runDocker.mockResolvedValueOnce({ exitCode: 0, stdout: configDigest, stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify(info), stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: `sha256:${"f".repeat(64)}`, stderr: "" });
    expect(await runReassessmentCandidatePreflight({ ...p, composeProject: undefined })).toMatchObject({ ok: false, reason: "reassessment-compatibility-unproven" });
    expect(p.runDocker).toHaveBeenCalledWith(["image", "inspect", "--format", "{{.Id}}", "dpf-portal"]);
    expect(p.recordCompatibility).not.toHaveBeenCalled();
  });
  it("probes a release's frozen config digest without resolving any moving image tag", async () => {
    const p = ports();
    const release = { tag: "v2.0.0", ghcrOwner: "owner", channelDigest: `sha256:${"1".repeat(64)}`, platformManifestDigest: `sha256:${"2".repeat(64)}`, configDigest,
      platformOs: "linux" as const, platformArchitecture: "amd64" };
    expect(await runReassessmentCandidatePreflight({ ...p, stage: "swap", release })).toMatchObject({ ok: true });
    expect(p.runDocker.mock.calls.flatMap(([args]) => args)).not.toContain("actual-project-portal");
    expect(p.runDocker.mock.calls.flatMap(([args]) => args)).not.toContain("ghcr.io/owner/dpf-portal:v2.0.0");
    expect(p.recordCompatibility).toHaveBeenCalledWith("SUR-COMPAT", expect.objectContaining({ stage: "swap" }));
  });
  // BI-A9BA9583: Docker's containerd image store names a pulled image by its
  // index (channel) digest, so `--pull never <configDigest>` finds nothing and
  // every release upgrade was refused. Resolve the engine's id through the
  // release's immutable references, exactly as promote.sh accepts it.
  describe("a release on either Docker image store", () => {
    const channelDigest = `sha256:${"1".repeat(64)}`, platformManifestDigest = `sha256:${"2".repeat(64)}`;
    const release = { tag: "v2.0.0", ghcrOwner: "owner", channelDigest, platformManifestDigest, configDigest,
      platformOs: "linux" as const, platformArchitecture: "amd64" };
    const engine = (known: Record<string, string>, probe: unknown = info) => {
      const runDocker = vi.fn(async (args: string[]) => {
        if (args[0] === "image") {
          const id = known[args[4]!];
          return id ? { exitCode: 0, stdout: `${id}
`, stderr: "" } : { exitCode: 1, stdout: "", stderr: "No such image" };
        }
        return { exitCode: 0, stdout: JSON.stringify(probe), stderr: "" };
      });
      return { ...ports(), runDocker };
    };

    it("probes by the channel digest the containerd store names the image by", async () => {
      const p = engine({ [`ghcr.io/owner/dpf-portal@${channelDigest}`]: channelDigest });
      expect(await runReassessmentCandidatePreflight({ ...p, release })).toEqual({ ok: true, data: { proof: { ...info, configDigest: channelDigest } } });
      const command = p.runDocker.mock.calls.find(([args]) => args[0] === "run")![0];
      expect(command).toEqual(expect.arrayContaining(["--pull", "never", channelDigest]));
      expect(p.runDocker.mock.calls.flatMap(([args]) => args)).not.toContain("ghcr.io/owner/dpf-portal:v2.0.0");
    });

    it("probes by the config digest the classic store names the image by", async () => {
      const p = engine({ [configDigest]: configDigest });
      expect(await runReassessmentCandidatePreflight({ ...p, release })).toEqual({ ok: true, data: { proof: { ...info, configDigest } } });
    });

    it("refuses an engine id that is none of the release's frozen digests", async () => {
      const p = engine({ [`ghcr.io/owner/dpf-portal@${channelDigest}`]: `sha256:${"9".repeat(64)}` });
      expect(await runReassessmentCandidatePreflight({ ...p, release })).toMatchObject({ ok: false, reason: "reassessment-compatibility-unproven" });
      expect(p.runDocker.mock.calls.some(([args]) => args[0] === "run")).toBe(false);
      expect(p.recordCompatibility).not.toHaveBeenCalled();
    });

    it("refuses a release image that is not present locally", async () => {
      const p = engine({});
      expect(await runReassessmentCandidatePreflight({ ...p, release })).toMatchObject({ ok: false, reason: "reassessment-compatibility-unproven" });
      expect(p.recordCompatibility).not.toHaveBeenCalled();
    });

    // BI-578131A3: SUR-F2A0D477's run row said only "reassessment-compatibility-unproven";
    // Docker's "No such image" was discarded and the cause took a manual repro.
    it("names every reference it tried and Docker's answer in the run's failure log", async () => {
      const p = engine({ [`ghcr.io/owner/dpf-portal@${channelDigest}`]: `sha256:${"9".repeat(64)}` });
      await runReassessmentCandidatePreflight({ ...p, release });
      const [, log, reason] = p.failRun.mock.calls[0]!;
      expect(reason).toBe("reassessment-compatibility-unproven: release-image-unresolved");
      expect(log).toContain(`${configDigest} -> No such image`);
      expect(log).toContain(`ghcr.io/owner/dpf-portal@${channelDigest} -> foreign id sha256:${"9".repeat(64)}`);
    });

    it("carries the probe's exit code and stderr when the image will not run", async () => {
      const p = engine({ [configDigest]: configDigest });
      p.runDocker.mockImplementation(async (args: string[]) => args[0] === "image"
        ? { exitCode: 0, stdout: configDigest, stderr: "" }
        : { exitCode: 125, stdout: "", stderr: `docker: Error response from daemon: No such image: ${configDigest}` });
      await runReassessmentCandidatePreflight({ ...p, release });
      const [, log, reason] = p.failRun.mock.calls[0]!;
      expect(reason).toBe("reassessment-compatibility-unproven: probe-exit-125");
      expect(log).toContain("No such image");
    });
  });

  it("refuses a release missing its frozen digest instead of falling back to a source image", async () => {
    const p = ports();
    expect(await runReassessmentCandidatePreflight({ ...p, release: {} as never })).toMatchObject({ ok: false });
    expect(p.runDocker).not.toHaveBeenCalled(); expect(p.recordCompatibility).not.toHaveBeenCalled();
  });
  it.each([
    ["missing image identity", { inspection: "" }, "source-image-unresolved"],
    ["mutable image identity", { inspection: "latest" }, "source-image-unresolved"],
    ["failed observation", { exitCode: 1 }, "source-image-unresolved"],
    ["different source", { probe: { ...info, sourceSha: "f".repeat(40) } }, "probe-source-mismatch"],
    ["missing owner", { probe: { ...info, owners: {} } }, "probe-output-invalid"],
    ["old worker", { probe: { ...info, owners: { ...info.owners, worker: { version: 1, sourceSha256: "e".repeat(64) } } } }, "probe-output-invalid"],
  ])("refuses %s before recording proof, naming the cause", async (_name, override, subcode) => {
    const p = ports(override);
    expect(await runReassessmentCandidatePreflight(p)).toEqual({ ok: false, reason: "reassessment-compatibility-unproven" });
    expect(p.recordCompatibility).not.toHaveBeenCalled();
    expect(p.failRun).toHaveBeenCalledWith("SUR-COMPAT", expect.stringMatching(new RegExp(`^reassessment-compatibility-unproven: ${subcode}`)),
      `reassessment-compatibility-unproven: ${subcode}`);
    expect(p.emitFailure).toHaveBeenCalledWith("SUR-COMPAT");
  });
  it("refuses unavailable evidence persistence instead of admitting an unrecorded candidate", async () => {
    const p = ports(); p.recordCompatibility.mockRejectedValueOnce(new Error("unavailable"));
    expect(await runReassessmentCandidatePreflight(p)).toMatchObject({ ok: false });
    expect(p.failRun).toHaveBeenCalledExactlyOnceWith("SUR-COMPAT", "reassessment-compatibility-unproven: proof-unrecorded: unavailable",
      "reassessment-compatibility-unproven: proof-unrecorded");
  });
  it("dry run performs no image or proof effects", async () => {
    const p = ports(); expect(await runReassessmentCandidatePreflight({ ...p, dryRun: true })).toEqual({ ok: true, data: {} });
    expect(p.runDocker).not.toHaveBeenCalled(); expect(p.recordCompatibility).not.toHaveBeenCalled();
  });
});

describe("candidate signed install-state handoff", () => {
  it("resolves a published release promoter without attempting a source build", async () => {
    const secret = "s".repeat(32);
    const release = {
      tag: "v2026.08.24-consumer-self-upgrade.4",
      ghcrOwner: "owner",
      channelDigest: `sha256:${"a".repeat(64)}`,
      platformManifestDigest: `sha256:${"b".repeat(64)}`,
      configDigest: `sha256:${"c".repeat(64)}`,
      platformOs: "linux" as const,
      platformArchitecture: "amd64",
    };
    const artifact = { digest: `sha256:${"d".repeat(64)}`, contractSchema: 1, contractDigest: "c".repeat(64) } as never;
    const runtime = { buildCandidatePromoterImage: vi.fn(), resolvePromoterArtifact: vi.fn(async () => artifact), runPromoterReadiness: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ sourceHash: "a".repeat(64), projectionHash: "b".repeat(64), fromSchemaVersion: 2, toSchemaVersion: 2 }), stderr: "" })) };
    const result = await runCandidatePreflight({ candidatePromoterReference: "ghcr.io/owner/dpf-promoter:v2.0.0", release, sourcePath: "/source-free-install", hostInstallPath: "/host", canonicalInstallPath: "/host", targetSha: "b".repeat(40), runId: "SUR-release", composeFiles: [], healthUrl: "http://health", hostIdentity: { platform: "linux", arch: "amd64", provenance: "install-state" }, runtimeTransitionSecret: secret, runtime: async () => runtime as never, recordReadiness: vi.fn(), failRun: vi.fn(), emitFailure: vi.fn(), prePullDoctools: vi.fn(async () => ({ outcome: "present" as const, image: "ghcr.io/owner/dpf-doctools@sha256:" + "e".repeat(64) })) });
    expect(result.ok).toBe(true);
    expect(runtime.buildCandidatePromoterImage).not.toHaveBeenCalled();
    expect(runtime.resolvePromoterArtifact).toHaveBeenCalledWith(expect.objectContaining({ promoterImage: "ghcr.io/owner/dpf-promoter:v2.0.0", candidateReference: "ghcr.io/owner/dpf-promoter:v2.0.0", targetSha: "b".repeat(40) }));
    expect(runtime.runPromoterReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ release }),
    );
  });

  describe("pre-pulls the target release's dpf-doctools before the swap (BI-698B7F9A)", () => {
    const release = {
      tag: "v2026.09.25-office.1", ghcrOwner: "owner",
      channelDigest: `sha256:${"a".repeat(64)}`, platformManifestDigest: `sha256:${"b".repeat(64)}`,
      configDigest: `sha256:${"c".repeat(64)}`, platformOs: "linux" as const, platformArchitecture: "amd64",
    };
    const artifact = { digest: `sha256:${"d".repeat(64)}`, contractSchema: 1, contractDigest: "c".repeat(64) } as never;
    const readyRuntime = () => ({
      buildCandidatePromoterImage: vi.fn(),
      resolvePromoterArtifact: vi.fn(async () => artifact),
      runPromoterReadiness: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ sourceHash: "a".repeat(64), projectionHash: "b".repeat(64), fromSchemaVersion: 2, toSchemaVersion: 2 }), stderr: "" })),
    });
    const params = (overrides: Record<string, unknown>) => ({
      candidatePromoterReference: "ghcr.io/owner/dpf-promoter:v2026.09.25-office.1", release, sourcePath: "/s", hostInstallPath: "/host",
      canonicalInstallPath: "/host", targetSha: "b".repeat(40), runId: "SUR-doctools", composeFiles: [], healthUrl: "http://health",
      hostIdentity: { platform: "linux" as const, arch: "amd64" as const, provenance: "install-state" as const }, runtimeTransitionSecret: "s".repeat(32),
      recordReadiness: vi.fn(), failRun: vi.fn(), emitFailure: vi.fn(), ...overrides,
    });

    it("pulls it FIRST, before the promoter and readiness, so a long pull cannot expire the signed handoff", async () => {
      const order: string[] = [];
      const runtime = readyRuntime();
      runtime.resolvePromoterArtifact.mockImplementation(async () => { order.push("promoter"); return artifact; });
      const prePullDoctools = vi.fn(async () => { order.push("doctools"); return { outcome: "pulled" as const, image: "x" }; });
      const result = await runCandidatePreflight(params({ runtime: async () => runtime as never, prePullDoctools }) as never);
      expect(result.ok).toBe(true);
      expect(prePullDoctools).toHaveBeenCalledWith(release);
      expect(order).toEqual(["doctools", "promoter"]);
    });

    it("lets a release that published no converter through (BI-E6EF0B2C: a missing optional image never blocks an upgrade)", async () => {
      const runtime = readyRuntime();
      const failRun = vi.fn();
      const result = await runCandidatePreflight(params({ runtime: async () => runtime as never, failRun, prePullDoctools: vi.fn(async () => ({ outcome: "not-published" as const })) }) as never);
      expect(result.ok).toBe(true);
      expect(failRun).not.toHaveBeenCalled();
    });

    it("fails the run before the drain with a plain reason when the pull does not land (AC-3)", async () => {
      const runtime = readyRuntime();
      const failRun = vi.fn();
      const emitFailure = vi.fn();
      const recordReadiness = vi.fn();
      const reason = "could not download the v2026.09.25-office.1 document converter: toomanyrequests";
      const result = await runCandidatePreflight(params({ runtime: async () => runtime as never, failRun, emitFailure, recordReadiness, prePullDoctools: vi.fn(async () => ({ outcome: "failed" as const, reason })) }) as never);
      expect(result).toEqual({ ok: false, reason: "doctools-prepull-failed" });
      expect(failRun).toHaveBeenCalledWith("SUR-doctools", `doctools-prepull-failed: ${reason}`, `doctools-prepull-failed: ${reason}`);
      expect(emitFailure).toHaveBeenCalledWith("SUR-doctools");
      expect(recordReadiness).toHaveBeenCalledWith("SUR-doctools", expect.objectContaining({ result: "failed", quiescenceBegan: false, failures: [{ code: "doctools_prepull_failed", message: reason }] }));
      expect(runtime.resolvePromoterArtifact).not.toHaveBeenCalled();
      expect(runtime.runPromoterReadiness).not.toHaveBeenCalled();
    });

    it("does not pre-pull on a source upgrade, which has no release to name", async () => {
      const runtime = { ...readyRuntime(), buildCandidatePromoterImage: vi.fn(async () => "candidate") };
      const prePullDoctools = vi.fn();
      const result = await runCandidatePreflight(params({ candidatePromoterReference: undefined, release: undefined, runtime: async () => runtime as never, prePullDoctools }) as never);
      expect(result.ok).toBe(true);
      expect(prePullDoctools).not.toHaveBeenCalled();
    });

    it("on a customizable install's source upgrade, pre-pulls the release the TARGET descends from, first (BI-4E18BC28)", async () => {
      const order: string[] = [];
      const runtime = { ...readyRuntime(), buildCandidatePromoterImage: vi.fn(async () => { order.push("promoter"); return "candidate"; }) };
      const sourceLineage = vi.fn(async () => ({ imageTag: "v2026.09.25-shape-raise.1", ghcrOwner: "owner" }));
      const prePullDoctools = vi.fn(async () => { order.push("doctools"); return { outcome: "pulled" as const, image: "x" }; });
      const result = await runCandidatePreflight(params({ candidatePromoterReference: undefined, release: undefined, runtime: async () => runtime as never, sourceLineage, prePullDoctools }) as never);
      expect(result.ok).toBe(true);
      expect(prePullDoctools).toHaveBeenCalledWith({ tag: "v2026.09.25-shape-raise.1", ghcrOwner: "owner" });
      expect(order).toEqual(["doctools", "promoter"]);
    });

    it("never fails a source upgrade over the converter: the install can still build it locally after the swap", async () => {
      const runtime = { ...readyRuntime(), buildCandidatePromoterImage: vi.fn(async () => "candidate") };
      const failRun = vi.fn();
      const result = await runCandidatePreflight(params({
        candidatePromoterReference: undefined, release: undefined, runtime: async () => runtime as never, failRun,
        sourceLineage: vi.fn(async () => ({ imageTag: "v2026.09.25-shape-raise.1", ghcrOwner: "owner" })),
        prePullDoctools: vi.fn(async () => ({ outcome: "failed" as const, reason: "offline" })),
      }) as never);
      expect(result.ok).toBe(true);
      expect(failRun).not.toHaveBeenCalled();
    });

    it("a source upgrade whose target has no release lineage pulls nothing", async () => {
      const runtime = { ...readyRuntime(), buildCandidatePromoterImage: vi.fn(async () => "candidate") };
      const prePullDoctools = vi.fn();
      const result = await runCandidatePreflight(params({ candidatePromoterReference: undefined, release: undefined, runtime: async () => runtime as never, sourceLineage: vi.fn(async () => null), prePullDoctools }) as never);
      expect(result.ok).toBe(true);
      expect(prePullDoctools).not.toHaveBeenCalled();
    });
  });

  it("returns a digest-bound signed envelope from candidate readiness", async () => {
    const secret = "s".repeat(32);
    const artifact = { digest: `sha256:${"d".repeat(64)}`, contractSchema: 1, contractDigest: "c".repeat(64) } as never;
    const runtime = { buildCandidatePromoterImage: vi.fn(async () => "candidate"), resolvePromoterArtifact: vi.fn(async () => artifact), runPromoterReadiness: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ sourceHash: "a".repeat(64), projectionHash: "b".repeat(64), fromSchemaVersion: 1, toSchemaVersion: 2, migrationRequired: true }), stderr: "" })) };
    const result = await runCandidatePreflight({ sourcePath: "/source", hostInstallPath: "/host", canonicalInstallPath: "/host", targetSha: "target", runId: "SUR-1", composeFiles: [], healthUrl: "http://health", hostIdentity: { platform: "linux", arch: "arm64", provenance: "explicit" }, runtimeTransitionSecret: secret, now: () => new Date("2026-07-18T00:00:00Z"), runtime: async () => runtime as never, recordReadiness: vi.fn(), failRun: vi.fn(), emitFailure: vi.fn() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const migrationHandoff = result.migrationHandoff;
    expect(migrationHandoff).toBeDefined();
    if (!migrationHandoff) throw new Error("expected signed install-state migration handoff");
    expect(migrationHandoff.envelope).toMatchObject({ runId: "SUR-1", promoterDigest: `sha256:${"d".repeat(64)}`, hostIdentity: { platform: "linux", arch: "arm64", provenance: "explicit" } });
    expect(migrationHandoff.signature).toBe(signTransitionPayload(migrationHandoff.envelope, secret));
    expect(runtime.runPromoterReadiness).toHaveBeenCalledWith(expect.objectContaining({ hostIdentity: migrationHandoff.envelope.hostIdentity }));
  });

  it("refuses legacy bootstrap without a signed migration carrier", async () => {
    const failRun = vi.fn();
    const result = await runCandidatePreflight({ readinessMode: "legacy-bootstrap", readinessOwner: "bridge", sourcePath: "/source", hostInstallPath: "/host", canonicalInstallPath: "/host", targetSha: "target", runId: "SUR-legacy", composeFiles: [], healthUrl: "http://health", runtime: vi.fn(), recordReadiness: vi.fn(), failRun, emitFailure: vi.fn() });
    expect(result).toEqual({ ok: false, reason: "installer-state-repair-required" });
    expect(failRun).toHaveBeenCalledWith("SUR-legacy", expect.stringContaining("installer-state-repair-required"));
  });
});

describe("refreshMigrationHandoffAfterDrain (BI-95DF1BFC)", () => {
  const secret = "s".repeat(32);
  const digest = `sha256:${"d".repeat(64)}`;
  const hostIdentity = { platform: "linux" as const, arch: "amd64" as const, provenance: "explicit" as const };
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const handoffFor = (stateText: string, runId = "SUR-1"): InstallStateMigrationHandoff => {
    const now = new Date();
    const envelope: InstallStateMigrationHandoff["envelope"] = {
      version: 1 as const, kind: "install-state-migration" as const, runId,
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      sourceHash: sha(stateText), projectionHash: sha(stateText), fromSchemaVersion: 2, toSchemaVersion: 2,
      hostIdentity, promoterDigest: digest,
    };
    return { envelope, signature: signTransitionPayload(envelope, secret) };
  };
  const base = () => ({ runId: "SUR-1", resolvedPromoterDigest: digest, runtimeTransitionSecret: secret, hostIdentity, failRun: vi.fn(), emitFailure: vi.fn() });

  it("keeps the readiness handoff when the install-state did not move", async () => {
    const state = '{"schemaVersion":2}';
    fsMocks.readFile.mockResolvedValue(state);
    const migrationHandoff = handoffFor(state);
    const rerunPreflight = vi.fn();
    const result = await refreshMigrationHandoffAfterDrain({ ...base(), migrationHandoff, rerunPreflight });
    expect(result).toMatchObject({ ok: true, data: { refreshed: false, migrationHandoff, resolvedPromoterDigest: digest } });
    expect(rerunPreflight).not.toHaveBeenCalled();
  });

  it("re-runs readiness and carries the fresh handoff when a host-side writer moved the state during the drain", async () => {
    // SUR-4758058F: the agent-toolchain bootstrap rewrote install-state.json
    // three minutes into the drain; promote.sh then refused the stale envelope.
    const before = '{"schemaVersion":2}';
    const after = '{"schemaVersion":2,"agentToolchain":{"appliedAt":"2026-09-08T22:22:43Z"}}';
    fsMocks.readFile.mockResolvedValue(after);
    const stale = handoffFor(before);
    const fresh = handoffFor(after);
    const rerunPreflight = vi.fn(async () => ({ ok: true as const, resolvedPromoterDigest: digest, migrationHandoff: fresh }));
    const params = base();
    const result = await refreshMigrationHandoffAfterDrain({ ...params, migrationHandoff: stale, rerunPreflight });
    expect(result).toMatchObject({ ok: true, data: { refreshed: true, code: "install_state_envelope_state_changed", migrationHandoff: fresh } });
    expect(rerunPreflight).toHaveBeenCalledTimes(1);
    expect(params.failRun).not.toHaveBeenCalled();
  });

  it("re-runs readiness when the drain outlived the envelope TTL", async () => {
    const state = '{"schemaVersion":2}';
    fsMocks.readFile.mockResolvedValue(state);
    const expired = handoffFor(state);
    expired.envelope.expiresAt = new Date(Date.now() - 1_000).toISOString();
    expired.signature = signTransitionPayload(expired.envelope, secret);
    const fresh = handoffFor(state);
    const rerunPreflight = vi.fn(async () => ({ ok: true as const, resolvedPromoterDigest: digest, migrationHandoff: fresh }));
    const result = await refreshMigrationHandoffAfterDrain({ ...base(), migrationHandoff: expired, rerunPreflight });
    expect(result).toMatchObject({ ok: true, data: { refreshed: true, code: "install_state_envelope_expired", migrationHandoff: fresh } });
  });

  it("stays fail-closed on a tampered or wrong-run envelope instead of re-projecting over it", async () => {
    const state = '{"schemaVersion":2}';
    fsMocks.readFile.mockResolvedValue(state);
    const wrongRun = handoffFor(state, "SUR-other");
    const rerunPreflight = vi.fn();
    const params = base();
    const result = await refreshMigrationHandoffAfterDrain({ ...params, migrationHandoff: wrongRun, rerunPreflight });
    expect(result).toEqual({ ok: false, reason: "installer-state-repair-required: install_state_envelope_wrong_run" });
    expect(rerunPreflight).not.toHaveBeenCalled();
    expect(params.failRun).toHaveBeenCalledWith("SUR-1", expect.stringContaining("install_state_envelope_wrong_run"));
    expect(params.emitFailure).toHaveBeenCalledWith("SUR-1");
  });

  it("fails the run when the re-run readiness refuses", async () => {
    fsMocks.readFile.mockResolvedValue('{"moved":true}');
    const stale = handoffFor('{"schemaVersion":2}');
    const rerunPreflight = vi.fn(async () => ({ ok: false as const, reason: "promoter-readiness-failed" as const }));
    const result = await refreshMigrationHandoffAfterDrain({ ...base(), migrationHandoff: stale, rerunPreflight });
    expect(result).toEqual({ ok: false, reason: "promoter-readiness-failed" });
  });
});

describe("resolveReadinessBackupHostPath (BI-E2625B79)", () => {
  it("uses an explicit DPF_BACKUPS_HOST_PATH when set", () => {
    expect(resolveReadinessBackupHostPath("/vol/backups", "/opt/dpf")).toBe("/vol/backups");
  });

  it("falls back to <install>/backups when the env var is EMPTY (the documented compose default)", () => {
    // .env ships DPF_BACKUPS_HOST_PATH= empty by design; a plain `?? undefined`
    // leaks "" through and skips the /backups mount -> recovery_parent_unavailable.
    expect(resolveReadinessBackupHostPath("", "/opt/dpf")).toBe("/opt/dpf/backups");
  });

  it("falls back to <install>/backups when the env var is unset", () => {
    expect(resolveReadinessBackupHostPath(undefined, "/opt/dpf")).toBe("/opt/dpf/backups");
  });

  it("treats whitespace-only as unset and strips a trailing slash from the install path", () => {
    expect(resolveReadinessBackupHostPath("   ", "/opt/dpf/")).toBe("/opt/dpf/backups");
  });
});
