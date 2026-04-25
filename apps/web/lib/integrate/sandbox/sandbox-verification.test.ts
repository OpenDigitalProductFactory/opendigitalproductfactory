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
