import { describe, it, expect } from "vitest";
import {
  buildSandboxAppsWebCopyCommand,
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

describe("buildSandboxStageCommand", () => {
  it("stages releasable sandbox changes while excluding caches and generated artifacts", () => {
    const command = buildSandboxStageCommand();

    expect(command).toContain("cd /workspace && git add -A --");
    expect(command).toContain(":!**/node_modules/**");
    expect(command).toContain(":!**/.next/**");
    expect(command).toContain(":!**/*.tsbuildinfo");
    expect(command).toContain(":!pnpm-lock*");
  });
});

describe("buildSandboxListReleasableFilesCommand", () => {
  it("lists staged releasable files without using grep pipelines", () => {
    const command = buildSandboxListReleasableFilesCommand();

    expect(command).toContain("git diff --cached --name-only -- .");
    expect(command).toContain(":(exclude)**/.next/**");
    expect(command).toContain(":(exclude)**/node_modules/**");
    expect(command).not.toContain("grep -v");
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
