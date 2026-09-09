// Mailroom profile resolution (design 2026-09-09 §4.2, BI-E64B3730).
//
// This is the ARCHETYPE layer of the Mailroom: which mailboxes a business of
// this kind runs, why a stranger writes to it, how urgent each reason is, and
// which standing queue owns it. The platform layer (apps/web/lib/mailroom)
// reads the resolved profile and never hard-codes a reason or a purpose.
//
// Every archetype gets the common profile. An archetype's own profile is merged
// OVER it by key, so a rescue adds found-animal and veterinary lanes while
// keeping the supplier-invoice lane every business needs.
//
// The rule this file keeps: it names KINDS of correspondence and never one
// business — no address, person, credential or tuned threshold may appear here.
// Those are instance facts on `MailboxAccount`.

import type {
  ArchetypeDefinition,
  MailroomProfile,
  MailroomReason,
  MailroomUrgencyKey,
} from "./types";

export const MAILROOM_URGENCIES = ["immediate", "hours", "days", "weeks"] as const satisfies readonly MailroomUrgencyKey[];

/** Acknowledgement window per urgency, in minutes (design §4.1). */
export const MAILROOM_ACKNOWLEDGE_WINDOW_MINUTES: Readonly<Record<MailroomUrgencyKey, number>> = {
  immediate: 60,
  hours: 4 * 60,
  days: 2 * 24 * 60,
  weeks: 7 * 24 * 60,
};

/** Reason key every profile carries for mail that is stored and never routed. */
export const MAILROOM_NOISE_REASON_KEY = "noise";

/** The universal profile. Purposes, reasons and queues every business has. */
export const COMMON_MAILROOM_PROFILE: MailroomProfile = {
  expectedMailboxes: [
    {
      purposeKey: "general",
      label: "General enquiries",
      examples: ["info@", "hello@", "contact@"],
      why: "The address on the website and the door. Anyone who does not know who to ask writes here.",
    },
    {
      purposeKey: "billing",
      label: "Billing and suppliers",
      examples: ["accounts@", "billing@"],
      why: "Supplier invoices, statements and payment questions arrive here and feed the books.",
    },
    {
      purposeKey: "support",
      label: "Customer support",
      examples: ["support@", "help@"],
      why: "Existing customers asking for help; the clock on these is a promise already made.",
    },
  ],
  reasons: [
    {
      key: "customer-enquiry",
      label: "Customer enquiry",
      urgency: "days",
      queueKey: "owner-desk",
      hints: ["enquiry", "inquiry", "interested in", "do you offer", "how much", "quote"],
    },
    {
      key: "supplier-invoice",
      label: "Supplier invoice or statement",
      urgency: "days",
      queueKey: "finance",
      hints: ["invoice", "statement", "remittance", "payment due", "amount due", "receipt attached"],
    },
    {
      key: "support-request",
      label: "Support request",
      urgency: "hours",
      queueKey: "support",
      hints: ["not working", "problem with", "issue with", "help with my", "broken", "complaint"],
    },
    {
      key: "job-application",
      label: "Job or volunteer application",
      urgency: "weeks",
      queueKey: "owner-desk",
      hints: ["resume", "cv attached", "apply for", "application for the", "position"],
    },
    {
      key: MAILROOM_NOISE_REASON_KEY,
      label: "Automated or bulk mail",
      urgency: "weeks",
      queueKey: "owner-desk",
      hints: [],
      noise: true,
    },
  ],
  queues: [
    {
      key: "owner-desk",
      label: "Owner's desk",
      responsibleRole: "Business owner",
      roomTitle: "Correspondence for the owner",
    },
    {
      key: "finance",
      label: "Finance",
      responsibleRole: "Bookkeeper",
      roomTitle: "Supplier and billing correspondence",
    },
    {
      key: "support",
      label: "Support",
      responsibleRole: "Support lead",
      roomTitle: "Customer support correspondence",
    },
  ],
  subjectKinds: [],
  defaultReasonKey: "customer-enquiry",
};

/**
 * Merge an archetype's profile over the common one. Entries are keyed
 * (purposeKey / key / kind); an archetype entry with the same key replaces the
 * common entry, and the archetype's `defaultReasonKey` wins when set.
 */
export function mergeMailroomProfile(base: MailroomProfile, overlay: MailroomProfile | undefined | null): MailroomProfile {
  if (!overlay) return base;
  const byKey = <T>(items: T[], key: (item: T) => string, extra: T[]): T[] => {
    const map = new Map(items.map((item) => [key(item), item] as const));
    for (const item of extra) map.set(key(item), item);
    return [...map.values()];
  };
  return {
    expectedMailboxes: byKey(base.expectedMailboxes, (m) => m.purposeKey, overlay.expectedMailboxes),
    reasons: byKey(base.reasons, (r) => r.key, overlay.reasons),
    queues: byKey(base.queues, (q) => q.key, overlay.queues),
    subjectKinds: byKey(base.subjectKinds ?? [], (s) => s.kind, overlay.subjectKinds ?? []),
    defaultReasonKey: overlay.defaultReasonKey || base.defaultReasonKey,
  };
}

/** The profile a business running this archetype gets. Null archetype → common. */
export function resolveMailroomProfile(
  archetype: Pick<ArchetypeDefinition, "mailroomProfile"> | null | undefined,
): MailroomProfile {
  return mergeMailroomProfile(COMMON_MAILROOM_PROFILE, archetype?.mailroomProfile);
}

/** Structural validation — the seed test's control gate. Returns [] when sound. */
export function validateMailroomProfile(profile: MailroomProfile): string[] {
  const errors: string[] = [];
  const queueKeys = new Set(profile.queues.map((q) => q.key));
  const reasonKeys = new Set(profile.reasons.map((r) => r.key));
  const subjectKinds = new Set((profile.subjectKinds ?? []).map((s) => s.kind));
  const purposeKeys = new Set(profile.expectedMailboxes.map((m) => m.purposeKey));

  if (queueKeys.size !== profile.queues.length) errors.push("duplicate queue key");
  if (reasonKeys.size !== profile.reasons.length) errors.push("duplicate reason key");
  if (purposeKeys.size !== profile.expectedMailboxes.length) errors.push("duplicate purpose key");

  for (const reason of profile.reasons) {
    if (!queueKeys.has(reason.queueKey)) errors.push(`reason ${reason.key} names unknown queue ${reason.queueKey}`);
    if (!MAILROOM_URGENCIES.includes(reason.urgency)) errors.push(`reason ${reason.key} has unknown urgency ${reason.urgency}`);
    if (reason.subjectKind && !subjectKinds.has(reason.subjectKind)) {
      errors.push(`reason ${reason.key} names unknown subject kind ${reason.subjectKind}`);
    }
  }
  if (!reasonKeys.has(profile.defaultReasonKey)) errors.push(`default reason ${profile.defaultReasonKey} is not a reason`);
  const noise = profile.reasons.find((r) => r.key === MAILROOM_NOISE_REASON_KEY);
  if (!noise || !noise.noise) errors.push(`profile must carry a noise reason keyed ${MAILROOM_NOISE_REASON_KEY}`);
  for (const kind of profile.subjectKinds ?? []) {
    try {
      new RegExp(kind.referencePattern);
    } catch {
      errors.push(`subject kind ${kind.kind} has an invalid referencePattern`);
    }
  }
  return errors;
}

export function mailroomReasonByKey(profile: MailroomProfile, key: string): MailroomReason | null {
  return profile.reasons.find((r) => r.key === key) ?? null;
}

/** Acknowledge-by time for a reason received at `receivedAt`. */
export function mailroomAcknowledgeBy(urgency: MailroomUrgencyKey, receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + MAILROOM_ACKNOWLEDGE_WINDOW_MINUTES[urgency] * 60_000);
}
