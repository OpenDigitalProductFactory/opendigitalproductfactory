import { describe, it, expect } from "vitest";
import {
  buildSandboxAppsWebCopyCommand,
  buildSandboxDevServerStopCommand,
  buildDockerExecSandboxCommand,
  buildSandboxDiffForFilesCommand,
  buildSandboxCreateArgs,
  buildSandboxListReleasableFilesCommand,
  buildSandboxNetworkName,
  buildSandboxNextDevLaunchCommand,
  buildSandboxNextDevReadinessCommand,
  buildSandboxRootScriptsCopyCommand,
  buildSandboxStageCommand,
  buildSandboxWorkspaceCleanupCommand,
  parseSandboxPort,
  parseSandboxChangedFiles,
  prefixSafeWorkspaceCommand,
  SANDBOX_IMAGE,
  SANDBOX_RESOURCE_LIMITS,
  SANDBOX_TIMEOUT_MS,
} from "./sandbox";

describe("SANDBOX_IMAGE", () => {
  it("is dpf-sandbox", () => {
    expect(SANDBOX_IMAGE).toBe("dpf-sandbox");
  });
});

describe("SANDBOX_RESOURCE_LIMITS", () => {
  it("has 2 CPUs", () => {
    expect(SANDBOX_RESOURCE_LIMITS.cpus).toBe(2);
  });

  it("has 4GB memory", () => {
    expect(SANDBOX_RESOURCE_LIMITS.memoryMb).toBe(4096);
  });

  it("has 10GB disk", () => {
    expect(SANDBOX_RESOURCE_LIMITS.diskGb).toBe(10);
  });
});

describe("SANDBOX_TIMEOUT_MS", () => {
  it("is 30 minutes", () => {
    expect(SANDBOX_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe("buildSandboxCreateArgs", () => {
  it("builds docker create args with resource limits", () => {
    const args = buildSandboxCreateArgs("FB-ABC12345", 3001);
    expect(args).toContain("--name");
    expect(args).toContain("dpf-sandbox-FB-ABC12345");
    expect(args).toContain("--cpus=2");
    expect(args).toContain("--memory=4096m");
    expect(args).toContain("-p");
    expect(args).toContain("3001:3000");
    expect(args).toContain("dpf-sandbox");
  });

  it("does not use --network=none (sandbox needs npm access)", () => {
    const args = buildSandboxCreateArgs("FB-X", 3002);
    expect(args).not.toContain("--network=none");
  });

  it("includes --network flag when networkName provided", () => {
    const args = buildSandboxCreateArgs("FB-ABC12345", 3001, {
      networkName: "dpf-sandbox-net-FB-ABC12345",
    });
    expect(args).toContain("--network=dpf-sandbox-net-FB-ABC12345");
  });

  it("includes -e flags for env vars when provided", () => {
    const args = buildSandboxCreateArgs("FB-X", 3002, {
      envVars: {
        DATABASE_URL: "postgresql://dpf:dpf_sandbox@db:5432/dpf",
        NEO4J_URI: "bolt://neo4j:7687",
      },
    });
    expect(args).toContain("-e");
    expect(args).toContain("DATABASE_URL=postgresql://dpf:dpf_sandbox@db:5432/dpf");
    expect(args).toContain("NEO4J_URI=bolt://neo4j:7687");
  });
});

describe("buildSandboxNetworkName", () => {
  it("builds network name from buildId", () => {
    expect(buildSandboxNetworkName("FB-ABC12345")).toBe("dpf-sandbox-net-FB-ABC12345");
  });
});

describe("parseSandboxPort", () => {
  it("extracts port from docker port output", () => {
    expect(parseSandboxPort("0.0.0.0:3001")).toBe(3001);
  });

  it("returns null for empty output", () => {
    expect(parseSandboxPort("")).toBeNull();
  });

  it("returns null for malformed output", () => {
    expect(parseSandboxPort("no-port-here")).toBeNull();
  });
});

describe("prefixSafeWorkspaceCommand", () => {
  it("prepends a safe.directory allowance for the sandbox workspace", () => {
    const command = prefixSafeWorkspaceCommand("cd /workspace && git status -sb");

    expect(command).toContain('git config --global --add safe.directory "/workspace"');
    expect(command).toContain("cd /workspace && git status -sb");
  });
});

describe("buildDockerExecSandboxCommand", () => {
  it("single-quotes the sandbox shell command so substitutions execute inside the sandbox", () => {
    const command = buildDockerExecSandboxCommand(
      "dpf-sandbox-1",
      "branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true) && printf 'branch=%s\\n' \"$branch\"",
    );

    expect(command).toContain("docker exec 'dpf-sandbox-1' sh -c '");
    expect(command).toContain("branch=$(git rev-parse --abbrev-ref HEAD");
    expect(command).toContain("\"$branch\"");
    expect(command).not.toContain('sh -c "');
  });

  it("quotes container names and embedded single quotes without breaking command substitution", () => {
    const command = buildDockerExecSandboxCommand("sandbox'name", "printf 'x' && target=$(pwd)");

    expect(command).toContain("'sandbox'\"'\"'name'");
    expect(command).toContain("target=$(pwd)");
    expect(command).toContain("'\"'\"'");
  });
});

describe("buildSandboxStageCommand", () => {
  it("stages releasable sandbox changes while excluding caches and generated artifacts", () => {
    const command = buildSandboxStageCommand();

    expect(command).toContain("cd /workspace");
    expect(command).toContain(":!**/node_modules/**");
    expect(command).toContain(":!**/.next/**");
    expect(command).toContain(":!apps/web/next-env.d.ts");
    expect(command).toContain(":!**/*.tsbuildinfo");
    expect(command).toContain(":!pnpm-lock*");
    expect(command).toContain(":!packages/db/generated/**");
  });

  it("does not use git add -A which exits 1 when gitignored directories are present in the working tree", () => {
    // git add -A errors (exit code 1) on gitignored untracked paths such as
    // .pnpm-store, node_modules, and packages/db/generated even when those paths
    // are listed in the exclude pathspecs — crashing the Continue to Release action.
    const command = buildSandboxStageCommand();
    expect(command).not.toContain("git add -A");
  });

  it("uses git add -u to stage tracked modifications without touching gitignored untracked paths", () => {
    const command = buildSandboxStageCommand();
    expect(command).toContain("git add -u");
  });

  it("uses git ls-files --others --exclude-standard to discover new non-gitignored source files", () => {
    const command = buildSandboxStageCommand();
    expect(command).toContain("git ls-files");
    expect(command).toContain("--others");
    expect(command).toContain("--exclude-standard");
  });

  it("pipes new-file list through xargs git add to handle any count of new source files", () => {
    const command = buildSandboxStageCommand();
    expect(command).toContain("xargs");
    expect(command).toContain("git add --");
  });
});

describe("buildSandboxListReleasableFilesCommand", () => {
  it("lists staged releasable files without using grep pipelines", () => {
    const command = buildSandboxListReleasableFilesCommand();

    expect(command).toContain("git diff --cached --name-only -- .");
    expect(command).toContain(":(exclude)**/.next/**");
    expect(command).toContain(":(exclude)apps/web/next-env.d.ts");
    expect(command).toContain(":(exclude)**/node_modules/**");
    expect(command).not.toContain("grep -v");
  });

  it("compares the index against baseRef when provided so committed branch work is visible", () => {
    // Without baseRef, `git diff --cached` only shows index-vs-HEAD (i.e. staged
    // but uncommitted). Once the build-phase agent has committed onto the
    // build branch, HEAD already contains those changes and the diff goes
    // empty — even though the branch is N commits ahead of where it forked.
    // Passing the client branch as baseRef makes committed + uncommitted work
    // both appear, which is what the PR #850 gate needs to recognize.
    const command = buildSandboxListReleasableFilesCommand("/workspace", "client/abc-123");

    expect(command).toContain("git diff --cached 'client/abc-123' --name-only -- .");
    expect(command).toContain(":(exclude)**/.next/**");
    expect(command).toContain(":(exclude)apps/web/next-env.d.ts");
  });
});

describe("buildSandboxDiffForFilesCommand", () => {
  it("quotes file paths so shell metacharacters stay safe", () => {
    const command = buildSandboxDiffForFilesCommand([
      "apps/web/components/build/BuildStudio.tsx",
      "apps/web/components/build/O'Malley Panel.tsx",
    ]);

    expect(command).toContain("git diff --cached --");
    expect(command).toContain("'apps/web/components/build/BuildStudio.tsx'");
    expect(command).toContain("'apps/web/components/build/O'\"'\"'Malley Panel.tsx'");
  });

  it("compares against baseRef when provided so the diff body includes committed work", () => {
    const command = buildSandboxDiffForFilesCommand(
      ["apps/web/lib/foo.ts"],
      "/workspace",
      "client/abc-123",
    );

    expect(command).toContain("git diff --cached 'client/abc-123' -- 'apps/web/lib/foo.ts'");
  });
});

describe("sandbox next dev helpers", () => {
  it("checks workspace readiness from the monorepo root instead of apps/web/node_modules", () => {
    const command = buildSandboxNextDevReadinessCommand();

    expect(command).toContain("test -d /workspace/node_modules");
    expect(command).toContain("test -f /workspace/apps/web/package.json");
    expect(command).not.toContain("/workspace/apps/web/node_modules");
  });

  it("launches the sandbox preview server from the workspace root with pnpm filter web", () => {
    const command = buildSandboxNextDevLaunchCommand("dpf-sandbox-1");

    expect(command).toContain("docker exec -d dpf-sandbox-1 sh -c");
    expect(command).toContain("cd /workspace && PORT=3000 pnpm --filter web dev --hostname 0.0.0.0 --port 3000");
    expect(command).not.toContain("cd /workspace/apps/web && PORT=3000 npx next dev");
    expect(command).not.toContain("dev -- --hostname");
  });
});

describe("sandbox workspace initialization helpers", () => {
  it("copies apps/web source without stale node_modules or build output", () => {
    const command = buildSandboxAppsWebCopyCommand("portal-1", "sandbox-1");

    expect(command).toContain("tar --exclude='apps/web/node_modules'");
    expect(command).toContain("--exclude='apps/web/.next'");
    expect(command).toContain("--exclude='apps/web/tsconfig.tsbuildinfo'");
    expect(command).toContain("docker exec portal-1");
    expect(command).toContain("docker exec -i sandbox-1");
  });

  it("cleans any stale app-local dependencies and build artifacts before install", () => {
    const command = buildSandboxWorkspaceCleanupCommand();

    expect(command).toContain("rm -rf /workspace/apps/web/node_modules");
    expect(command).toContain("/workspace/apps/web/.next");
    expect(command).toContain("/workspace/apps/web/tsconfig.tsbuildinfo");
  });

  it("stops the dev server BEFORE deleting .next so turbopack's cache is never yanked mid-run", () => {
    const command = buildSandboxWorkspaceCleanupCommand();

    // The dev-server stop must precede the destructive rm of .next.
    const stopIdx = command.indexOf("pkill");
    const rmIdx = command.indexOf("rm -rf");
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(rmIdx).toBeGreaterThan(stopIdx);
    // Best-effort, never fails the sequence.
    expect(command).toContain("|| true");
  });

  it("builds a best-effort dev-server stop command that frees the turbopack process", () => {
    const command = buildSandboxDevServerStopCommand();

    expect(command).toContain("pkill -f 'next dev'");
    expect(command).toContain("pkill -f next-server");
    expect(command).toContain("sleep 1");
    // Every stanza tolerates "no such process" so a clean sandbox is a no-op.
    expect(command).toContain("|| true");
    // Must not hard-quote in a way that breaks the JSON.stringify exec sites.
    expect(command).not.toContain('"');
  });

  it("copies root scripts so workspace postinstall hooks can run in the sandbox", () => {
    const command = buildSandboxRootScriptsCopyCommand("portal-1", "sandbox-1");

    expect(command).toContain("tar -cf - -C /app scripts");
    expect(command).toContain("docker exec portal-1");
    expect(command).toContain("docker exec -i sandbox-1");
  });
});

describe("parseSandboxChangedFiles", () => {
  it("returns an empty list when no releasable files are present", () => {
    expect(parseSandboxChangedFiles("")).toEqual([]);
    expect(parseSandboxChangedFiles("\n\n")).toEqual([]);
  });

  it("trims and splits file output into a clean list", () => {
    expect(parseSandboxChangedFiles("apps/web/lib/a.ts\n apps/web/lib/b.ts \r\n")).toEqual([
      "apps/web/lib/a.ts",
      "apps/web/lib/b.ts",
    ]);
  });
});
