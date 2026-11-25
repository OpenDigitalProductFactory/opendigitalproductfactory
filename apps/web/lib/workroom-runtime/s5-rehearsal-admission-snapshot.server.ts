import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";

const ref = z.string().min(1).max(256).regex(/^\S+$/u);
const instant = z.int().nonnegative();
const exactAttempt = z.strictObject({ workroomId: ref, sessionRef: ref, stageKey: ref, stageAttemptRef: ref });
const controlIdentity = z.strictObject({ issuer: ref, receiverRef: ref, hostRef: ref, resource: ref });
const qualification = z.strictObject({ kind: z.literal("eligible"), id: ref, version: z.int().positive(),
  statusRevision: z.int().positive(), validUntil: instant });
const snapshotShape = z.strictObject({
  ...exactAttempt.shape,
  ...controlIdentity.shape,
  profile: z.literal("synthetic-rehearsal"),
  mode: z.literal("read-only-coordination"),
  originRef: ref,
  subject: z.strictObject({ principalId: ref, gaid: ref.regex(/^gaid:\S+$/u) }),
  authority: z.strictObject({ bindingRef: ref, permitRef: ref,
    grantKeys: z.array(ref).min(1).max(128).refine(keys => new Set(keys).size === keys.length) }),
  qualification,
  expiresAt: instant,
  syntheticTarget: z.strictObject({
    environment: z.literal("non-production"), fixtureRef: ref, databaseRef: ref, caseKey: ref, destinationRef: ref,
    recipient: z.strictObject({ authorityRef: ref, destinationRef: ref, reservationRef: ref }),
  }),
});
const exactEvidence = z.strictObject({ active: z.literal(true), pinned: snapshotShape, current: snapshotShape });

type ExactRehearsalAttempt = z.infer<typeof exactAttempt>;
type RehearsalControlIdentity = z.infer<typeof controlIdentity>;
export type S5RehearsalAdmissionSnapshot = z.infer<typeof snapshotShape>;
type ReadResult = { kind: "observed"; snapshot: S5RehearsalAdmissionSnapshot } | { kind: "held" };

export type S5RehearsalAdmissionReadPorts = {
  /** Independently authenticate the exact registered Control connection. No generic bearer fallback. */
  authenticate: (request: Request) => Promise<RehearsalControlIdentity | null>;
  /** Read-only canonical admission owner boundary, not registered yet. In one
   * consistent read return the original persisted pin plus independently read
   * current facts. `active` must come from the owning attempt, and qualification
   * from current S5 eligibility, never from the pin or request. A missing owner,
   * unverifiable/mixed snapshot or unbound qualification must return null. */
  readEvidence: (receiver: RehearsalControlIdentity, attempt: ExactRehearsalAttempt) => Promise<unknown>;
  now?: () => Date;
};

function matches<T extends object>(expected: T, candidate: T): boolean {
  return Object.entries(expected).every(([key, value]) => candidate[key as keyof T] === value);
}

function separateFreshness(snapshot: S5RehearsalAdmissionSnapshot) {
  const { qualification: { validUntil, ...qualificationRef }, ...binding } = snapshot;
  return { validUntil, pinned: { ...binding, qualification: qualificationRef } };
}

/** Internal, unregistered read-only handler. Its output cannot set Control's
 * independently pinned Store actor/subject, carry a floor, repair a binding,
 * create custody, or authorize a start. This is not a published v1/v1.1 wire. */
export function createS5RehearsalAdmissionReader(ports: S5RehearsalAdmissionReadPorts) {
  const now = ports.now ?? (() => new Date());
  return async (request: Request, lookup: unknown): Promise<ReadResult> => {
    try {
      const attempt = exactAttempt.safeParse(lookup);
      if (!attempt.success) return { kind: "held" };
      const receiver = controlIdentity.safeParse(await ports.authenticate(request));
      if (!receiver.success) return { kind: "held" };
      const evidence = exactEvidence.safeParse(await ports.readEvidence(receiver.data, attempt.data));
      if (!evidence.success) return { kind: "held" };
      const { pinned, current } = evidence.data;
      if (!matches(attempt.data, pinned) || !matches(receiver.data, pinned)) return { kind: "held" };
      const original = separateFreshness(pinned);
      const live = separateFreshness(current);
      if (canonicalJson(original.pinned) !== canonicalJson(live.pinned)) return { kind: "held" };
      const validUntil = Math.min(original.validUntil, live.validUntil);
      const time = now().getTime();
      if (!Number.isSafeInteger(time) || time < 0 || !(time < Math.min(pinned.expiresAt, validUntil))) return { kind: "held" };
      return { kind: "observed", snapshot: { ...pinned, qualification: { ...pinned.qualification, validUntil } } };
    } catch {
      return { kind: "held" };
    }
  };
}
