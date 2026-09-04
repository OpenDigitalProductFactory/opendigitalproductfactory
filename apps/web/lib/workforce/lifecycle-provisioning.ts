import type { WorkerClassification } from "@dpf/db";
import type { ProfessionJurisdiction } from "@dpf/db/wiki-taxonomy";

import { checkWorkerAction, type WorkerActionDecision } from "./worker-action-control";

/**
 * Lifecycle steps resolve to connector capabilities (BI-828F8EC9).
 *
 * SCIM (RFC 7643 / 7644) is the one genuinely ubiquitous standard on this path,
 * and it is a PROVISIONING standard rather than an employment one. It shapes the
 * capability namespace below and nothing else.
 *
 * ## Capability, never connector key
 *
 * A step declares what it needs — `directory.user.create` — and the registry
 * resolves which connector serves it. Naming a connector in a step would pin the
 * lifecycle to one vendor and make "we changed identity providers" a rewrite of
 * every step instead of a registry change.
 *
 * ## What this deliberately does not do
 *
 * It does not migrate the thirteen connectors that are not yet on the connector
 * kernel; the design names that as integration-strategy work outside this epic.
 * A capability those connectors would serve therefore resolves as an unresolved
 * gap here — honestly and by name, rather than by failing anonymously at
 * execution time.
 */

/** The provisioning capabilities the employment lifecycle asks for. */
export const LIFECYCLE_CAPABILITIES = [
  "directory.user.create",
  "directory.user.suspend",
  "directory.user.delete",
  "directory.group.assign",
  "directory.group.revoke",
  "licence.seat.assign",
  "licence.seat.revoke",
] as const;
export type LifecycleCapability = (typeof LIFECYCLE_CAPABILITIES)[number];

/** A step in a spawned employment Workroom that touches an external system. */
export type ProvisioningStep = {
  readonly stepKey: string;
  readonly capability: LifecycleCapability;
  /**
   * Revocations are DATE-BOUND: an offboarding step scheduled for a termination
   * date executes on that date, and the room stays accountable until it does.
   */
  readonly executeOn: Date | null;
  readonly executedAt: Date | null;
  /** Revocations are what an instance may not close over. */
  readonly isRevocation: boolean;
};

/** What the connector registry can answer about a capability. */
export type CapabilityResolver = {
  getByCapability(capability: string): { readonly connectorKey: string } | undefined;
};

/** The three honest dispositions for a capability nothing serves. */
export type CapabilityGapDisposition = "absorb" | "generate-on-demand" | "record-as-manual";

export type StepResolution =
  | { readonly kind: "resolved"; readonly connectorKey: string }
  /**
   * Named, actionable gap. It opens an integration decision rather than failing
   * anonymously — an anonymous failure is how a half-provisioned worker happens.
   */
  | {
      readonly kind: "capability-gap";
      readonly capability: LifecycleCapability;
      readonly dispositions: readonly CapabilityGapDisposition[];
      readonly message: string;
    }
  /** The worker's classification or jurisdiction forbids this step. */
  | { readonly kind: "refused"; readonly decision: WorkerActionDecision };

/**
 * Resolve one provisioning step for one worker.
 *
 * The classification gate runs FIRST. Resolving a connector for a step that must
 * not run would do the vendor lookup, the credential fetch and the audit write
 * for an action the organisation is not entitled to take.
 */
export function resolveProvisioningStep(args: {
  readonly step: ProvisioningStep;
  readonly classification: WorkerClassification | null;
  readonly jurisdiction: ProfessionJurisdiction | null;
  readonly registry: CapabilityResolver;
}): StepResolution {
  const decision = checkWorkerAction({
    action: "provision-access",
    classification: args.classification,
    jurisdiction: args.jurisdiction,
  });
  if (!decision.permitted) return { kind: "refused", decision };

  const connector = args.registry.getByCapability(args.step.capability);
  if (!connector) {
    return {
      kind: "capability-gap",
      capability: args.step.capability,
      dispositions: ["absorb", "generate-on-demand", "record-as-manual"],
      message: `No connector on the kernel serves ${args.step.capability}. Decide: absorb a connector that does, generate one on demand, or record this step as manual.`,
    };
  }

  return { kind: "resolved", connectorKey: connector.connectorKey };
}

export type CompletionBlock = {
  readonly stepKey: string;
  readonly capability: LifecycleCapability;
  readonly dueOn: Date | null;
};

/**
 * Whether an instance may reach completion.
 *
 * An offboarding room that closes while access is still live is the single
 * failure this design most needs to prevent, so an outstanding revocation blocks
 * completion outright. A revocation dated in the FUTURE still blocks: the room
 * stays accountable until the revocation has actually executed, not until it has
 * merely been scheduled.
 */
export function outstandingRevocations(steps: readonly ProvisioningStep[]): CompletionBlock[] {
  return steps
    .filter((step) => step.isRevocation && step.executedAt === null)
    .map((step) => ({ stepKey: step.stepKey, capability: step.capability, dueOn: step.executeOn }));
}

export function mayComplete(steps: readonly ProvisioningStep[]): boolean {
  return outstandingRevocations(steps).length === 0;
}

/** Whether a dated step is due to run. A step with no date runs immediately. */
export function isDue(step: ProvisioningStep, now: Date): boolean {
  if (step.executedAt !== null) return false;
  return step.executeOn === null || step.executeOn.getTime() <= now.getTime();
}
