import { describe, expect, it } from "vitest";
import {
  runSandboxTypecheckBuildGate,
  formatGateFailureForContext,
  truncateOutput,
  SANDBOX_TYPECHECK_COMMAND,
  SANDBOX_BUILD_COMMAND,
} from "./sandbox-verification";

type ExecStub = (containerId: string, command: string) => Promise<string>;

function stubSuccess(output: string): ExecStub {
  return async () => output;
}

function stubFailure(stdout: string, code = 1): ExecStub {
  return async () => {
    throw Object.assign(new Error("exec failed"), { stdout, stderr: "", code });
  };
}

function stubByCommand(map: Record<string, () => Promise<string>>): ExecStub {
  return async (_c, command) => {
    const key = Object.keys(map).find((k) => command.includes(k));
    if (!key) throw new Error(`No stub for command: ${command}`);
    return map[key]!();
  };
}

describe("SANDBOX_BUILD_COMMAND", () => {
  // Sandbox container exposes NODE_ENV=development; the production build gate
  // must override it so Next.js does not run the dev React runtime during the
  // prerender pass. See BI-6A1CE023.
  it("forces NODE_ENV=production for the Next production build", () => {
    expect(SANDBOX_BUILD_COMMAND).toContain("NODE_ENV=production");
    expect(SANDBOX_BUILD_COMMAND).toMatch(
      /NODE_ENV=production\s+NODE_OPTIONS=--max-old-space-size=8192\s+pnpm --filter web build/,
    );
  });

  it("does not leak NODE_ENV into the typecheck command", () => {
    expect(SANDBOX_TYPECHECK_COMMAND).not.toContain("NODE_ENV");
  });

  it("gives TypeScript and Next enough heap for the current portal graph", () => {
    expect(SANDBOX_TYPECHECK_COMMAND).toContain(
      "NODE_OPTIONS=--max-old-space-size=8192",
    );
    expect(SANDBOX_BUILD_COMMAND).toContain(
      "NODE_OPTIONS=--max-old-space-size=8192",
    );
  });

  it("captures the production NODE_ENV in the command issued to the sandbox exec", async () => {
    const observed: string[] = [];
    const exec: ExecStub = async (_c, command) => {
      observed.push(command);
      return "ok";
    };
    await runSandboxTypecheckBuildGate("container-1", exec);
    const buildCommand = observed.find((c) => c.includes("pnpm --filter web build"));
    expect(buildCommand).toBeDefined();
    expect(buildCommand).toContain("NODE_ENV=production");
  });
});

describe("runSandboxTypecheckBuildGate", () => {
  it("returns allPassed when both commands succeed", async () => {
    const exec = stubSuccess("typecheck ok\n");
    const gate = await runSandboxTypecheckBuildGate("container-1", exec);

    expect(gate.allPassed).toBe(true);
    expect(gate.typecheck.passed).toBe(true);
    expect(gate.build.passed).toBe(true);
    expect(gate.typecheck.command).toBe(SANDBOX_TYPECHECK_COMMAND);
    expect(gate.build.command).toBe(SANDBOX_BUILD_COMMAND);
  });

  it("short-circuits build when typecheck fails", async () => {
    const exec: ExecStub = async (_c, command) => {
      if (command.includes("typecheck")) {
        throw Object.assign(new Error("tsc failed"), {
          stdout: "error TS2322: Type 'string' is not assignable to type 'number'.",
          stderr: "",
          code: 1,
        });
      }
      throw new Error("build should not run when typecheck failed");
    };

    const gate = await runSandboxTypecheckBuildGate("container-1", exec);

    expect(gate.allPassed).toBe(false);
    expect(gate.typecheck.passed).toBe(false);
    expect(gate.typecheck.exitCode).toBe(1);
    expect(gate.typecheck.stdoutTail).toContain("TS2322");
    expect(gate.build.passed).toBe(false);
    expect(gate.build.skipped).toBe(true);
    expect(gate.build.stdoutTail).toContain("Build skipped");
  });

  it("fails when typecheck passes but build fails", async () => {
    const exec = stubByCommand({
      typecheck: async () => "types ok",
      build: async () => {
        throw Object.assign(new Error("build failed"), {
          stdout: "Module not found: '@/missing'",
          stderr: "",
          code: 1,
        });
      },
    });

    const gate = await runSandboxTypecheckBuildGate("container-1", exec);

    expect(gate.allPassed).toBe(false);
    expect(gate.typecheck.passed).toBe(true);
    expect(gate.build.passed).toBe(false);
    expect(gate.build.skipped).toBeUndefined();
    expect(gate.build.stdoutTail).toContain("Module not found");
  });

  it("leaves exitCode null when the thrown error carries no numeric code", async () => {
    const execNoCode: ExecStub = async () => {
      throw Object.assign(new Error("process killed by signal"), {
        stdout: "",
        stderr: "signal SIGKILL",
      });
    };
    const gate = await runSandboxTypecheckBuildGate("container-1", execNoCode);

    expect(gate.typecheck.passed).toBe(false);
    expect(gate.typecheck.exitCode).toBeNull();
  });

  it("sets ranAt to an ISO timestamp", async () => {
    const gate = await runSandboxTypecheckBuildGate("container-1", stubSuccess("ok"));
    expect(() => new Date(gate.ranAt).toISOString()).not.toThrow();
    expect(new Date(gate.ranAt).toISOString()).toBe(gate.ranAt);
  });
});

describe("truncateOutput", () => {
  it("returns input unchanged when under the limit", () => {
    const raw = "line 1\nline 2";
    expect(truncateOutput(raw)).toBe(raw);
  });

  it("extracts error lines when output exceeds the limit", () => {
    const noise = "progress: ".repeat(5000);
    const errors = "error TS2322: A\nerror TS2345: B";
    const raw = `${noise}\n${errors}\n${noise}`;
    const truncated = truncateOutput(raw);

    expect(truncated).toContain("TS2322");
    expect(truncated).toContain("TS2345");
    expect(truncated).toContain("showing 2 error lines");
  });

  it("falls back to tail truncation when no error lines exist", () => {
    const raw = "noise ".repeat(5000) + "final progress line";
    const truncated = truncateOutput(raw);

    expect(truncated).toContain("output truncated");
    expect(truncated).toContain("final progress line");
  });
});

describe("formatGateFailureForContext", () => {
  it("formats typecheck failures", async () => {
    const exec = stubFailure("error TS2322: blah", 2);
    const gate = await runSandboxTypecheckBuildGate("container-1", exec);
    const msg = formatGateFailureForContext(gate);

    expect(msg).toContain("TYPECHECK FAILED");
    expect(msg).toContain("exit 2");
    expect(msg).toContain("TS2322");
  });

  it("formats build failures and omits the skipped-build section", async () => {
    const exec = stubByCommand({
      typecheck: async () => "ok",
      build: async () => {
        throw Object.assign(new Error("build failed"), {
          stdout: "Cannot resolve '@/foo'",
          code: 1,
        });
      },
    });
    const gate = await runSandboxTypecheckBuildGate("container-1", exec);
    const msg = formatGateFailureForContext(gate);

    expect(msg).not.toContain("TYPECHECK FAILED");
    expect(msg).toContain("BUILD FAILED");
    expect(msg).toContain("Cannot resolve");
  });

  it("omits build output when build was skipped due to typecheck failure", async () => {
    const exec = stubFailure("error TS1005: foo");
    const gate = await runSandboxTypecheckBuildGate("container-1", exec);
    const msg = formatGateFailureForContext(gate);

    expect(msg).toContain("TYPECHECK FAILED");
    expect(msg).not.toContain("BUILD FAILED");
  });
});
