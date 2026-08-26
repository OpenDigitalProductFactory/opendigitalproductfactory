import { describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PROMOTER_BUILD_CONTEXT_FILES, PROMOTER_BUILD_CONTEXT_SOURCES } from "./promoter-build-context";
import {
  buildPromoterCommand,
  buildCandidatePromoterImage,
  buildPromoterReadinessCommand,
  decidePromoterEnsureAction,
  decidePromoterLaunch,
  interpretContainerInspect,
  isJitBuildablePromoterImage,
  PROMOTER_ALREADY_RUNNING_EXIT_CODE,
  PROMOTER_JIT_BUILD_SCRIPT,
  PROMOTER_TIMEOUT_EXIT_CODE,
  resolvePromoterTimeoutMs,
  runProcessWithBudget,
  validateResolvedPromoterArtifact,
  resolvePromoterArtifact,
} from "./promoter";

const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const testBash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";

const BASE = {
  hostInstallPath: "/Users/me/dpf",
  targetSha: "abc1234",
  backupPath: "/backups/self-upgrade/run-1",
  healthUrl: "http://localhost:3000/api/health",
};

it("mechanically closes every staged promoter input through portal baking and JIT staging", () => {
  // Keyed on the staged closure, not on Dockerfile.promoter's COPY lines:
  // the Dockerfile copies `scripts/` as a directory so a candidate stays
  // buildable by an already-deployed N-1 portal whose staged context predates a
  // newly added file (BI-A04D61B9). PROMOTER_BUILD_CONTEXT_SOURCES is what
  // enumerates the files, and it is what the portal must bake and the JIT
  // recipe must stage.
  const root = resolve(__dirname, "../../../..");
  const portalDockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  const sources = PROMOTER_BUILD_CONTEXT_SOURCES;
  for (const source of sources) {
    const baked = source === "promoter-contract.json" ? "/promoter/promoter-contract.json" : `/promoter/${source}`;
    expect(portalDockerfile, `portal image must bake ${source}`).toMatch(new RegExp(`^COPY\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${baked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    expect(PROMOTER_JIT_BUILD_SCRIPT, `JIT recipe must stage ${source}`).toContain(`cp ${baked} \"$BDIR/${source}\"`);
  }
});

describe("validateResolvedPromoterArtifact", () => {
  const manifest = JSON.stringify({ schemaVersion: 1, callerProtocol: { min: 1, max: 1 } });
  const digest = "sha256:" + "a".repeat(64);
  const labels = {
    "org.opencontainers.image.revision": "abc1234",
    "org.opendpf.promoter.contract-schema": "1",
    "org.opendpf.promoter.contract-digest": "sha256:" + "b".repeat(64),
  };

  it("returns an immutable artifact when identity and protocol agree", () => {
    expect(validateResolvedPromoterArtifact({ targetSha: "abc1234", callerProtocol: 1, digest, manifest, labels, computedContractDigest: labels["org.opendpf.promoter.contract-digest"] })).toEqual({
      digest,
      sourceSha: "abc1234",
      contractSchema: 1,
      contractDigest: labels["org.opendpf.promoter.contract-digest"],
      callerProtocol: { min: 1, max: 1 },
    });
  });

  it.each([
    ["source SHA mismatch", { targetSha: "other" }],
    ["unknown schema", { manifest: JSON.stringify({ schemaVersion: 2, callerProtocol: { min: 1, max: 1 } }) }],
    ["caller protocol mismatch", { callerProtocol: 2 }],
    ["contract digest mismatch", { computedContractDigest: "sha256:" + "c".repeat(64) }],
    ["mutable image reference", { digest: "dpf-promoter:latest" }],
  ])("rejects %s", (_name, override) => {
    expect(() => validateResolvedPromoterArtifact({ targetSha: "abc1234", callerProtocol: 1, digest, manifest, labels, computedContractDigest: labels["org.opendpf.promoter.contract-digest"], ...override })).toThrow();
  });
});

describe("buildPromoterReadinessCommand", () => {
  it("runs readiness against the immutable digest", () => {
    const artifact = validateResolvedPromoterArtifact({
      targetSha: "abc1234", callerProtocol: 1, digest: "sha256:" + "a".repeat(64),
      manifest: JSON.stringify({ schemaVersion: 1, callerProtocol: { min: 1, max: 1 } }),
      labels: { "org.opencontainers.image.revision": "abc1234", "org.opendpf.promoter.contract-schema": "1", "org.opendpf.promoter.contract-digest": "sha256:" + "b".repeat(64) },
      computedContractDigest: "sha256:" + "b".repeat(64),
    });
    const readinessParams = {
      ...BASE,
      stateDirHostPath: "/Users/me/.dpf",
      backupHostPath: "/Users/me/dpf-backups",
      artifact,
    };
    const { args } = buildPromoterReadinessCommand(readinessParams);
    expect(args).toContain(artifact.digest);
    expect(args).toContain("--readiness");
    expect(args).not.toContain("--self-upgrade");
    expect(args).not.toContain("/var/run/docker.sock:/var/run/docker.sock");
    expect(args).toContain(`${readinessParams.stateDirHostPath}:/dpf-state:ro`);
    expect(args).toContain(`${readinessParams.backupHostPath}:/backups:ro`);
    expect(args).toContain("DPF_PROMOTER_DOCKER_PREFLIGHT=ready");
  });

  it("passes verified host provenance while keeping install state read-only", () => {
    const artifact = { digest: `sha256:${"a".repeat(64)}`, sourceSha: "abc1234", contractSchema: 1, contractDigest: `sha256:${"b".repeat(64)}`, callerProtocol: { min: 1, max: 1 } } as const;
    const { args } = buildPromoterReadinessCommand({ ...BASE, stateDirHostPath: "/state", artifact, hostIdentity: { platform: "linux", arch: "arm64", provenance: "explicit" } });
    expect(args).toContain("/state:/dpf-state:ro");
    expect(args).toContain("DPF_HOST_PLATFORM=linux");
    expect(args).toContain("DPF_HOST_IDENTITY_PROVENANCE=explicit");
  });
});

describe("install-state migration promotion carrier", () => {
  it("mounts the existing secret read-only and forwards the exact signed object", () => {
    const encoded = Buffer.from(JSON.stringify({ runId: "SUR-1" })).toString("base64url");
    const digest = `sha256:${"d".repeat(64)}`;
    const { args } = buildPromoterCommand({ ...BASE, promoterImage: digest, stateDirHostPath: "/state", installStateMigrationEnvelope: encoded, installStateMigrationSignature: "a".repeat(64), installStateMigrationRunId: "SUR-1" });
    expect(args).toContain("/state/runtime-transition.secret:/run/secrets/dpf-runtime-transition:ro");
    expect(args).toContain(`DPF_INSTALL_STATE_MIGRATION_ENVELOPE=${encoded}`);
    expect(args).toContain(`DPF_PROMOTER_DIGEST=${digest}`);
  });
});

describe("resolvePromoterArtifact", () => {
  it("pulls an exact verified release-tag reference while validating its source SHA", async () => {
    const manifest = JSON.stringify({ schemaVersion: 1, callerProtocol: { min: 1, max: 1 } });
    const contractDigest = `sha256:${(await import("node:crypto")).createHash("sha256").update(manifest).digest("hex")}`;
    const digest = `sha256:${"e".repeat(64)}`;
    const calls: string[][] = [];
    await resolvePromoterArtifact({ promoterImage: "ghcr.io/owner/dpf-promoter:v2.0.0", candidateReference: "ghcr.io/owner/dpf-promoter:v2.0.0", targetSha: "b".repeat(40) }, async (args) => {
      calls.push(args);
      if (args[0] === "pull") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "image") return { exitCode: 0, stdout: JSON.stringify({ RepoDigests: [`ghcr.io/owner/dpf-promoter@${digest}`], Config: { Labels: { "org.opencontainers.image.revision": "b".repeat(40), "org.opendpf.promoter.contract-schema": "1", "org.opendpf.promoter.contract-digest": contractDigest } } }), stderr: "" };
      return { exitCode: 0, stdout: manifest, stderr: "" };
    });
    expect(calls[0]).toEqual(["pull", "ghcr.io/owner/dpf-promoter:v2.0.0"]);
  });

  it("pulls a target-SHA tag once and returns its immutable digest", async () => {
    const manifest = JSON.stringify({ schemaVersion: 1, callerProtocol: { min: 1, max: 1 } });
    const contractDigest = `sha256:${(await import("node:crypto")).createHash("sha256").update(manifest).digest("hex")}`;
    const digest = `sha256:${"d".repeat(64)}`;
    const calls: string[][] = [];
    const artifact = await resolvePromoterArtifact({ promoterImage: "registry/dpf-promoter", targetSha: "abc1234" }, async (args) => {
      calls.push(args);
      if (args[0] === "pull") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "image") return { exitCode: 0, stdout: JSON.stringify({ RepoDigests: [`registry/dpf-promoter@${digest}`], Config: { Labels: { "org.opencontainers.image.revision": "abc1234", "org.opendpf.promoter.contract-schema": "1", "org.opendpf.promoter.contract-digest": contractDigest } } }), stderr: "" };
      return { exitCode: 0, stdout: manifest, stderr: "" };
    });
    expect(artifact.digest).toBe(digest);
    expect(calls[0]).toEqual(["pull", "registry/dpf-promoter:abc1234"]);
    expect(calls[2]).toContain(digest);
  });

  it("fails closed when pull, inspect, manifest, or identity verification fails", async () => {
    await expect(resolvePromoterArtifact({ targetSha: "abc" }, async () => ({ exitCode: 1, stdout: "", stderr: "absent" }))).rejects.toThrow("promoter_inspect_failed");
  });
});

describe("buildCandidatePromoterImage", () => {
  it("builds an offline target-SHA image from a minimal staged context, never the whole workspace", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "dpf-promoter-candidate-"));
    try {
      // A real candidate checkout contains every promoter build input…
      for (const file of PROMOTER_BUILD_CONTEXT_FILES) {
        const dest = join(sourcePath, file);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(
          dest,
          file === "promoter-contract.json" ? '{"schemaVersion":1}\n' : `// ${file}\n`,
        );
      }
      // …plus a large decoy tree that must NOT be walked into the docker context
      // (walking it was the readdirent OOM that bricked SUR-BF75ED2A).
      await mkdir(join(sourcePath, "apps", "web"), { recursive: true });
      await writeFile(join(sourcePath, "apps", "web", "huge.txt"), "x".repeat(4096));

      const calls: string[][] = [];
      let stagedFiles: string[] = [];
      const image = await buildCandidatePromoterImage(
        { sourcePath, targetSha: "abc1234" },
        async (args) => {
          calls.push(args);
          // The staged context still exists here (cleaned up in a finally after).
          const contextDir = String(args.at(-1));
          stagedFiles = readdirSync(contextDir, { recursive: true })
            .map((p) => String(p).replaceAll("\\", "/"))
            .filter((p) => !statSync(join(contextDir, p)).isDirectory())
            .sort();
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      );

      expect(image).toBe("dpf-promoter:abc1234");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.slice(0, 4)).toEqual(["buildx", "build", "--load", "-f"]);
      expect(calls[0]).toContain("DPF_PROMOTER_SOURCE_SHA=abc1234");

      // Context is the throwaway staged dir, not the source workspace.
      const contextDir = String(calls[0]?.at(-1));
      expect(contextDir).not.toBe(sourcePath);
      expect(contextDir).toContain("dpf-promoter-ctx-");
      // The staged dir is removed once the build returns.
      expect(existsSync(contextDir)).toBe(false);
      // -f resolves inside that staged context.
      expect(calls[0]?.[4]).toBe(join(contextDir, "Dockerfile.promoter"));

      // Exactly the promoter inputs are staged — the apps/web decoy is absent.
      expect(stagedFiles).toEqual([...PROMOTER_BUILD_CONTEXT_FILES].sort());
      expect(stagedFiles.some((p) => p.startsWith("apps/"))).toBe(false);
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
    }
  });
});

describe("buildPromoterCommand", () => {
  it("launches release promotion with a narrowly writable install and immutable release identity", () => {
    const { args } = buildPromoterCommand({
      ...BASE,
      release: {
        tag: "v2026.08.23",
        ghcrOwner: "opendigitalproductfactory",
        channelDigest: `sha256:${"a".repeat(64)}`,
        platformManifestDigest: `sha256:${"b".repeat(64)}`,
        configDigest: `sha256:${"c".repeat(64)}`,
        platformOs: "linux",
        platformArchitecture: "amd64",
      },
    });
    expect(args).toContain("/Users/me/dpf:/host-source");
    expect(args).not.toContain("/Users/me/dpf:/host-source:ro");
    expect(args).toContain("DPF_PROMOTION_MODE=release");
    expect(args).toContain("DPF_RELEASE_TAG=v2026.08.23");
    expect(args).toContain(`DPF_RELEASE_CONFIG_DIGEST=sha256:${"c".repeat(64)}`);
    expect(args).toContain(`DPF_RELEASE_CHANNEL_DIGEST=sha256:${"a".repeat(64)}`);
    expect(args).toContain(`DPF_RELEASE_PLATFORM_MANIFEST_DIGEST=sha256:${"b".repeat(64)}`);
    expect(args).toContain("DPF_RELEASE_PLATFORM_OS=linux");
    expect(args).toContain("DPF_RELEASE_PLATFORM_ARCHITECTURE=amd64");
    expect(args).toContain("GHCR_OWNER=opendigitalproductfactory");
    expect(args).toContain("PROMOTE_TARGET_SHA=abc1234");
  });

  it("reserves host transition authority without requiring an apply envelope", () => {
    const { args } = buildPromoterCommand({ ...BASE, runtimeCapabilityTransitionId: "RCT-123", stateDirHostPath: "/state", runtimeTransitionAuthorityOperation: "reserve" });
    expect(args.slice(-3)).toEqual(["--runtime-transition-authority", "reserve", "RCT-123"]);
    expect(args).toContain("/state:/dpf-state");
    expect(args).not.toContain("--runtime-capability-transition");
  });
  it("requires and forwards the opaque token when releasing authority", () => {
    const token = "a".repeat(64);
    const { args } = buildPromoterCommand({ ...BASE, runtimeCapabilityTransitionId: "RCT-123", stateDirHostPath: "/state", runtimeTransitionAuthorityOperation: "release", runtimeTransitionAuthorityToken: token });
    expect(args.slice(-4)).toEqual(["--runtime-transition-authority", "release", "RCT-123", token]);
  });
  it("passes DB-active ids to startup authority reconciliation", () => {
    const { args } = buildPromoterCommand({ ...BASE, stateDirHostPath: "/state", runtimeTransitionAuthorityOperation: "reconcile", runtimeTransitionActiveIds: ["RCT-1"] });
    expect(args).toContain("DPF_ACTIVE_RUNTIME_TRANSITION_IDS=RCT-1");
    expect(args.slice(-2)).toEqual(["--runtime-transition-authority", "reconcile"]);
  });
  it("builds governed runtime signing-key rotation", () => {
    const { args } = buildPromoterCommand({ ...BASE, stateDirHostPath: "/state", runtimeTransitionAuthorityOperation: "rotate-secret" });
    expect(args).toContain("/state:/dpf-state");
    expect(args.at(-1)).toBe("--runtime-transition-secret-rotation");
  });
  it("selects the dedicated runtime capability transition mode without self-upgrade argv", () => {
    const { args } = buildPromoterCommand({ ...BASE, runtimeCapabilityTransitionId: "RCT-123", stateDirHostPath: "/state", runtimeCapabilityEnvelope: "e".repeat(16), runtimeCapabilitySignature: "a".repeat(64), runtimeCapabilitySecretFileHostPath: "/state/transition-secret" });
    expect(args).toContain("--runtime-capability-transition");
    expect(args).toContain("RCT-123");
    expect(args).not.toContain("--self-upgrade");
  });
  it("launches the promoter as a sibling container, not bash in-portal", () => {
    const { command, args } = buildPromoterCommand(BASE);
    const joined = args.join(" ");

    // The previous defect spawned bash against an in-portal script. The
    // promoter must run as a separate docker container instead.
    expect(command).toBe("docker");
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(joined).not.toContain("bash");
    expect(joined).not.toContain("promote.sh");
    expect(joined).not.toContain("scripts/");
  });

  it("mounts the docker socket and the host source tree read-only", () => {
    const { args } = buildPromoterCommand(BASE);
    expect(args).toContain("/var/run/docker.sock:/var/run/docker.sock");
    expect(args).toContain("/Users/me/dpf:/host-source:ro");
  });

  it("mounts lifecycle state for an ordinary self-upgrade", () => {
    const { args } = buildPromoterCommand({ ...BASE, stateDirHostPath: "/host/.dpf" });
    expect(args).toContain("/host/.dpf:/dpf-state");
    expect(args).toContain("DPF_PROMOTER_STATE_DIR=/dpf-state");
    expect(args).not.toContain("DPF_STATE_DIR=/dpf-state");
  });

  it("gives transition mode only the state mount as writable and signs fixed protocol env", () => {
    const envelope = "e".repeat(16);
    const { args } = buildPromoterCommand({ ...BASE, runtimeCapabilityTransitionId: "RCT-123", stateDirHostPath: "/host/.dpf", runtimeCapabilityEnvelope: envelope, runtimeCapabilitySignature: "a".repeat(64), runtimeCapabilitySecretFileHostPath: "/host/.dpf/transition-secret", composeFiles: ["docker-compose.yml"], composeProject: "dpf" });
    expect(args.join(" ")).not.toContain("x".repeat(32));
    expect(args).toContain("/Users/me/dpf:/host-source:ro");
    expect(args).toContain("/host/.dpf:/dpf-state");
    expect(args).toContain("DPF_PROMOTER_STATE_DIR=/dpf-state");
    expect(args).not.toContain("DPF_STATE_DIR=/dpf-state");
    expect(args).toContain(`DPF_RUNTIME_TRANSITION_ENVELOPE=${envelope}`);
    expect(args.filter((arg) => arg.includes(":/host-source") && !arg.endsWith(":ro"))).toEqual([]);
  });

  it("rejects transition protocol values that could alter the docker command", () => {
    const valid = {
      ...BASE,
      runtimeCapabilityTransitionId: "RCT-123",
      stateDirHostPath: "/state",
      runtimeCapabilityEnvelope: "e".repeat(16),
      runtimeCapabilitySignature: "a".repeat(64),
      runtimeCapabilitySecretFileHostPath: "/state/transition-secret",
    };
    expect(() => buildPromoterCommand({ ...valid, runtimeCapabilityTransitionId: "RCT-123\n--privileged" })).toThrow("invalid_runtime_transition_id");
    expect(() => buildPromoterCommand({ ...valid, stateDirHostPath: "/state:/host:rw" })).toThrow("invalid_runtime_transition_host_path");
    expect(() => buildPromoterCommand({ ...valid, runtimeCapabilityEnvelope: "-e BAD=value" })).toThrow("invalid_runtime_transition_envelope");
    expect(() => buildPromoterCommand({ ...valid, runtimeCapabilitySignature: "not-a-signature" })).toThrow("invalid_runtime_transition_signature");
  });

  it("passes the promote contract via env and targets the promoter image", () => {
    const { args } = buildPromoterCommand(BASE);
    expect(args).toContain("PROMOTE_SOURCE=/host-source");
    expect(args).toContain("PROMOTE_TARGET_SHA=abc1234");
    expect(args).toContain("PROMOTE_BACKUP_PATH=/backups/self-upgrade/run-1");
    // localhost is rewritten to host.docker.internal so the sibling promoter
    // container can reach the recreated portal's published host port.
    expect(args).toContain("PROMOTE_HEALTH_URL=http://host.docker.internal:3000/api/health");
    expect(args).toContain("--add-host");
    expect(args).toContain("host.docker.internal:host-gateway");
    // Image is a positional arg followed by the entrypoint flag.
    expect(args).toContain("dpf-promoter");
    expect(args).toContain("--self-upgrade");
    expect(args.indexOf("dpf-promoter")).toBeLessThan(args.indexOf("--self-upgrade"));
  });

  it("honors a custom promoter image", () => {
    const { args } = buildPromoterCommand({ ...BASE, promoterImage: "ghcr.io/x/dpf-promoter:v1" });
    expect(args).toContain("ghcr.io/x/dpf-promoter:v1");
    expect(args).not.toContain("dpf-promoter");
  });

  it("names the container deterministically only when a name is provided", () => {
    // Without a name docker assigns a random one and a stalled build can't be
    // force-removed by the timeout path / watchdog (SUR-756751D1).
    expect(buildPromoterCommand(BASE).args).not.toContain("--name");
    const named = buildPromoterCommand({ ...BASE, containerName: "dpf-promoter-SUR-1" });
    const i = named.args.indexOf("--name");
    expect(i).toBeGreaterThan(-1);
    expect(named.args[i + 1]).toBe("dpf-promoter-SUR-1");
  });

  it("appends --dry-run only when requested", () => {
    expect(buildPromoterCommand(BASE).args).not.toContain("--dry-run");
    expect(buildPromoterCommand({ ...BASE, dryRun: true }).args).toContain("--dry-run");
    // --dry-run must come after the image + --self-upgrade entrypoint flag.
    const dry = buildPromoterCommand({ ...BASE, dryRun: true }).args;
    expect(dry.indexOf("--self-upgrade")).toBeLessThan(dry.indexOf("--dry-run"));
  });

  it("mounts the backups volume only when a host path is provided", () => {
    expect(buildPromoterCommand(BASE).args).not.toContain("/backups");
    const withBackup = buildPromoterCommand({ ...BASE, backupHostPath: "/Users/me/dpf-backups" });
    expect(withBackup.args).toContain("/Users/me/dpf-backups:/backups");
  });

  it("mounts the install env file for compose interpolation when provided", () => {
    const { args } = buildPromoterCommand({
      ...BASE,
      hostInstallPath: "/Users/me/dpf/.upgrade-workspace",
      composeEnvFileHostPath: "/Users/me/dpf/.env",
    });

    expect(args).toContain("/Users/me/dpf/.upgrade-workspace:/host-source:ro");
    expect(args).toContain("/Users/me/dpf/.env:/install-env/.env:ro");
    expect(args).toContain("PROMOTE_COMPOSE_ENV_FILE=/install-env/.env");
  });

  it("passes the install's recorded compose chain so the wrong-substrate overlay is never force-applied", () => {
    // Without this the promoter falls back to promote.sh's base-only default;
    // with it the portal is recreated using the install's OWN platform overlays.
    const { args } = buildPromoterCommand({
      ...BASE,
      composeFiles: ["docker-compose.yml", "docker-compose.linux.yml", "docker-compose.edge.yml"],
      composeProject: "dpf",
    });
    expect(args).toContain(
      "PROMOTE_COMPOSE_FILES=docker-compose.yml docker-compose.linux.yml docker-compose.edge.yml",
    );
    expect(args).toContain("PROMOTE_COMPOSE_PROJECT=dpf");
  });

  it("omits PROMOTE_COMPOSE_FILES when no chain is recorded (promote.sh base-only fallback)", () => {
    const joined = buildPromoterCommand(BASE).args.join(" ");
    expect(joined).not.toContain("PROMOTE_COMPOSE_FILES=");
    expect(joined).toContain("PROMOTE_COMPOSE_PROJECT=dpf");
  });
});

describe("promoter launch idempotency (SUR-E2BF265E)", () => {
  // The defect: the promoter container name is deterministic
  // (`dpf-promoter-<runId>`), so a concurrent/retried dispatch of the SAME run
  // issued a second `docker run --name dpf-promoter-SUR-E2BF265E`, hit
  // "The container name is already in use", and the orchestrator recorded a
  // build FAILURE — while the first promoter was still healthily building
  // (past Step 40/119). runPromoter must first inspect the name and defer.

  it("classifies docker inspect .State.Running output into a container state", () => {
    // `docker inspect -f '{{.State.Running}}' <name>` — exit 0 + "true" while a
    // build runs, exit 0 + "false" for an exited corpse `--rm` never cleaned,
    // nonzero when there is no such container.
    expect(interpretContainerInspect(0, "true\n")).toBe("running");
    expect(interpretContainerInspect(0, "false\n")).toBe("present");
    expect(interpretContainerInspect(1, "")).toBe("absent");
  });

  it("defers to an already-running promoter instead of relaunching and colliding", () => {
    expect(decidePromoterLaunch("running")).toBe("defer");
  });

  it("reclaims a dead corpse (--rm never fired) before a fresh launch", () => {
    expect(decidePromoterLaunch("present")).toBe("reclaim");
  });

  it("launches normally when no container by that name exists", () => {
    expect(decidePromoterLaunch("absent")).toBe("launch");
  });

  it("signals a defer with a distinct sentinel exit code, never a real failure or timeout", () => {
    // The orchestrator special-cases this code to leave run state untouched
    // instead of calling failRun — so it must not collide with 0 (success) or
    // the timeout code (a real failure the orchestrator DOES record).
    expect(PROMOTER_ALREADY_RUNNING_EXIT_CODE).not.toBe(0);
    expect(PROMOTER_ALREADY_RUNNING_EXIT_CODE).not.toBe(PROMOTER_TIMEOUT_EXIT_CODE);
  });
});

describe("runtime transition promoter entrypoint", () => {
  it("recognizes the mode and fails closed without protocol secret material", async () => {
    const script = resolve(__dirname, "../../../../scripts/promote.sh");
    const stateDir = await mkdtemp(join(tmpdir(), "dpf-promoter-test-"));
    try {
      vi.stubEnv("DPF_PROMOTER_STATE_DIR", stateDir);
      vi.stubEnv("DPF_RUNTIME_TRANSITION_SECRET_FILE", join(stateDir, "missing-secret"));
      const result = await runProcessWithBudget(testBash, [script, "--runtime-capability-transition", "RCT-123"], { timeoutMs: 10_000 });
      expect(result.exitCode).toBe(78);
      expect(result.stderr).toContain('"failure":"transition_secret_unreadable"');
    } finally {
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});

describe("isJitBuildablePromoterImage", () => {
  it("treats the default local tag (and an empty/omitted image) as buildable", () => {
    expect(isJitBuildablePromoterImage()).toBe(true);
    expect(isJitBuildablePromoterImage("")).toBe(true);
    expect(isJitBuildablePromoterImage("dpf-promoter")).toBe(true);
  });

  it("refuses to synthesise a custom or registry-qualified image", () => {
    // A configured registry image is pull-based deployment the operator owns;
    // building and mis-tagging it locally would masquerade as the real image.
    expect(isJitBuildablePromoterImage("ghcr.io/acme/dpf-promoter:v1")).toBe(false);
    expect(isJitBuildablePromoterImage("dpf-promoter:pinned")).toBe(false);
  });
});

describe("decidePromoterEnsureAction", () => {
  // BI-8843BD48: the promoter bakes promote.sh as its ENTRYPOINT, so a
  // present-but-stale JIT image runs an OLD promote.sh and silently skips newer
  // steps (this is why BI-A8686CFC's sandbox-refresh never fired on installs
  // whose dpf-promoter image predated the fix). A JIT-buildable image must ALWAYS
  // be rebuilt from the portal's freshly-baked layout — even when one is present.
  it("rebuilds a JIT-buildable image even when a (possibly stale) one is present", () => {
    expect(decidePromoterEnsureAction(true, true)).toBe("rebuild");
  });

  it("rebuilds a JIT-buildable image when none is present", () => {
    expect(decidePromoterEnsureAction(false, true)).toBe("rebuild");
  });

  it("uses a present custom/registry image as-is (cannot synthesise someone else's tag)", () => {
    expect(decidePromoterEnsureAction(true, false)).toBe("use-present");
  });

  it("cannot build a missing custom/registry image — left to the operator's pull", () => {
    expect(decidePromoterEnsureAction(false, false)).toBe("cannot-build");
  });
});

describe("PROMOTER_JIT_BUILD_SCRIPT", () => {
  it("builds from the portal's baked-in /promoter/ layout and tags dpf-promoter", () => {
    // The recipe must consume the files the Dockerfile copies to /promoter/ and
    // produce the default local tag isPromoterAvailable() looks for.
    expect(PROMOTER_JIT_BUILD_SCRIPT).toContain("/promoter/Dockerfile");
    expect(PROMOTER_JIT_BUILD_SCRIPT).toContain("/promoter/Dockerfile.promoter");
    expect(PROMOTER_JIT_BUILD_SCRIPT).toContain("/promoter/scripts/promote.sh");
    expect(PROMOTER_JIT_BUILD_SCRIPT).toContain("docker buildx build --load -t dpf-promoter -f Dockerfile.promoter");
  });

  it("is a fixed constant with no interpolation (safe under sh -c)", () => {
    expect(PROMOTER_JIT_BUILD_SCRIPT).not.toContain("${");
    expect(PROMOTER_JIT_BUILD_SCRIPT).not.toContain("`");
  });
});

describe("resolvePromoterTimeoutMs", () => {
  const CLEAN = { ...BASE };
  it("prefers an explicit param, then env, then the 25-min default", () => {
    expect(resolvePromoterTimeoutMs({ ...CLEAN, timeoutMs: 1234 })).toBe(1234);
    const prev = process.env.DPF_PROMOTER_TIMEOUT_MS;
    try {
      process.env.DPF_PROMOTER_TIMEOUT_MS = "600000";
      expect(resolvePromoterTimeoutMs(CLEAN)).toBe(600000);
      delete process.env.DPF_PROMOTER_TIMEOUT_MS;
      expect(resolvePromoterTimeoutMs(CLEAN)).toBe(25 * 60 * 1000);
    } finally {
      if (prev === undefined) delete process.env.DPF_PROMOTER_TIMEOUT_MS;
      else process.env.DPF_PROMOTER_TIMEOUT_MS = prev;
    }
  });

  it("ignores a non-positive or non-numeric budget and falls through", () => {
    expect(resolvePromoterTimeoutMs({ ...CLEAN, timeoutMs: 0 })).toBe(25 * 60 * 1000);
    expect(resolvePromoterTimeoutMs({ ...CLEAN, timeoutMs: -5 })).toBe(25 * 60 * 1000);
  });
});

describe("candidate promoter Docker operation budget", () => {
  it("uses the governed promoter timeout instead of a separate five-minute ceiling", () => {
    const source = readFileSync(resolve(__dirname, "promoter.ts"), "utf8");
    expect(source).not.toContain("timeoutMs: 5 * 60_000");
    expect(source).toContain("resolvePromoterTimeoutMs(params)");
  });
});

describe("runProcessWithBudget (the runPromoter timeout path)", () => {
  it("kills a hung process at the budget and resolves with a promoter-timeout marker", async () => {
    // Stand in for a stalled `docker build` that never closes.
    const started = Date.now();
    const result = await runProcessWithBudget(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], { timeoutMs: 150 });
    expect(Date.now() - started).toBeLessThan(5000); // did NOT wait 30s
    expect(result.exitCode).toBe(PROMOTER_TIMEOUT_EXIT_CODE);
    expect(result.stderr).toContain("[promoter-timeout]");
  });

  it("returns the real exit code + output when the process finishes within budget", async () => {
    const result = await runProcessWithBudget(
      process.execPath,
      ["-e", "console.log('built')"],
      { timeoutMs: 10_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("built");
    expect(result.stderr).not.toContain("[promoter-timeout]");
  });

  it("propagates a nonzero exit unchanged (real build failure, not a timeout)", async () => {
    const result = await runProcessWithBudget(process.execPath, ["-e", "process.exit(3)"], { timeoutMs: 10_000 });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).not.toContain("[promoter-timeout]");
  });
});
