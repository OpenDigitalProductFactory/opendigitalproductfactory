// EP-SOVEREIGN-SOC P3 — governed security response authority unit tests.
import { describe, expect, it, vi } from "vitest";

import {
  decideSecurityResponse,
  resolveResponseSpec,
  securityResponseToDraft,
  type SecurityResponseInput,
} from "./response-authority";

function input(overrides: Partial<SecurityResponseInput>): SecurityResponseInput {
  return {
    actionType: "collect_diagnostics",
    target: "HOST1",
    rationale: "triage",
    evidenceConfidence: 0.9,
    consent: "standing",
    ...overrides,
  };
}

describe("resolveResponseSpec / securityResponseToDraft", () => {
  it("uses catalog defaults and applies overrides", () => {
    expect(resolveResponseSpec(input({ actionType: "isolate_host" })).riskClass).toBe("high");
    expect(resolveResponseSpec(input({ actionType: "block_ip" })).blastRadius).toBe("estate");
    expect(resolveResponseSpec(input({ actionType: "kill_process" })).reversible).toBe(false);
    // override
    expect(resolveResponseSpec(input({ actionType: "isolate_host", reversible: false })).reversible).toBe(false);
    // unknown action → conservative
    expect(resolveResponseSpec(input({ actionType: "frobnicate" })).riskClass).toBe("high");
  });
  it("maps to a RemediationActionDraft carrying the riskClass", () => {
    const d = securityResponseToDraft(input({ actionType: "isolate_host" }));
    expect(d).toMatchObject({ actionType: "isolate_host", riskClass: "high" });
    expect(d.parameters).toMatchObject({ target: "HOST1" });
  });
});

describe("decideSecurityResponse — band gate", () => {
  const throwingExec = vi.fn(async () => {
    throw new Error("kernel must not be consulted when the band already gates");
  });

  it("refuses a destructive action at the band (kernel not consulted)", async () => {
    const v = await decideSecurityResponse(input({ actionType: "wipe_host" }), {
      userId: "u1",
      toolExecutor: throwingExec,
    });
    expect(v.decision).toBe("refuse");
    expect(v.bandDecision).toBe("refuse");
    expect(throwingExec).not.toHaveBeenCalled();
  });

  it("requires human approval for a mutating action at the band (kernel not consulted)", async () => {
    const v = await decideSecurityResponse(input({ actionType: "isolate_host" }), {
      userId: "u1",
      toolExecutor: throwingExec,
    });
    expect(v.decision).toBe("needs-human-approval");
    expect(v.bandDecision).toBe("needs-human-approval");
    expect(throwingExec).not.toHaveBeenCalled();
  });
});

describe("decideSecurityResponse — kernel ratchet on band-auto-approve", () => {
  it("auto-approves a read-only action when the kernel clears it with high confidence", async () => {
    const exec = vi.fn(async () => ({
      success: true,
      data: { recommendation: { optionId: "auto-execute", confidence: "high" } },
    }));
    const v = await decideSecurityResponse(input({ actionType: "collect_diagnostics" }), {
      userId: "u1",
      toolExecutor: exec,
    });
    expect(v.bandDecision).toBe("auto-approve");
    expect(v.decision).toBe("auto-approve");
    expect(v.kernelRatcheted).toBe(false);
    expect(exec).toHaveBeenCalledOnce();
  });

  it("ratchets a band-auto-approve to human when the kernel prefers propose", async () => {
    const exec = vi.fn(async () => ({
      success: true,
      data: { recommendation: { optionId: "propose", confidence: "high" } },
    }));
    const v = await decideSecurityResponse(input({ actionType: "collect_diagnostics" }), {
      userId: "u1",
      toolExecutor: exec,
    });
    expect(v.bandDecision).toBe("auto-approve");
    expect(v.decision).toBe("needs-human-approval");
    expect(v.kernelRatcheted).toBe(true);
  });

  it("fails safe to human approval when the kernel decision is degenerate", async () => {
    const exec = vi.fn(async () => ({ success: false, error: "degenerate" }));
    const v = await decideSecurityResponse(input({ actionType: "collect_diagnostics" }), {
      userId: "u1",
      toolExecutor: exec,
    });
    expect(v.decision).toBe("needs-human-approval");
  });
});
