import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GATE_CLIENT_FLOORS,
  evaluateGateClientRevision,
  inferGateClientPlatform,
} from "./gate-client-revision";

const WINDOWS_WORKTREE = "D:\\DPF-source-root-worktrees\\some-branch";
const POSIX_WORKTREE = "/home/dev/dpf-worktrees/some-branch";
const GATE_PURPOSE = "Pre-PR local-CI gate for fix/x @ abc123";

describe("gate client revision floor", () => {
  it("refuses a Windows claim from a client that predates the hidden-console fix", () => {
    const refusal = evaluateGateClientRevision({ clientRevision: undefined, worktreePath: WINDOWS_WORKTREE, purpose: GATE_PURPOSE });
    expect(refusal).toMatchObject({ minimumRevision: 1, clientRevision: 0, platform: "win32" });
    expect(refusal?.reason).toMatch(/terminal window/);
  });

  it("admits a Windows claim from a client at or above the floor", () => {
    expect(evaluateGateClientRevision({ clientRevision: 1, worktreePath: WINDOWS_WORKTREE, purpose: GATE_PURPOSE })).toBeNull();
    expect(evaluateGateClientRevision({ clientRevision: 2, worktreePath: WINDOWS_WORKTREE, purpose: GATE_PURPOSE })).toBeNull();
  });

  // The defect only harms Windows hosts; an unaffected host must never be
  // forced to rebase for it.
  it("never refuses a POSIX host for a Windows-only floor", () => {
    expect(evaluateGateClientRevision({ clientRevision: undefined, worktreePath: POSIX_WORKTREE, purpose: GATE_PURPOSE })).toBeNull();
  });

  it("admits a claim whose platform cannot be placed", () => {
    expect(evaluateGateClientRevision({ clientRevision: undefined, worktreePath: undefined, purpose: GATE_PURPOSE })).toBeNull();
    expect(evaluateGateClientRevision({ clientRevision: undefined, worktreePath: "relative/path", purpose: GATE_PURPOSE })).toBeNull();
  });

  it("treats a malformed revision as a client that reported none", () => {
    const refusal = evaluateGateClientRevision({ clientRevision: "1", worktreePath: WINDOWS_WORKTREE, purpose: GATE_PURPOSE });
    expect(refusal?.clientRevision).toBe(0);
  });

  it("reports the highest floor a client misses", () => {
    const refusal = evaluateGateClientRevision({
      clientRevision: 1,
      worktreePath: WINDOWS_WORKTREE,
      purpose: GATE_PURPOSE,
      floors: [
        { minimumRevision: 1, platforms: ["win32"], reason: "one" },
        { minimumRevision: 3, platforms: ["win32", "posix"], reason: "three" },
      ],
    });
    expect(refusal).toMatchObject({ minimumRevision: 3, reason: "three" });
  });

  // The pre-push infrastructure probe and the dev-portal lease also claim
  // local-integration-ci but have none of the gate client's defects.
  it("leaves non-gate local-integration-ci claims alone", () => {
    expect(evaluateGateClientRevision({
      clientRevision: undefined,
      worktreePath: WINDOWS_WORKTREE,
      purpose: "pre-push gate-infrastructure-unavailable probe for fix/x @ abc123",
    })).toBeNull();
    expect(evaluateGateClientRevision({
      clientRevision: undefined,
      worktreePath: WINDOWS_WORKTREE,
      purpose: "Contributor preview (:3001) bound to D:\\wt @ fix/x",
    })).toBeNull();
  });

  it("recognises drive-letter, forward-slash and UNC Windows paths", () => {
    expect(inferGateClientPlatform("C:/src/dpf")).toBe("win32");
    expect(inferGateClientPlatform("\\\\host\\share\\dpf")).toBe("win32");
    expect(inferGateClientPlatform("/Users/dev/dpf")).toBe("posix");
  });

  // The floor is useless if the client on main is below it: every fresh branch
  // would be refused. Keep the client constant and the floors in step.
  it("the client revision on main satisfies every floor", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "..", "scripts", "lib", "gate-client-revision.mjs"),
      "utf8",
    );
    const match = source.match(/export const GATE_CLIENT_REVISION = (\d+);/);
    expect(match).not.toBeNull();
    const clientRevision = Number(match?.[1]);
    for (const floor of GATE_CLIENT_FLOORS) {
      expect(clientRevision).toBeGreaterThanOrEqual(floor.minimumRevision);
    }
  });
});
