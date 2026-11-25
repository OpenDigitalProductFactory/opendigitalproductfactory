import { isWorkroomToolAccess, type McpToolAccess } from "@/lib/mcp/workroom-tool-access";
import { canonicalWorkroomToolName } from "@/lib/shared/workroom-tool-aliases";
import {
  resolveAuthorityBindingEligibility,
  resolveS5JsiEligibility,
  type CoordinationBindingRow,
  type JsiAdmissionContext,
  type JsiEligibilityDecision,
  type JsiQualificationSources,
} from "@/lib/work-management/coordinator-eligibility";

export type S5AttemptLocator = Readonly<{ workroomId: string; sessionRef: string; stageAttemptRef: string }>;
type S5Subject = NonNullable<JsiAdmissionContext["subject"]>;
type S5Qualification = Extract<JsiEligibilityDecision, { kind: "eligible" }>["qualification"];
type S5Jsi = Extract<JsiEligibilityDecision, { kind: "eligible" | "not-applicable" }>;

type S5Authority = CoordinationBindingRow & Readonly<{
  authorityBindingId: string;
  bindingRef: string;
  principalId: string;
  permitRef: string;
  grantKeys: readonly string[];
  operationKeys: readonly string[];
}>;

type S5Host = Readonly<{
  hostRef: string;
  receiverRef: string;
  worktreeRef: string | null;
  mode: "bounded-coding" | "read-only-coordination";
  operationKeys: readonly string[];
}>;

/** Facts read from a persisted assignment and its current, independently owned policies. */
export type S5AssignmentSnapshot = S5AttemptLocator & {
  stageKey: string;
  caseKey: string;
  shapeRef: string;
  admittedPrincipalId: string;
  agentId: string;
  activity: Omit<JsiAdmissionContext, "subject" | "operationKey">;
  authority: S5Authority | null;
  host: S5Host | null;
  jobOperationKeys: readonly string[];
  stageOperationKeys: readonly string[];
  /** Current independent coworker, human, tenant and token authorization intersection. */
  liveOperationKeys: readonly string[];
};

export type S5AdmissionPorts = {
  // These are server-composed ports. The invoking transport must never hydrate
  // them, or their returned facts, from a request or the launch projection.
  readCurrentAssignment: (locator: S5AttemptLocator) => Promise<S5AssignmentSnapshot | null>;
  readAdmittedSubject?: (assignment: S5AssignmentSnapshot) => Promise<S5Subject | null>;
  qualificationSources?: JsiQualificationSources;
  getRegistryAccess: (canonicalName: string) => McpToolAccess | undefined;
  /** Verify the exact assignment, active binding/permit, subject and host/floor
   * from their owners, including the qualification revision if applicable. An
   * unavailable owner means hold. This does not reserve an effect. */
  confirmCurrent: (proof: { locator: S5AttemptLocator; snapshot: S5AssignmentSnapshot; subject: S5Subject; qualification: S5Qualification | null }) => Promise<boolean>;
  now?: () => Date;
};

type HoldReason = "assignment-unavailable" | "binding-unavailable" | "host-unavailable" | "subject-unavailable"
  | "qualification-unavailable" | "empty-surface" | "admission-changed" | "source-unavailable";

export type S5AdmissionCeiling = Readonly<{
  kind: "composed";
  locator: S5AttemptLocator;
  stageKey: string;
  caseKey: string;
  issuer: string;
  agentId: string;
  activityKey: string;
  job: JsiAdmissionContext["job"];
  subject: S5Subject;
  authorityBindingId: string;
  bindingRef: string;
  permitRef: string;
  grantKeys: readonly string[];
  host: Omit<S5Host, "operationKeys">;
  jsi: S5Jsi;
  operationKeys: readonly string[];
}>;

type S5AdmissionResult = S5AdmissionCeiling | { kind: "held"; reason: HoldReason };
const held = (reason: HoldReason): S5AdmissionResult => ({ kind: "held", reason });
const key = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const validKeys = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length <= 128
  && value.every(key) && new Set(value).size === value.length;
const COORDINATION_ACTIVITY = "s5-route-handoff";
export const isS5CoordinationActivity = (name: string): boolean => name === COORDINATION_ACTIVITY;
// This runtime ceiling is narrower than the generic room-operation class.
const proposalOnlyOperations: ReadonlySet<string> = new Set(["get_workroom", "read_room_messages", "post_room_message"]);
export const isS5CoordinationOperation = (name: string): boolean => proposalOnlyOperations.has(name);

/** Compose a ceiling, never an effect permit. The credential and broker must
 * repeat the exact live checks at their own durable authorization boundary. */
export function createS5AdmissionComposer(ports: S5AdmissionPorts) {
  return async (locator: S5AttemptLocator, forwardingLimit?: readonly string[]): Promise<S5AdmissionResult> => {
    try {
      if (![locator.workroomId, locator.sessionRef, locator.stageAttemptRef].every(key)) return held("assignment-unavailable");
      const snapshot = await ports.readCurrentAssignment(locator);
      if (!snapshot || snapshot.workroomId !== locator.workroomId || snapshot.sessionRef !== locator.sessionRef
        || snapshot.stageAttemptRef !== locator.stageAttemptRef
        || ![snapshot.stageKey, snapshot.caseKey, snapshot.shapeRef, snapshot.admittedPrincipalId, snapshot.agentId].every(key)) {
        return held("assignment-unavailable");
      }
      const { authority, host } = snapshot;
      if (!authority || authority.principalId !== snapshot.admittedPrincipalId || ![authority.authorityBindingId, authority.bindingRef, authority.permitRef].every(key)
        || !validKeys(authority.grantKeys) || !authority.grantKeys.length
        || resolveAuthorityBindingEligibility(snapshot.shapeRef, [authority]) !== "eligible") return held("binding-unavailable");
      if (!host || ![host.hostRef, host.receiverRef].every(key)) return held("host-unavailable");
      const coordination = host.mode === "read-only-coordination";
      if (coordination ? host.worktreeRef !== null || snapshot.activity.activityKey !== COORDINATION_ACTIVITY
        : host.mode !== "bounded-coding" || !key(host.worktreeRef) || snapshot.activity.activityKey === COORDINATION_ACTIVITY) {
        return held("host-unavailable");
      }

      const subject = await ports.readAdmittedSubject?.(snapshot);
      if (!subject || subject.principalId !== snapshot.admittedPrincipalId || typeof subject.gaid !== "string" || !/^gaid:[^\s]+$/u.test(subject.gaid)) {
        return held("subject-unavailable");
      }
      if (!ports.qualificationSources) return held("qualification-unavailable");
      const jsi = await resolveS5JsiEligibility({ ...snapshot.activity, subject }, ports.qualificationSources, ports.now?.());
      if (jsi.kind !== "eligible" && (jsi.kind !== "not-applicable" || coordination)) return held("qualification-unavailable");

      const restrictions = [snapshot.stageOperationKeys, authority.operationKeys, snapshot.liveOperationKeys, host.operationKeys];
      if (jsi.kind === "eligible") restrictions.push(jsi.ceiling.operationKeys);
      if (forwardingLimit !== undefined) restrictions.push(forwardingLimit);
      if (!validKeys(snapshot.jobOperationKeys) || !restrictions.every(validKeys)) return held("empty-surface");
      const intersection = restrictions.map((names) => new Set(names));
      const excluded = new Set(jsi.kind === "eligible" ? jsi.ceiling.excludedOperationKeys : []);
      const operationKeys = snapshot.jobOperationKeys.filter((name) => {
        if (canonicalWorkroomToolName(name) !== name || excluded.has(name) || !intersection.every((set) => set.has(name))) return false;
        const access = ports.getRegistryAccess(name);
        return isWorkroomToolAccess(access) && access !== "outside-workroom"
          && (!coordination || (access === "room-operation" && isS5CoordinationOperation(name)));
      }).sort();
      if (!operationKeys.length) return held("empty-surface");

      const qualification = jsi.kind === "eligible" ? jsi.qualification : null;
      if (await ports.confirmCurrent({ locator, snapshot, subject, qualification }) !== true) return held("admission-changed");
      const checkedAt = (ports.now?.() ?? new Date()).getTime();
      if (!Number.isFinite(checkedAt) || (jsi.kind === "eligible" && checkedAt >= jsi.validUntil)) return held("admission-changed");
      return {
        kind: "composed", locator, stageKey: snapshot.stageKey, caseKey: snapshot.caseKey, subject,
        issuer: snapshot.activity.installationId, agentId: snapshot.agentId, activityKey: snapshot.activity.activityKey, job: snapshot.activity.job,
        authorityBindingId: authority.authorityBindingId,
        bindingRef: authority.bindingRef, permitRef: authority.permitRef, grantKeys: [...authority.grantKeys],
        host: { hostRef: host.hostRef, receiverRef: host.receiverRef, worktreeRef: host.worktreeRef, mode: host.mode },
        jsi, operationKeys,
      };
    } catch {
      return held("source-unavailable");
    }
  };
}
