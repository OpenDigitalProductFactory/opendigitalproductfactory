import type { ScopeClaim } from "@/lib/work-capsules";

type ScopeClaimInput = Pick<ScopeClaim, "kind" | "value" | "intent">;

export type CapsuleChangeImpactContract = {
  schemaVersion: number;
  source: string;
  status: "resolved" | "unresolved";
  paths: string[];
  instructions: string[];
  reason?: string;
  unresolvedPaths?: string[];
  gateContext?: Record<string, unknown>;
};

type ImpactActivity = {
  kind: "change-impact-planned";
  summary: string;
  payload: { changeImpactContract: CapsuleChangeImpactContract };
};

export async function planCapsuleChangeImpact(args: {
  scopeClaims: ScopeClaim[];
  incomingClaims: ScopeClaimInput[];
  verificationState: unknown;
  build?: (paths: string[]) => Promise<CapsuleChangeImpactContract>;
}): Promise<{
  contract?: CapsuleChangeImpactContract;
  verificationState?: Record<string, unknown>;
  activity?: ImpactActivity;
}> {
  const editPaths = args.scopeClaims
    .filter((claim) => claim.kind === "path" && claim.intent === "edit")
    .map((claim) => claim.value)
    .sort();
  const refresh =
    args.build &&
    editPaths.length > 0 &&
    args.incomingClaims.some((claim) => claim.kind === "path" && claim.intent === "edit");
  if (!refresh) return {};

  let contract: CapsuleChangeImpactContract;
  try {
    contract = await args.build!(editPaths);
  } catch (error) {
    contract = {
      schemaVersion: 1,
      source: "gate-context",
      status: "unresolved",
      paths: editPaths,
      instructions: [
        "Impact planning failed; use exhaustive verification and resolve affected tests and guards before completion.",
      ],
      reason: error instanceof Error ? error.message : "change-impact generator failed",
    };
  }
  const current =
    args.verificationState &&
    typeof args.verificationState === "object" &&
    !Array.isArray(args.verificationState)
      ? (args.verificationState as Record<string, unknown>)
      : {};
  return {
    contract,
    verificationState: { ...current, changeImpactContract: contract },
    activity: {
      kind: "change-impact-planned",
      summary: contract.status === "resolved"
        ? `Planned tests and guards for ${editPaths.length} edit path(s).`
        : `Change impact is unresolved for ${editPaths.length} edit path(s); exhaustive verification required.`,
      payload: { changeImpactContract: contract },
    },
  };
}
