import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  buildPromoterCommand,
  decidePromoterEnsureAction,
  isJitBuildablePromoterImage,
  PROMOTER_JIT_BUILD_SCRIPT,
  PROMOTER_TIMEOUT_EXIT_CODE,
  resolvePromoterTimeoutMs,
  runProcessWithBudget,
} from "./promoter";

const BASE = {
  hostInstallPath: "/Users/me/dpf",
  targetSha: "abc1234",
  backupPath: "/backups/self-upgrade/run-1",
  healthUrl: "http://localhost:3000/api/health",
};

describe("buildPromoterCommand", () => {
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
    const { args } = buildPromoterCommand({ ...BASE, runtimeCapabilityTransitionId: "RCT-123", stateDirHostPath: "/state", runtimeCapabilityEnvelope: "encoded", runtimeCapabilitySignature: "a".repeat(64), runtimeCapabilitySecretFileHostPath: "/state/transition-secret" });
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

  it("gives transition mode only the state mount as writable and signs fixed protocol env", () => {
    const { args } = buildPromoterCommand({ ...BASE, runtimeCapabilityTransitionId: "RCT-123", stateDirHostPath: "/host/.dpf", runtimeCapabilityEnvelope: "encoded", runtimeCapabilitySignature: "a".repeat(64), runtimeCapabilitySecretFileHostPath: "/host/.dpf/transition-secret", composeFiles: ["docker-compose.yml"], composeProject: "dpf" });
    expect(args.join(" ")).not.toContain("x".repeat(32));
    expect(args).toContain("/Users/me/dpf:/host-source:ro");
    expect(args).toContain("/host/.dpf:/dpf-state");
    expect(args).toContain("DPF_STATE_DIR=/dpf-state");
    expect(args).toContain("DPF_RUNTIME_TRANSITION_ENVELOPE=encoded");
    expect(args.filter((arg) => arg.includes(":/host-source") && !arg.endsWith(":ro"))).toEqual([]);
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
    expect(joined).not.toContain("PROMOTE_COMPOSE_PROJECT=");
  });
});

describe("runtime transition promoter entrypoint", () => {
  it("recognizes the mode and fails closed without protocol secret material", async () => {
    const script = resolve(process.cwd(), "../../scripts/promote.sh");
    const result = await runProcessWithBudget("bash", [script, "--runtime-capability-transition", "RCT-123"], { timeoutMs: 10_000 });
    expect(result.exitCode).toBe(78);
    expect(result.stderr).toContain('"failure":"transition_secret_unreadable"');
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
    expect(PROMOTER_JIT_BUILD_SCRIPT).toContain("/promoter/portal.Dockerfile");
    expect(PROMOTER_JIT_BUILD_SCRIPT).toContain("/promoter/Dockerfile.promoter");
    expect(PROMOTER_JIT_BUILD_SCRIPT).toContain("/promoter/promote.sh");
    expect(PROMOTER_JIT_BUILD_SCRIPT).toContain("docker build -t dpf-promoter -f Dockerfile.promoter");
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

describe("runProcessWithBudget (the runPromoter timeout path)", () => {
  it("kills a hung process at the budget and resolves with a promoter-timeout marker", async () => {
    // Stand in for a stalled `docker build` that never closes.
    const started = Date.now();
    const result = await runProcessWithBudget("sh", ["-c", "sleep 30"], { timeoutMs: 150 });
    expect(Date.now() - started).toBeLessThan(5000); // did NOT wait 30s
    expect(result.exitCode).toBe(PROMOTER_TIMEOUT_EXIT_CODE);
    expect(result.stderr).toContain("[promoter-timeout]");
  });

  it("returns the real exit code + output when the process finishes within budget", async () => {
    const result = await runProcessWithBudget(
      "sh",
      ["-c", "echo built; exit 0"],
      { timeoutMs: 10_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("built");
    expect(result.stderr).not.toContain("[promoter-timeout]");
  });

  it("propagates a nonzero exit unchanged (real build failure, not a timeout)", async () => {
    const result = await runProcessWithBudget("sh", ["-c", "exit 3"], { timeoutMs: 10_000 });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).not.toContain("[promoter-timeout]");
  });
});
