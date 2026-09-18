// ─── Mailroom profile (design 2026-09-09 §4.2) ──────────────────────────────
//
// The archetype layer names KINDS of correspondence and the queue that owns
// each; it never names a mailbox address, a person, or a credential — those are
// instance facts on `MailboxAccount`. Urgency and status are platform-closed
// sets (Prisma enums); reason, purpose and queue are registry keys validated
// against the resolved profile, the same discipline as work-shape keys.

/** Platform-closed urgency vocabulary; mirrors the `MailroomUrgency` enum. */
export type MailroomUrgencyKey = "immediate" | "hours" | "days" | "weeks";

/** A mailbox a business of this kind typically runs. */
export interface MailroomExpectedMailbox {
  purposeKey: string;
  label: string;
  /** Illustrative local parts, e.g. `adopt@`; shown as suggestions only. */
  examples: string[];
  /** Why this mailbox exists, in the operator's language. */
  why: string;
}

/** Why one message was sent, and where it goes. */
export interface MailroomReason {
  key: string;
  label: string;
  urgency: MailroomUrgencyKey;
  /** The standing queue that owns this reason; must name a `queues[]` entry. */
  queueKey: string;
  /** Lower-cased phrases whose presence in subject or body assigns the reason
   *  without a model call when exactly one reason matches. */
  hints: string[];
  /** The kind of business record this reason concerns, when the profile can
   *  recognise one (e.g. `animal`). Must name a `subjectKinds[]` entry. */
  subjectKind?: string;
  /** When true, a message carrying this reason is stored and never routed or
   *  replied to (bounces, bulk mail, auto-responses). */
  noise?: boolean;
}

/** A standing queue room and the role that answers for it. */
export interface MailroomQueue {
  key: string;
  label: string;
  /** Role vocabulary shared with the archetype's value streams. */
  responsibleRole: string;
  roomTitle: string;
}

/** How to recognise a business subject in message text. */
export interface MailroomSubjectKind {
  kind: string;
  /** Regular-expression source (no flags) matching a reference token in text. */
  referencePattern: string;
  /** Which platform lookup confirms the candidate; the app layer resolves it. */
  lookup: string;
}

export interface MailroomProfile {
  expectedMailboxes: MailroomExpectedMailbox[];
  reasons: MailroomReason[];
  queues: MailroomQueue[];
  subjectKinds?: MailroomSubjectKind[];
  /** Reason assigned when neither rules nor the model can decide. Must name a
   *  `reasons[]` entry. */
  defaultReasonKey: string;
}
