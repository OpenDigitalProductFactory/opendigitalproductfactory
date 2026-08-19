import type { SandboxReadinessSnapshot } from "./sandbox-admin-types";

export type SandboxGateResult =
  | { ok: true }
  | { ok: false; message: string; state: SandboxReadinessSnapshot["state"] };

export function assertSandboxReadyForDeploy(snapshot: SandboxReadinessSnapshot): SandboxGateResult {
  if (snapshot.canDeploy && snapshot.state === "healthy") return { ok: true };
  return {
    ok: false,
    state: snapshot.state,
    message: `Sandbox is not ready for deploy_feature: ${snapshot.summary}`,
  };
}

export function assertSandboxReadyForContribution(snapshot: SandboxReadinessSnapshot): SandboxGateResult {
  if (snapshot.canContribute && snapshot.state === "healthy") return { ok: true };
  return {
    ok: false,
    state: snapshot.state,
    message: `Sandbox is not ready for upstream contribution: ${snapshot.summary}`,
  };
}
