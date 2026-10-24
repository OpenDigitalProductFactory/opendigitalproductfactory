// Mailroom triage (design 2026-09-09 §4.5, BI-9BD223B1).
//
// Two stages, one pure function. Rules first: auto-submitted, list and bulk
// mail, bounces and no-reply senders are NOISE before any model is consulted,
// and a single unambiguous hint hit assigns the reason with no model call.
// Model second: what remains goes to the classifier PORT with the profile's
// reason keys as the only allowed answers; an answer outside the profile is a
// parse failure, not a new reason, and falls back to the profile default with
// the item flagged.
//
// Inbound text is untrusted (Work Rooms design §14). Nothing here executes; the
// output is data the dispatcher reads.

import type { MailroomProfile, MailroomReason, MailroomUrgencyKey } from "@dpf/storefront-templates";
import { MAILROOM_NOISE_REASON_KEY, mailroomReasonByKey } from "@dpf/storefront-templates";

import type { NormalizedInboundMail } from "./providers/types";

export type TriageSource = "rule-noise" | "rule-hint" | "model" | "fallback";

export type TriageResult = {
  reasonKey: string;
  urgency: MailroomUrgencyKey;
  queueKey: string;
  noise: boolean;
  summary: string;
  subjectRef: string | null;
  source: TriageSource;
  /** True when the reason was guessed (classifier failed or answered off-profile). */
  flagged: boolean;
};

/** What the model is asked for. Keys outside `allowedReasonKeys` are rejected. */
export type ClassifierRequest = {
  subject: string;
  body: string;
  allowedReasons: Array<{ key: string; label: string }>;
  subjectKindHint: string | null;
};

export type ClassifierAnswer = {
  reasonKey: string;
  summary: string;
  subjectRef: string | null;
};

export type ClassifierPort = (request: ClassifierRequest) => Promise<ClassifierAnswer | null>;

/** Confirms a candidate subject reference against the platform (e.g. the animal roster). */
export type SubjectLookupPort = (kind: string, candidate: string, mail: NormalizedInboundMail) => Promise<string | null>;

const NOISE_SENDER_PATTERNS = [/^no-?reply@/i, /^postmaster@/i, /^mailer-daemon@/i, /^bounces?[+@-]/i, /^donotreply@/i];
const BODY_LIMIT = 4000;

/** Pure: is this message automated or bulk? RFC 3834 / RFC 2369 / Precedence. */
export function isNoiseMail(mail: NormalizedInboundMail): boolean {
  const auto = mail.headers["auto-submitted"]?.trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (mail.headers["list-id"] || mail.headers["list-unsubscribe"]) return true;
  const precedence = mail.headers.precedence?.trim().toLowerCase();
  if (precedence && ["bulk", "list", "junk"].includes(precedence)) return true;
  if (mail.headers["x-auto-response-suppress"]) return true;
  const contentType = mail.headers["content-type"]?.toLowerCase() ?? "";
  if (contentType.includes("multipart/report") || contentType.includes("delivery-status")) return true;
  const from = mail.from?.address ?? "";
  return NOISE_SENDER_PATTERNS.some((re) => re.test(from));
}

function textOf(mail: NormalizedInboundMail): string {
  return `${mail.subject ?? ""}\n${mail.textBody}`.toLowerCase();
}

/** Pure: the single reason whose hints match, or null when zero or several do. */
export function matchReasonByHints(profile: MailroomProfile, mail: NormalizedInboundMail): MailroomReason | null {
  const text = textOf(mail);
  const hits = profile.reasons.filter((r) => !r.noise && r.hints.some((hint) => hint && text.includes(hint.toLowerCase())));
  return hits.length === 1 ? hits[0] : null;
}

/** Pure: first reference token the subject kind's pattern finds, or null. */
export function extractSubjectCandidate(profile: MailroomProfile, kind: string, mail: NormalizedInboundMail): string | null {
  const def = (profile.subjectKinds ?? []).find((s) => s.kind === kind);
  if (!def) return null;
  const match = new RegExp(def.referencePattern, "i").exec(`${mail.subject ?? ""}\n${mail.textBody}`);
  return match ? match[0] : null;
}

function summarize(mail: NormalizedInboundMail): string {
  const subject = mail.subject?.trim();
  if (subject) return subject.slice(0, 160);
  const line = mail.textBody.trim().split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return line.slice(0, 160) || "(no subject)";
}

function fromReason(reason: MailroomReason, summary: string, subjectRef: string | null, source: TriageSource, flagged: boolean): TriageResult {
  return {
    reasonKey: reason.key,
    urgency: reason.urgency,
    queueKey: reason.queueKey,
    noise: Boolean(reason.noise),
    summary,
    subjectRef,
    source,
    flagged,
  };
}

export async function triageInboundMail(input: {
  profile: MailroomProfile;
  mail: NormalizedInboundMail;
  classify?: ClassifierPort;
  lookupSubject?: SubjectLookupPort;
}): Promise<TriageResult> {
  const { profile, mail } = input;
  const summary = summarize(mail);

  if (isNoiseMail(mail)) {
    const noise = mailroomReasonByKey(profile, MAILROOM_NOISE_REASON_KEY);
    if (noise) return fromReason(noise, summary, null, "rule-noise", false);
  }

  const resolveSubject = async (reason: MailroomReason, candidate: string | null): Promise<string | null> => {
    if (!reason.subjectKind) return null;
    const token = candidate ?? extractSubjectCandidate(profile, reason.subjectKind, mail);
    if (!token) return null;
    if (!input.lookupSubject) return token;
    return input.lookupSubject(reason.subjectKind, token, mail);
  };

  const hinted = matchReasonByHints(profile, mail);
  if (hinted) {
    return fromReason(hinted, summary, await resolveSubject(hinted, null), "rule-hint", false);
  }

  const fallback = mailroomReasonByKey(profile, profile.defaultReasonKey) ?? profile.reasons[0];
  if (!input.classify) return fromReason(fallback, summary, await resolveSubject(fallback, null), "fallback", true);

  let answer: ClassifierAnswer | null = null;
  try {
    answer = await input.classify({
      subject: mail.subject ?? "",
      body: mail.textBody.slice(0, BODY_LIMIT),
      allowedReasons: profile.reasons.filter((r) => !r.noise).map((r) => ({ key: r.key, label: r.label })),
      subjectKindHint: (profile.subjectKinds ?? [])[0]?.kind ?? null,
    });
  } catch {
    answer = null;
  }
  const chosen = answer ? mailroomReasonByKey(profile, answer.reasonKey) : null;
  if (!chosen || chosen.noise) {
    return fromReason(fallback, summary, await resolveSubject(fallback, null), "fallback", true);
  }
  const modelSummary = answer?.summary?.trim() ? answer.summary.trim().slice(0, 240) : summary;
  return fromReason(chosen, modelSummary, await resolveSubject(chosen, answer?.subjectRef ?? null), "model", false);
}
