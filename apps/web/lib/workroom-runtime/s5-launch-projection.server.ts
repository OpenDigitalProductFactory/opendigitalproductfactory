import { S5_LAUNCH_WIRE_VERSION, s5LaunchProjectionSchema, type S5LaunchProjection } from "@dpf/validators/workroom/s5-launch";
import type { S5AdmissionCeiling } from "./s5-admission.server";

type CoordinationLaunch = Extract<S5LaunchProjection, { mode: "read-only-coordination" }>;
type CoordinationTarget = { caseKey: string; recipient: CoordinationLaunch["coordination"]["recipient"] };

/** Facts from the independently authenticated, qualified route owner. The
 * verified branch is not inferred from capabilities claimed by a provider,
 * defaults, the launch projection, or observed post-send usage. */
export type S5LaunchRouteFacts = Readonly<{
  issuer: string;
  audience: string;
  hostRef: string;
  expiresAt: number;
  operationKeys: readonly string[];
  budget: S5LaunchProjection["budget"];
  /** Verification for this exact route/model must cover pre-send tokens and
   * enforcement of input, output and reasoning limits. */
  metering: { kind: "verified"; proofRef: string; expiresAt: number } | { kind: "unverified" };
}>;

/** Serialize the admitted ceiling after trusted owner reads. This grants no
 * dispatch or credential custody. Exact call preflight still happens at the
 * provider relay before send. A missing route proof produces no projection. */
export function projectS5Launch(input: {
  admission: S5AdmissionCeiling;
  route: S5LaunchRouteFacts;
  issuedAt: number;
  permitExpiresAt: number;
  /** Current owner-verified synthetic case and recipient refs, not the call args. */
  coordinationTarget?: CoordinationTarget;
}): S5LaunchProjection | null {
  const { admission, route, issuedAt, permitExpiresAt, coordinationTarget } = input;
  if (route.issuer !== admission.issuer || route.audience !== admission.host.receiverRef || route.hostRef !== admission.host.hostRef
    || route.metering.kind !== "verified" || !route.metering.proofRef || route.metering.proofRef.trim() !== route.metering.proofRef) return null;
  const dates = [issuedAt, permitExpiresAt, route.expiresAt, route.metering.expiresAt];
  if (admission.jsi.kind === "eligible") dates.push(admission.jsi.validUntil);
  if (!dates.every(date => Number.isSafeInteger(date) && date >= 0)) return null;
  const expiresAt = Math.min(...dates.slice(1));
  const supported = new Set(route.operationKeys);
  const permittedOperations = admission.operationKeys.filter(name => supported.has(name));
  const common = { schemaVersion: S5_LAUNCH_WIRE_VERSION, kind: "launch", issuer: admission.issuer,
    audience: admission.host.receiverRef, hostRef: admission.host.hostRef, ...admission.locator, stageKey: admission.stageKey,
    caseKey: admission.caseKey, subject: admission.subject, issuedAt, expiresAt, permittedOperations,
    authority: { bindingRef: admission.bindingRef, permitRef: admission.permitRef, grantKeys: [...admission.grantKeys] }, budget: route.budget };

  const decision = admission.jsi;
  if (decision.kind === "eligible") {
    const selector = decision.selector;
    if (selector.subject.principalId !== admission.subject.principalId || selector.subject.gaid !== admission.subject.gaid
      || selector.job.id !== admission.job.id || selector.job.version !== admission.job.version
      || selector.activityKey !== admission.activityKey || selector.installationId !== admission.issuer) return null;
  }
  const mode = admission.host.mode;
  const jsi = decision.kind === "eligible"
    ? { kind: decision.kind, qualification: decision.qualification, validUntil: decision.validUntil,
        selector: withoutSubject(decision.selector) }
    : { kind: decision.kind, activityKey: admission.activityKey };
  if (mode === "read-only-coordination" && (decision.kind !== "eligible" || admission.host.worktreeRef !== null
    || !coordinationTarget || coordinationTarget.caseKey !== admission.caseKey || decision.selector.scope.dataClass !== "synthetic")) return null;
  if (mode !== "read-only-coordination" && (mode !== "bounded-coding" || coordinationTarget !== undefined)) return null;

  const parsed = s5LaunchProjectionSchema.safeParse(mode === "read-only-coordination"
    ? { ...common, mode, jsi, coordination: { recipient: coordinationTarget?.recipient, postEffects: "proposal-only-no-wake" } }
    : { ...common, mode, jsi, worktreeRef: admission.host.worktreeRef });
  return parsed.success ? parsed.data : null;
}

function withoutSubject<T extends { subject: unknown }>({ subject: _subject, ...selector }: T): Omit<T, "subject"> {
  return selector;
}
